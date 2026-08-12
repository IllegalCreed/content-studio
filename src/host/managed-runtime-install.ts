// @env node

import type { Buffer } from 'node:buffer'
import type { InstallerManagedRuntimeHandoff } from './managed-runtime-handoff'
import { constants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { parseInstallerManagedRuntimeHandoff } from './managed-runtime-handoff'

const FIXED_RUNTIME_SEGMENTS = ['runtimes', 'marketing-ops', '0.1.0'] as const
const RUNTIME_PARENT_SEGMENTS = FIXED_RUNTIME_SEGMENTS.slice(0, -1)
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const WRITE_NEW_FILE_FLAGS = constants.O_WRONLY
  | constants.O_CREAT
  | constants.O_EXCL
  | constants.O_NOFOLLOW
const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW

const RUNTIME_FILES = [
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'browsers.json' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'LICENSES/playwright-core/LICENSE' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'LICENSES/playwright-core/NOTICE' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'LICENSES/playwright-core/ThirdPartyNotices.txt' },
  { executable: true, mode: PRIVATE_DIRECTORY_MODE, path: 'dist/keychain-helper' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'dist/playwright-core.bundle.cjs' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'dist/server.js' },
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'package.json' },
  // This is deliberately last: an interrupted installation is not a valid runtime.
  { executable: false, mode: PRIVATE_FILE_MODE, path: 'runtime-manifest.json' },
] as const

const RUNTIME_DIRECTORIES = ['dist', 'LICENSES', 'LICENSES/playwright-core'] as const
const ROOT_ENTRIES = ['LICENSES', 'browsers.json', 'dist', 'package.json', 'runtime-manifest.json']
const ROOT_ENTRIES_WITH_ASSET_BUNDLES = ['LICENSES', 'asset-bundles', 'browsers.json', 'dist', 'package.json', 'runtime-manifest.json']
const DIST_ENTRIES = ['keychain-helper', 'playwright-core.bundle.cjs', 'server.js']
const LICENSES_ENTRIES = ['playwright-core']
const PLAYWRIGHT_LICENSE_ENTRIES = ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt']

export interface InstallManagedMarketingOpsRuntimeOptions {
  /** A digest from the installer's signed or embedded trust source. */
  expectedManifestSha256: string
  /** An explicit existing, owner-controlled installation root. */
  installerRoot: string
  /** An explicit staging directory containing the fixed runtime package. */
  sourceRoot: string
}

export interface PosixModeOwner {
  mode: number
  uid: number
}

interface ClaimedRuntimeDirectory {
  path: string
}

/**
 * The POSIX permission predicate used for installer roots and installed files.
 * It intentionally does not claim to validate platform ACLs, so installation
 * is unsupported outside POSIX until an equivalent platform verifier exists.
 */
export function isOwnedPrivatePosixEntry(
  entry: PosixModeOwner,
  currentUid: number,
): boolean {
  return Number.isInteger(entry.mode)
    && Number.isInteger(entry.uid)
    && Number.isInteger(currentUid)
    && entry.uid === currentUid
    && (entry.mode & 0o7000) === 0
    && (entry.mode & 0o022) === 0
}

/**
 * Claims one fixed version directory with mkdir, then writes only the
 * allowlisted files using O_EXCL|O_NOFOLLOW. It never discovers roots,
 * replaces an installed version, starts a process, or treats a staging
 * manifest as a trust root. A failed claim is intentionally retained as a
 * fail-closed partial directory; this installer never deletes unknown output.
 * Any failure returns null without path details.
 */
export async function installManagedMarketingOpsRuntime(
  input: unknown,
): Promise<InstallerManagedRuntimeHandoff | null> {
  if (process.platform === 'win32' || !isInstallOptions(input))
    return null
  const currentUid = process.getuid?.()
  if (currentUid === undefined)
    return null

  try {
    const installerRoot = await readOwnedPrivateDirectory(input.installerRoot, currentUid)
    const sourceRoot = await readRealDirectory(input.sourceRoot)
    if (installerRoot === null || sourceRoot === null)
      return null

    const sourceAsset = await resolveManagedMarketingOpsRuntimeAsset(
      sourceRoot,
      input.expectedManifestSha256,
    )
    if (sourceAsset === null || sourceAsset.runtimeRoot !== sourceRoot)
      return null

    const ensuredRuntimeParent = await ensurePrivateRuntimeParent(installerRoot, currentUid)
    if (ensuredRuntimeParent === null)
      return null
    const claimed = await claimRuntimeDirectory(ensuredRuntimeParent, currentUid)
    if (claimed === null)
      return null

    if (!await writeFixedRuntimePackage(sourceRoot, claimed.path, currentUid))
      return null
    const installedAsset = await resolveManagedMarketingOpsRuntimeAsset(
      claimed.path,
      input.expectedManifestSha256,
    )
    if (installedAsset === null || !await hasExactPrivateRuntimeLayout(claimed.path, currentUid))
      return null

    const handoff = parseInstallerManagedRuntimeHandoff({
      contractVersion: 3,
      manifestSha256: input.expectedManifestSha256,
      runtimeName: 'marketing-ops',
      runtimeRoot: installedAsset.runtimeRoot,
      runtimeVersion: installedAsset.runtimeVersion,
    })
    if (handoff === null)
      return null
    return handoff
  }
  catch {
    return null
  }
}

function isInstallOptions(input: unknown): input is InstallManagedMarketingOpsRuntimeOptions {
  if (!isRecord(input))
    return false
  const keys = Object.keys(input)
  const expectedKeys = ['expectedManifestSha256', 'installerRoot', 'sourceRoot']
  return keys.length === expectedKeys.length
    && keys.every(key => expectedKeys.includes(key))
    && typeof input.expectedManifestSha256 === 'string'
    && isSha256(input.expectedManifestSha256)
    && typeof input.installerRoot === 'string'
    && typeof input.sourceRoot === 'string'
}

async function ensurePrivateRuntimeParent(
  installerRoot: string,
  currentUid: number,
): Promise<string | null> {
  let parent = installerRoot
  for (const segment of RUNTIME_PARENT_SEGMENTS) {
    const child = await ensureOwnedPrivateChildDirectory(parent, segment, currentUid)
    if (child === null)
      return null
    parent = child
  }
  return parent
}

async function ensureOwnedPrivateChildDirectory(
  parent: string,
  name: string,
  currentUid: number,
): Promise<string | null> {
  const child = join(parent, name)
  let created = false
  try {
    await mkdir(child, { mode: PRIVATE_DIRECTORY_MODE })
    created = true
  }
  catch (error: unknown) {
    if (!isAlreadyExistsError(error))
      return null
  }
  if (created)
    await chmod(child, PRIVATE_DIRECTORY_MODE)
  const safeChild = await readOwnedPrivateDirectory(child, currentUid)
  return safeChild !== null && dirname(safeChild) === parent
    ? safeChild
    : null
}

async function claimRuntimeDirectory(
  runtimeParent: string,
  currentUid: number,
): Promise<ClaimedRuntimeDirectory | null> {
  const destination = join(runtimeParent, FIXED_RUNTIME_SEGMENTS[2])
  try {
    await mkdir(destination, { mode: PRIVATE_DIRECTORY_MODE })
    const createdMetadata = await lstat(destination)
    if (
      !createdMetadata.isDirectory()
      || createdMetadata.isSymbolicLink()
      || !isOwnedPrivatePosixEntry(createdMetadata, currentUid)
    ) {
      return null
    }
    await chmod(destination, PRIVATE_DIRECTORY_MODE)
    const safeDestination = await readOwnedPrivateDirectory(destination, currentUid)
    if (safeDestination !== destination || !hasMode(await lstat(destination), PRIVATE_DIRECTORY_MODE))
      return null
    return { path: destination }
  }
  catch {
    return null
  }
}

async function writeFixedRuntimePackage(
  sourceRoot: string,
  destination: string,
  currentUid: number,
): Promise<boolean> {
  for (const relativeDirectory of RUNTIME_DIRECTORIES) {
    const directory = join(destination, relativeDirectory)
    await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE })
    await chmod(directory, PRIVATE_DIRECTORY_MODE)
    if (await readOwnedPrivateDirectory(directory, currentUid) !== directory)
      return false
  }

  for (const file of RUNTIME_FILES) {
    const contents = await readFixedStagingFile(sourceRoot, file.path, file.executable)
    if (contents === null)
      return false
    await writeNewPrivateFile(join(destination, file.path), contents, file.mode)
  }
  return hasExactPrivateRuntimeLayout(destination, currentUid)
}

async function readFixedStagingFile(
  sourceRoot: string,
  relativePath: string,
  executable: boolean,
): Promise<Buffer | null> {
  const path = resolve(sourceRoot, relativePath)
  const parent = dirname(path)
  if (!isInside(sourceRoot, path) || !isInsideOrRoot(sourceRoot, parent))
    return null
  const parentMetadata = await lstat(parent)
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(parent) !== parent)
    return null
  const file = await open(path, READ_NOFOLLOW_FLAGS)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || (executable && (metadata.mode & 0o111) === 0))
      return null
    const safePath = await realpath(path)
    if (safePath !== path || !isInside(sourceRoot, safePath))
      return null
    return await file.readFile()
  }
  finally {
    await file.close()
  }
}

async function writeNewPrivateFile(
  path: string,
  contents: Uint8Array,
  mode: number,
): Promise<void> {
  const file = await open(path, WRITE_NEW_FILE_FLAGS, mode)
  try {
    await file.writeFile(contents)
    await file.chmod(mode)
    await file.sync()
  }
  finally {
    await file.close()
  }
}

async function hasExactPrivateRuntimeLayout(
  root: string,
  currentUid: number,
): Promise<boolean> {
  const safeRoot = await readOwnedPrivateDirectory(root, currentUid)
  if (safeRoot !== root || !hasMode(await lstat(root), PRIVATE_DIRECTORY_MODE))
    return false
  const rootEntries = (await readdir(root)).sort()
  if (!sameEntries(rootEntries, ROOT_ENTRIES) && !sameEntries(rootEntries, ROOT_ENTRIES_WITH_ASSET_BUNDLES))
    return false
  if (rootEntries.includes('asset-bundles')) {
    const assetBundles = join(root, 'asset-bundles')
    const safeAssetBundles = await readOwnedPrivateDirectory(assetBundles, currentUid)
    if (safeAssetBundles !== assetBundles || !hasMode(await lstat(assetBundles), PRIVATE_DIRECTORY_MODE))
      return false
  }
  const dist = join(root, 'dist')
  const safeDist = await readOwnedPrivateDirectory(dist, currentUid)
  if (safeDist !== dist || !hasMode(await lstat(dist), PRIVATE_DIRECTORY_MODE))
    return false
  const distEntries = (await readdir(dist)).sort()
  if (!sameEntries(distEntries, DIST_ENTRIES))
    return false
  const licenses = join(root, 'LICENSES')
  const safeLicenses = await readOwnedPrivateDirectory(licenses, currentUid)
  if (safeLicenses !== licenses || !hasMode(await lstat(licenses), PRIVATE_DIRECTORY_MODE))
    return false
  if (!sameEntries((await readdir(licenses)).sort(), LICENSES_ENTRIES))
    return false
  const playwrightLicenses = join(licenses, 'playwright-core')
  const safePlaywrightLicenses = await readOwnedPrivateDirectory(playwrightLicenses, currentUid)
  if (safePlaywrightLicenses !== playwrightLicenses || !hasMode(await lstat(playwrightLicenses), PRIVATE_DIRECTORY_MODE))
    return false
  if (!sameEntries((await readdir(playwrightLicenses)).sort(), PLAYWRIGHT_LICENSE_ENTRIES))
    return false

  for (const file of RUNTIME_FILES) {
    const path = join(root, file.path)
    const metadata = await lstat(path)
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || !isOwnedPrivatePosixEntry(metadata, currentUid)
      || !hasMode(metadata, file.mode)
      || (file.executable && (metadata.mode & 0o111) === 0)
    ) {
      return false
    }
  }
  return true
}

async function readOwnedPrivateDirectory(
  path: string,
  currentUid: number,
): Promise<string | null> {
  const safePath = await readRealDirectory(path)
  if (safePath === null)
    return null
  const metadata = await lstat(safePath)
  return isOwnedPrivatePosixEntry(metadata, currentUid)
    ? safePath
    : null
}

async function readRealDirectory(path: string): Promise<string | null> {
  if (!isCanonicalAbsolutePath(path))
    return null
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    return null
  const safePath = await realpath(path)
  return safePath === path
    ? safePath
    : null
}

function isCanonicalAbsolutePath(path: string): boolean {
  return path.length > 0
    && !path.includes('\u0000')
    && isAbsolute(path)
    && resolve(path) === path
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath !== ''
    && !relativePath.startsWith('..')
    && !isAbsolute(relativePath)
}

function isInsideOrRoot(root: string, candidate: string): boolean {
  return candidate === root || isInside(root, candidate)
}

function hasMode(metadata: PosixModeOwner, expected: number): boolean {
  return (metadata.mode & 0o777) === expected
}

function sameEntries(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index])
}

function isSha256(input: string): boolean {
  return /^[a-f0-9]{64}$/u.test(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isAlreadyExistsError(error: unknown): boolean {
  return isErrorWithCode(error, 'EEXIST')
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}
