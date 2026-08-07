// @env node

import type {
  Locale,
  LocalizedText,
  ProjectManifest,
} from '../types'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const DEFAULT_LOCALES: Locale[] = ['zh-CN', 'en']
const PLACEHOLDER_URL = 'https://example.invalid/'

export interface SourceInspection {
  canonicalUrl: string
  name: string
  projectId: string
  repositoryUrl: string
  tagline: string
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

  let readmeLine: string | undefined
  try {
    const readme = await readFile(join(sourceDirectory, 'README.md'), 'utf8')
    readmeLine = readme
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0)
  }
  catch {
    // README is optional
  }

  const directoryName = basename(sourceDirectory)
  const name = packageInfo.name ?? cleanTitle(readmeLine) ?? directoryName
  const description = packageInfo.description ?? cleanTitle(readmeLine)
  const repositoryUrl = resolveRepositoryUrl(packageInfo.repository)
  return {
    canonicalUrl: packageInfo.homepage ?? PLACEHOLDER_URL,
    name,
    projectId: toProjectId(name),
    repositoryUrl: repositoryUrl ?? PLACEHOLDER_URL,
    tagline: description ?? name,
  }
}

export async function draftSourceOwnedProject(
  options: SourceOwnedDraftOptions,
): Promise<ProjectManifest> {
  const inspection = await inspectSourceDirectory(options.sourceDirectory)
  const locales = options.locales ?? DEFAULT_LOCALES
  const name = options.name ?? inspection.name
  return {
    schemaVersion: 1,
    projectId: toProjectId(name),
    name,
    canonicalUrl: options.canonicalUrl ?? inspection.canonicalUrl,
    repositoryUrl: options.repositoryUrl ?? inspection.repositoryUrl,
    locales,
    tagline: localized(options.name === undefined
      ? inspection.tagline
      : name),
    facts: [],
    captureFlows: [],
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

function localized(text: string): LocalizedText {
  return {
    'en': text,
    'zh-CN': text,
  }
}

function cleanTitle(line: string | undefined): string | undefined {
  if (line === undefined)
    return undefined
  const cleaned = line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()
  return cleaned === '' ? undefined : cleaned
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
