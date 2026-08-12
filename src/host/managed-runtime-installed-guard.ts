// @env node

import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

const RUNTIME_VERSION = '0.1.0'
const RUNTIME_NAME = 'marketing-ops'
const RUNTIMES_DIRECTORY = 'runtimes'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const PRIVATE_EXECUTABLE_MODE = 0o700
const ROOT_ENTRIES = ['browsers.json', 'dist', 'package.json', 'runtime-manifest.json']
const ROOT_ENTRIES_WITH_ASSET_BUNDLES = ['asset-bundles', ...ROOT_ENTRIES]
const DIST_ENTRIES = ['keychain-helper', 'playwright-core.bundle.cjs', 'server.js']

/**
 * Checks the immutable-on-disk shape expected of an installed runtime.
 *
 * This is deliberately a read-only guard. It does not repair modes, remove
 * entries, or read any runtime content. A false result is intentionally the
 * only failure signal so filesystem paths and owner details do not escape the
 * installer/host boundary.
 */
export async function verifyInstalledManagedMarketingOpsRuntime(
  runtimeRoot: string,
): Promise<boolean> {
  if (process.platform === 'win32' || typeof process.getuid !== 'function')
    return false
  const currentUid = process.getuid()
  if (!Number.isInteger(currentUid) || currentUid < 0)
    return false
  if (!isCanonicalFixedRuntimeRoot(runtimeRoot))
    return false

  try {
    const root = await verifyDirectory(runtimeRoot, currentUid, PRIVATE_DIRECTORY_MODE)
    if (root === null || root !== runtimeRoot)
      return false

    const marketingOps = resolve(root, '..')
    const runtimes = resolve(marketingOps, '..')
    if (!await isPrivateDirectory(runtimes, currentUid, PRIVATE_DIRECTORY_MODE))
      return false
    if (!await isPrivateDirectory(marketingOps, currentUid, PRIVATE_DIRECTORY_MODE))
      return false

    const rootEntries = (await readdir(root)).sort()
    if (!sameEntries(rootEntries, ROOT_ENTRIES) && !sameEntries(rootEntries, ROOT_ENTRIES_WITH_ASSET_BUNDLES))
      return false
    if (rootEntries.includes('asset-bundles')) {
      const assetBundles = resolve(root, 'asset-bundles')
      if (!await isPrivateDirectory(assetBundles, currentUid, PRIVATE_DIRECTORY_MODE))
        return false
    }
    const dist = resolve(root, 'dist')
    if (!await isPrivateDirectory(dist, currentUid, PRIVATE_DIRECTORY_MODE))
      return false
    if (!await hasExactEntries(dist, DIST_ENTRIES))
      return false

    return await hasPrivateRuntimeFiles(root, currentUid)
  }
  catch {
    return false
  }
}

async function hasPrivateRuntimeFiles(root: string, currentUid: number): Promise<boolean> {
  const files: ReadonlyArray<{ mode: number, path: string }> = [
    { mode: PRIVATE_FILE_MODE, path: 'browsers.json' },
    { mode: PRIVATE_EXECUTABLE_MODE, path: 'dist/keychain-helper' },
    { mode: PRIVATE_FILE_MODE, path: 'dist/playwright-core.bundle.cjs' },
    { mode: PRIVATE_FILE_MODE, path: 'dist/server.js' },
    { mode: PRIVATE_FILE_MODE, path: 'package.json' },
    { mode: PRIVATE_FILE_MODE, path: 'runtime-manifest.json' },
  ]
  for (const file of files) {
    const path = resolve(root, file.path)
    const metadata = await lstat(path)
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.nlink !== 1
      || !isOwnedPrivateMode(metadata, currentUid, file.mode)
      || await realpath(path) !== path
    ) {
      return false
    }
  }
  return true
}

async function verifyDirectory(
  path: string,
  currentUid: number,
  expectedMode: number,
): Promise<string | null> {
  if (!await isPrivateDirectory(path, currentUid, expectedMode))
    return null
  const safePath = await realpath(path)
  return safePath === path ? safePath : null
}

async function isPrivateDirectory(
  path: string,
  currentUid: number,
  expectedMode: number,
): Promise<boolean> {
  const metadata = await lstat(path)
  return metadata.isDirectory()
    && !metadata.isSymbolicLink()
    && isOwnedPrivateMode(metadata, currentUid, expectedMode)
    && await realpath(path) === path
}

async function hasExactEntries(path: string, expected: readonly string[]): Promise<boolean> {
  const entries = (await readdir(path)).sort()
  return sameEntries(entries, expected)
}

function isOwnedPrivateMode(
  metadata: { mode: number, uid: number },
  currentUid: number,
  expectedMode: number,
): boolean {
  return metadata.uid === currentUid
    && (metadata.mode & 0o7000) === 0
    && (metadata.mode & 0o777) === expectedMode
}

function isCanonicalFixedRuntimeRoot(path: string): boolean {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.includes('\u0000')
    || !isAbsolute(path)
    || resolve(path) !== path
  ) {
    return false
  }
  const segments = path.split('/').filter(Boolean)
  return segments.slice(-3).join('/') === `${RUNTIMES_DIRECTORY}/${RUNTIME_NAME}/${RUNTIME_VERSION}`
}

function sameEntries(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index])
}
