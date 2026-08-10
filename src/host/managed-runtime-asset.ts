// @env node

import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const MANAGED_RUNTIME_MANIFEST_FILE = 'runtime-manifest.json'
const MANAGED_RUNTIME_FILES = [
  'dist/keychain-helper',
  'dist/server.js',
  'package.json',
] as const
const MANAGED_RUNTIME_VERSION = '0.1.0'
const MANAGED_RUNTIME_CONTRACT_VERSION = 3
const MANAGED_RUNTIME_NAME = 'marketing-ops'

export interface ManagedMarketingOpsRuntimeAsset {
  entrypoint: string
  runtimeRoot: string
  runtimeVersion: string
}

interface ManagedRuntimeFile {
  path: string
  sha256: string
}

interface ManagedRuntimeManifest {
  contractVersion: number
  files: ManagedRuntimeFile[]
  runtimeName: string
  runtimeVersion: string
  schemaVersion: number
}

/**
 * Resolves an installer-owned runtime only after its manifest is checked
 * against a digest already trusted by the installer. This helper never starts
 * a process and deliberately exposes no parse or filesystem error details.
 */
export async function resolveManagedMarketingOpsRuntimeAsset(
  runtimeRoot: string,
  expectedManifestSha256: string,
): Promise<ManagedMarketingOpsRuntimeAsset | null> {
  if (!isSha256(expectedManifestSha256))
    return null
  try {
    const safeRoot = await safeDirectory(runtimeRoot)
    if (safeRoot === null)
      return null
    const manifestPath = resolve(safeRoot, MANAGED_RUNTIME_MANIFEST_FILE)
    const manifestBytes = await safeFile(safeRoot, manifestPath)
    if (manifestBytes === null || !digestMatches(manifestBytes, expectedManifestSha256))
      return null
    const manifest = parseManifest(manifestBytes)
    if (manifest === null)
      return null
    for (const file of manifest.files) {
      const filePath = resolve(safeRoot, file.path)
      const contents = await safeFile(safeRoot, filePath)
      if (contents === null || !digestMatches(contents, file.sha256))
        return null
    }
    return {
      entrypoint: resolve(safeRoot, 'dist/server.js'),
      runtimeRoot: safeRoot,
      runtimeVersion: manifest.runtimeVersion,
    }
  }
  catch {
    return null
  }
}

async function safeDirectory(path: string): Promise<string | null> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    return null
  return realpath(path)
}

async function safeFile(root: string, path: string): Promise<Buffer | null> {
  if (!isInside(root, path))
    return null
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink())
    return null
  const safePath = await realpath(path)
  if (!isInside(root, safePath))
    return null
  return readFile(safePath)
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath !== ''
    && !relativePath.startsWith('..')
    && !isAbsolute(relativePath)
}

function parseManifest(input: Buffer): ManagedRuntimeManifest | null {
  let value: unknown
  try {
    value = JSON.parse(input.toString('utf8')) as unknown
  }
  catch {
    return null
  }
  if (!isRecord(value))
    return null
  const keys = Object.keys(value)
  const supported = new Set([
    'contractVersion',
    'files',
    'runtimeName',
    'runtimeVersion',
    'schemaVersion',
  ])
  if (keys.length !== supported.size || !keys.every(key => supported.has(key)))
    return null
  if (
    value.schemaVersion !== 1
    || value.runtimeName !== MANAGED_RUNTIME_NAME
    || value.runtimeVersion !== MANAGED_RUNTIME_VERSION
    || value.contractVersion !== MANAGED_RUNTIME_CONTRACT_VERSION
    || !Array.isArray(value.files)
    || value.files.length !== MANAGED_RUNTIME_FILES.length
  ) {
    return null
  }
  const files = value.files.map(parseFile)
  if (files.includes(null))
    return null
  const resolvedFiles = files as ManagedRuntimeFile[]
  const paths = resolvedFiles.map(file => file.path)
  const hasExpectedPaths = MANAGED_RUNTIME_FILES.every(path => paths.includes(path))
  if (new Set(paths).size !== MANAGED_RUNTIME_FILES.length || !hasExpectedPaths) {
    return null
  }
  return {
    contractVersion: value.contractVersion,
    files: resolvedFiles,
    runtimeName: value.runtimeName,
    runtimeVersion: value.runtimeVersion,
    schemaVersion: value.schemaVersion,
  }
}

function parseFile(input: unknown): ManagedRuntimeFile | null {
  if (!isRecord(input))
    return null
  const keys = Object.keys(input)
  if (
    keys.length !== 2
    || !keys.includes('path')
    || !keys.includes('sha256')
    || typeof input.path !== 'string'
    || typeof input.sha256 !== 'string'
    || !MANAGED_RUNTIME_FILES.includes(input.path as typeof MANAGED_RUNTIME_FILES[number])
    || !isSha256(input.sha256)
  ) {
    return null
  }
  return { path: input.path, sha256: input.sha256 }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isSha256(input: string): boolean {
  return /^[a-f0-9]{64}$/u.test(input)
}

function digestMatches(contents: Uint8Array, expected: string): boolean {
  const actual = createHash('sha256').update(contents).digest()
  const expectedBytes = Buffer.from(expected, 'hex')
  return expectedBytes.length === actual.length
    && timingSafeEqual(actual, expectedBytes)
}
