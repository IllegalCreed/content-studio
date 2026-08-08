// @env node

import type { Dirent } from 'node:fs'
import type {
  CaptureFlow,
  Locale,
  LocalizedText,
  ProjectCaptureTarget,
  ProjectManifest,
} from '../types'
import { Buffer } from 'node:buffer'
import {
  open,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'

const DEFAULT_LOCALES: Locale[] = ['zh-CN', 'en']
const PLACEHOLDER_URL = 'https://example.invalid/'
const MAX_CAPTURE_FLOWS = 8
const MAX_CAPTURE_TARGETS = 12
const MAX_SCANNED_FILES = 200
const MAX_SCANNED_FILE_BYTES = 512 * 1024
const SKIP_SCAN_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'test-results',
])
const SOURCE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
])
const TEST_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((\/[^)#\s]+)(?:#[^)]*)?\)/g
const TEST_ID_PATTERN_SOURCE = /data-testid=(?:"([^"]+)"|'([^']+)')/g
const ROUTE_PATH_PATTERN = /path\s*[:=]\s*['"`](\/[^'"`?#]+)['"`]/g
const LOCALE_SEGMENT_PATTERN = /^[a-z]{2}(?:-[a-z0-9]{2,})?$/i

export interface SourceInspection {
  canonicalUrl: string
  name: string
  projectId: string
  repositoryUrl: string
  tagline?: string
}

interface PackageJsonInfo {
  description?: string
  homepage?: string
  name?: string
  repository?: string | { url?: string }
}

export interface SourceOwnedDraftOptions {
  canonicalUrl?: string
  locales?: Locale[]
  name?: string
  repositoryUrl?: string
  sourceDirectory: string
}

export interface WebAssistedDraftOptions {
  canonicalUrl: string
  locales?: Locale[]
  name: string
  projectId?: string
  repositoryUrl?: string
  tagline?: string
}

export async function inspectSourceDirectory(
  sourceDirectory: string,
): Promise<SourceInspection> {
  return inspectResolvedSourceDirectory(
    await resolveSourceDirectory(sourceDirectory),
  )
}

async function inspectResolvedSourceDirectory(
  sourceDirectory: string,
): Promise<SourceInspection> {
  let packageInfo: PackageJsonInfo = {}
  const packageJson = await readOptionalTextFile(
    join(sourceDirectory, 'package.json'),
    MAX_SCANNED_FILE_BYTES,
  )
  if (packageJson !== undefined)
    packageInfo = parsePackageJsonInfo(packageJson)

  const readme = await readReadme(sourceDirectory)
  const readmeInfo = parseReadme(readme)

  const directoryName = basename(sourceDirectory)
  const name = packageInfo.name ?? readmeInfo.title ?? directoryName
  const tagline = packageInfo.description ?? readmeInfo.description
  const repositoryUrl = resolveRepositoryUrl(packageInfo.repository)
  return {
    canonicalUrl: packageInfo.homepage ?? PLACEHOLDER_URL,
    name,
    projectId: toProjectId(name),
    repositoryUrl: repositoryUrl ?? PLACEHOLDER_URL,
    ...(tagline === undefined ? {} : { tagline }),
  }
}

export async function draftSourceOwnedProject(
  options: SourceOwnedDraftOptions,
): Promise<ProjectManifest> {
  const sourceDirectory = await resolveSourceDirectory(options.sourceDirectory)
  const inspection = await inspectResolvedSourceDirectory(sourceDirectory)
  const locales = options.locales ?? DEFAULT_LOCALES
  const name = options.name ?? inspection.name
  const [readme, sourceFiles] = await Promise.all([
    readReadme(sourceDirectory),
    scanResolvedSourceFiles(sourceDirectory),
  ])
  const captureFlows = mergeCaptureFlows([
    ...extractCaptureFlowsFromMarkdown(readme),
    ...extractCaptureFlowsFromSourceFiles(sourceFiles),
  ])
  const captureTargets = extractCaptureTargets(
    extractTestIds(sourceFiles),
  )
  return {
    schemaVersion: 1,
    projectId: toProjectId(name),
    name,
    canonicalUrl: options.canonicalUrl ?? inspection.canonicalUrl,
    repositoryUrl: options.repositoryUrl ?? inspection.repositoryUrl,
    locales,
    tagline: localized(inspection.tagline ?? name),
    facts: [],
    captureFlows,
    ...(captureTargets.length === 0 ? {} : { captureTargets }),
    sourceAccess: 'source-owned',
    captureMode: 'deterministic',
  }
}

export function draftWebAssistedProject(
  options: WebAssistedDraftOptions,
): ProjectManifest {
  const locales = options.locales ?? DEFAULT_LOCALES
  return {
    schemaVersion: 1,
    projectId: toProjectId(options.projectId ?? options.name),
    name: options.name,
    canonicalUrl: options.canonicalUrl,
    repositoryUrl: options.repositoryUrl ?? PLACEHOLDER_URL,
    locales,
    tagline: localized(options.tagline ?? options.name),
    facts: [],
    captureFlows: [],
    sourceAccess: 'web-assisted',
    captureMode: 'assisted',
    repeatability: 'low',
  }
}

export function toProjectId(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? 'project' : normalized
}

export function extractCaptureFlowsFromMarkdown(
  markdown: string | undefined,
  max = MAX_CAPTURE_FLOWS,
): CaptureFlow[] {
  if (markdown === undefined)
    return []
  const flows: CaptureFlow[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(MARKDOWN_LINK_PATTERN)) {
    const title = cleanMarkdown(match[1] ?? '')
    const path = match[2] ?? ''
    const id = toProjectId(path)
    if (title === '' || seen.has(id) || !path.startsWith('/'))
      continue
    seen.add(id)
    flows.push({
      id,
      title: localized(title),
      startPath: path,
      steps: [{
        kind: 'capture',
        label: 'capture-start',
      }],
    })
    if (flows.length >= max)
      break
  }
  return flows
}

export function extractCaptureTargets(
  testIds: string[],
  max = MAX_CAPTURE_TARGETS,
): ProjectCaptureTarget[] {
  const targets: ProjectCaptureTarget[] = []
  const seen = new Set<string>()
  for (const id of testIds) {
    if (!TEST_ID_PATTERN.test(id) || seen.has(id))
      continue
    seen.add(id)
    targets.push({
      id,
      label: localized(humanizeTestId(id)),
      locator: {
        by: 'test-id',
        value: id,
      },
      purpose: 'control',
    })
    if (targets.length >= max)
      break
  }
  return targets
}

export function extractCaptureFlowsFromSourceFiles(
  files: string[],
  max = MAX_CAPTURE_FLOWS,
): CaptureFlow[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const file of files) {
    for (const match of file.matchAll(ROUTE_PATH_PATTERN)) {
      const path = match[1] ?? ''
      const id = toProjectId(path)
      const segments = path.split('/').filter(Boolean)
      const localeRoot = segments.length === 1
        && LOCALE_SEGMENT_PATTERN.test(segments[0] ?? '')
      if (
        path === ''
        || id === 'project'
        || path.includes(':')
        || path.includes('$')
        || path === '/'
        || localeRoot
        || seen.has(id)
      ) {
        continue
      }
      seen.add(id)
      paths.push(path)
    }
  }
  paths.sort((left, right) => {
    const leftSegments = left.split('/').filter(Boolean).length
    const rightSegments = right.split('/').filter(Boolean).length
    return leftSegments - rightSegments || left.localeCompare(right)
  })
  return paths.slice(0, max).map(path => ({
    id: toProjectId(path),
    title: localized(humanizePath(path)),
    startPath: path,
    steps: [{
      kind: 'capture',
      label: 'capture-start',
    }],
  }))
}

export function extractTestIds(files: string[]): string[] {
  const testIds: string[] = []
  const idSet = new Set<string>()
  for (const file of files) {
    for (const match of file.matchAll(TEST_ID_PATTERN_SOURCE)) {
      const id = (match[1] ?? match[2] ?? '').trim()
      if (id !== '' && !idSet.has(id)) {
        idSet.add(id)
        testIds.push(id)
      }
    }
  }
  return testIds
}

export async function scanSourceTestIds(
  sourceDirectory: string,
): Promise<string[]> {
  return extractTestIds(await scanSourceFiles(sourceDirectory))
}

export async function scanSourceFiles(
  sourceDirectory: string,
): Promise<string[]> {
  return scanResolvedSourceFiles(await resolveSourceDirectory(sourceDirectory))
}

async function scanResolvedSourceFiles(
  sourceDirectory: string,
): Promise<string[]> {
  const files: string[] = []
  const pendingDirectories = [sourceDirectory]
  let scannedFiles = 0
  let scannedDirectories = 0
  while (
    pendingDirectories.length > 0
    && scannedFiles < MAX_SCANNED_FILES
    && scannedDirectories < MAX_SCANNED_FILES
  ) {
    const directory = pendingDirectories.shift()!
    scannedDirectories += 1
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    }
    catch {
      continue
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const segments = relative(sourceDirectory, absolutePath).split(/[\\/]/)
      if (segments.some(segment => SKIP_SCAN_DIRECTORIES.has(segment)))
        continue
      if (entry.isDirectory()) {
        if (
          pendingDirectories.length + scannedDirectories
          < MAX_SCANNED_FILES
        ) {
          pendingDirectories.push(absolutePath)
        }
        continue
      }
      if (
        !entry.isFile()
        || !SOURCE_EXTENSIONS.has(extname(entry.name))
        || scannedFiles >= MAX_SCANNED_FILES
      ) {
        continue
      }
      scannedFiles += 1
      try {
        files.push(await readTextFilePrefix(
          absolutePath,
          MAX_SCANNED_FILE_BYTES,
        ))
      }
      catch {
        // Files can disappear during inspection; skip only that source file.
      }
    }
  }
  return files
}

function localized(text: string): LocalizedText {
  return {
    'en': text,
    'zh-CN': text,
  }
}

async function readReadme(sourceDirectory: string): Promise<string | undefined> {
  return readOptionalTextFile(
    join(sourceDirectory, 'README.md'),
    MAX_SCANNED_FILE_BYTES,
  )
}

async function resolveSourceDirectory(sourceDirectory: string): Promise<string> {
  try {
    const resolved = await realpath(sourceDirectory)
    const metadata = await stat(resolved)
    if (!metadata.isDirectory())
      throw new Error('path is not a directory')
    await readdir(resolved)
    return resolved
  }
  catch (error: unknown) {
    throw new Error(
      `Source directory is missing, unreadable, or not a directory: ${sourceDirectory}`,
      { cause: error },
    )
  }
}

async function readOptionalTextFile(
  filePath: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    return await readTextFilePrefix(filePath, maxBytes)
  }
  catch (error: unknown) {
    if (isMissingFileError(error))
      return undefined
    throw error
  }
}

async function readTextFilePrefix(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const file = await open(filePath, 'r')
  try {
    const metadata = await file.stat()
    const length = Math.min(metadata.size, maxBytes)
    if (length === 0)
      return ''
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, 0)
    return buffer.toString('utf8', 0, bytesRead)
  }
  finally {
    await file.close()
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ENOENT'
}

function parsePackageJsonInfo(packageJson: string): PackageJsonInfo {
  const parsed = JSON.parse(packageJson) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Source package.json must contain a JSON object')
  return parsed as PackageJsonInfo
}

function parseReadme(readme: string | undefined): {
  description?: string
  title?: string
} {
  if (readme === undefined)
    return {}
  const lines = readme
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const title = cleanTitle(lines[0])
  const description = lines.find(line => !line.startsWith('#'))
  return {
    ...(description === undefined ? {} : { description: cleanMarkdown(description) }),
    ...(title === undefined ? {} : { title }),
  }
}

function cleanTitle(line: string | undefined): string | undefined {
  if (line === undefined)
    return undefined
  const cleaned = cleanMarkdown(line.replace(/^#+\s*/, ''))
  return cleaned === '' ? undefined : cleaned
}

function cleanMarkdown(input: string): string {
  return input.replace(/[*_`]/g, '').trim()
}

function humanizeTestId(testId: string): string {
  return testId
    .split('-')
    .filter(Boolean)
    .map((word, index) => index === 0
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word)
    .join(' ')
}

function humanizePath(path: string): string {
  const last = path.split('/').filter(Boolean).at(-1) ?? path
  return humanizeTestId(toProjectId(last))
}

function mergeCaptureFlows(flows: CaptureFlow[]): CaptureFlow[] {
  const seen = new Set<string>()
  const merged: CaptureFlow[] = []
  for (const flow of flows) {
    if (seen.has(flow.id))
      continue
    seen.add(flow.id)
    merged.push(flow)
    if (merged.length >= MAX_CAPTURE_FLOWS)
      break
  }
  return merged
}

function resolveRepositoryUrl(
  repository: string | { url?: string } | undefined,
): string | undefined {
  const candidate = typeof repository === 'string'
    ? repository
    : repository?.url
  if (candidate === undefined)
    return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol === 'https:' && url.username === '' && url.password === '')
      return url.toString()
  }
  catch {
    // fall through to ssh-style normalization
  }
  const sshMatch = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(candidate)
  if (sshMatch === null)
    return undefined
  return `https://${sshMatch[1]}/${sshMatch[2]}`
}
