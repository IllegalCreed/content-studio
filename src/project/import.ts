// @env node

import type { Dirent } from 'node:fs'
import type {
  CaptureFlow,
  Locale,
  LocalizedText,
  ProjectCaptureTarget,
  ProjectManifest,
} from '../types'
import { readdir, readFile } from 'node:fs/promises'
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
  let packageInfo: PackageJsonInfo = {}
  try {
    packageInfo = JSON.parse(
      await readFile(join(sourceDirectory, 'package.json'), 'utf8'),
    ) as PackageJsonInfo
  }
  catch {
    // package.json is optional; fall back to README and directory name
  }

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
  const inspection = await inspectSourceDirectory(options.sourceDirectory)
  const locales = options.locales ?? DEFAULT_LOCALES
  const name = options.name ?? inspection.name
  const [readme, testIds] = await Promise.all([
    readReadme(options.sourceDirectory),
    scanSourceTestIds(options.sourceDirectory),
  ])
  const captureFlows = extractCaptureFlowsFromMarkdown(readme)
  const captureTargets = extractCaptureTargets(testIds)
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

export async function scanSourceTestIds(
  sourceDirectory: string,
): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(sourceDirectory, {
      recursive: true,
      withFileTypes: true,
    })
  }
  catch {
    return []
  }
  const sorted = [...entries].sort((left, right) =>
    left.name.localeCompare(right.name))
  const testIds: string[] = []
  const idSet = new Set<string>()
  let scannedFiles = 0
  for (const entry of sorted) {
    if (!entry.isFile() || scannedFiles >= MAX_SCANNED_FILES)
      continue
    const absolutePath = join(entry.parentPath, entry.name)
    const segments = relative(sourceDirectory, absolutePath).split(/[\\/]/)
    if (segments.some(segment => SKIP_SCAN_DIRECTORIES.has(segment)))
      continue
    if (!SOURCE_EXTENSIONS.has(extname(entry.name)))
      continue
    scannedFiles += 1
    let content: string
    try {
      content = (await readFile(absolutePath, 'utf8'))
        .slice(0, MAX_SCANNED_FILE_BYTES)
    }
    catch {
      continue
    }
    for (const match of content.matchAll(TEST_ID_PATTERN_SOURCE)) {
      const id = (match[1] ?? match[2] ?? '').trim()
      if (id !== '' && !idSet.has(id)) {
        idSet.add(id)
        testIds.push(id)
      }
    }
  }
  return testIds
}

function localized(text: string): LocalizedText {
  return {
    'en': text,
    'zh-CN': text,
  }
}

async function readReadme(sourceDirectory: string): Promise<string | undefined> {
  try {
    return await readFile(join(sourceDirectory, 'README.md'), 'utf8')
  }
  catch {
    return undefined
  }
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
