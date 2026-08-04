// @env node

import type {
  StorageCleanupPreviewItem,
  StorageRecycleEntry,
} from '../types'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const MANIFEST_FILE_NAME = 'manifest.json'
const DEFAULT_RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

interface RecycleManifest {
  entries: StorageRecycleEntry[]
}

export interface MoveToRecycleBinInput {
  item: StorageCleanupPreviewItem
  now?: Date
  outputRoot: string
  projectId: string
  recycleRoot: string
}

export interface RestoreFromRecycleBinInput {
  outputRoot: string
  projectId: string
  recycleId: string
  recycleRoot: string
}

export async function listStorageRecycleEntries(
  recycleRoot: string,
  projectId: string,
): Promise<StorageRecycleEntry[]> {
  assertSafeSegment(projectId, 'projectId')
  const manifest = await readManifest(recycleRoot, projectId)
  return manifest.entries.map(entry => ({ ...entry }))
}

export async function moveToRecycleBin(
  input: MoveToRecycleBinInput,
): Promise<StorageRecycleEntry> {
  assertSafeSegment(input.projectId, 'projectId')
  if (input.item.status !== 'review')
    throw new Error('Only reviewable cleanup items can be moved to the recycle area')
  const sourcePath = await resolveExistingFile(
    input.outputRoot,
    input.projectId,
    input.item.relativePath,
  )
  const contents = await readFile(sourcePath)
  const actualSha256 = sha256(contents)
  if (actualSha256 !== input.item.sha256)
    throw new Error(`Registered file ${input.item.id} no longer matches its checksum`)

  const now = input.now ?? new Date()
  const recycleId = `recycle-${now.getTime()}-${randomUUID().slice(0, 8)}`
  const recycledRelativePath = join(
    input.projectId,
    recycleId,
    input.item.relativePath,
  )
  const recycledPath = resolveInside(input.recycleRoot, recycledRelativePath)
  await mkdir(dirname(recycledPath), { recursive: true })
  await rename(sourcePath, recycledPath)

  const entry: StorageRecycleEntry = {
    expiresAt: new Date(now.getTime() + DEFAULT_RECOVERY_WINDOW_MS).toISOString(),
    itemId: input.item.id,
    kind: input.item.kind,
    originalRelativePath: input.item.relativePath,
    projectId: input.projectId,
    recycleId,
    recycledAt: now.toISOString(),
    recycledRelativePath,
    scope: input.item.scope,
    sha256: input.item.sha256,
    sizeBytes: input.item.sizeBytes ?? contents.byteLength,
    version: input.item.version,
  }

  try {
    const manifest = await readManifest(input.recycleRoot, input.projectId)
    await writeManifest(input.recycleRoot, input.projectId, {
      entries: [...manifest.entries, entry],
    })
  }
  catch (error: unknown) {
    await rename(recycledPath, sourcePath).catch(() => undefined)
    throw error
  }
  return entry
}

export async function restoreFromRecycleBin(
  input: RestoreFromRecycleBinInput,
): Promise<StorageRecycleEntry> {
  assertSafeSegment(input.projectId, 'projectId')
  assertSafeSegment(input.recycleId, 'recycleId')
  const manifest = await readManifest(input.recycleRoot, input.projectId)
  const entry = manifest.entries.find(candidate => candidate.recycleId === input.recycleId)
  if (entry === undefined)
    throw new Error(`Recycle entry ${input.recycleId} was not found`)
  if (Date.parse(entry.expiresAt) <= Date.now())
    throw new Error(`Recycle entry ${entry.recycleId} is outside its recovery window`)
  const recycledPath = resolveInside(input.recycleRoot, entry.recycledRelativePath)
  const targetPath = resolveInside(
    resolve(input.outputRoot, input.projectId),
    entry.originalRelativePath,
  )
  await assertExistingFile(recycledPath)
  await assertAbsent(targetPath)
  const contents = await readFile(recycledPath)
  if (sha256(contents) !== entry.sha256)
    throw new Error(`Recycle entry ${entry.recycleId} no longer matches its checksum`)
  await mkdir(dirname(targetPath), { recursive: true })
  await rename(recycledPath, targetPath)
  try {
    await writeManifest(input.recycleRoot, input.projectId, {
      entries: manifest.entries.filter(candidate => candidate.recycleId !== entry.recycleId),
    })
  }
  catch (error: unknown) {
    await rename(targetPath, recycledPath).catch(() => undefined)
    throw error
  }
  return { ...entry }
}

async function readManifest(
  recycleRoot: string,
  projectId: string,
): Promise<RecycleManifest> {
  const manifestPath = resolveInside(recycleRoot, join(projectId, MANIFEST_FILE_NAME))
  try {
    const source = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(source) as unknown
    if (!isManifest(parsed, projectId))
      throw new Error(`Recycle manifest for project ${projectId} is invalid`)
    return parsed
  }
  catch (error: unknown) {
    if (isNodeError(error, 'ENOENT'))
      return { entries: [] }
    throw error
  }
}

async function writeManifest(
  recycleRoot: string,
  projectId: string,
  manifest: RecycleManifest,
): Promise<void> {
  const manifestPath = resolveInside(recycleRoot, join(projectId, MANIFEST_FILE_NAME))
  await mkdir(dirname(manifestPath), { recursive: true })
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, manifestPath)
}

async function resolveExistingFile(
  outputRoot: string,
  projectId: string,
  relativePath: string,
): Promise<string> {
  const projectRoot = resolve(outputRoot, projectId)
  const candidatePath = resolveInside(projectRoot, relativePath)
  const safeProjectRoot = await realpathOrThrow(projectRoot)
  const safeCandidatePath = await realpathOrThrow(candidatePath)
  const safeRelativePath = relative(safeProjectRoot, safeCandidatePath)
  if (safeRelativePath === '' || safeRelativePath.startsWith('..') || isAbsolute(safeRelativePath))
    throw new Error('Registered file path is outside the project output directory')
  await assertExistingFile(safeCandidatePath)
  return safeCandidatePath
}

async function realpathOrThrow(path: string): Promise<string> {
  return realpath(path)
}

async function assertExistingFile(path: string): Promise<void> {
  const fileStatus = await stat(path)
  if (!fileStatus.isFile())
    throw new Error(`Expected a file at ${path}`)
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await stat(path)
  }
  catch (error: unknown) {
    if (isNodeError(error, 'ENOENT'))
      return
    throw error
  }
  throw new Error(`Cannot restore over an existing file: ${path}`)
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = resolve(root, relativePath)
  const candidateRelativePath = relative(resolve(root), candidate)
  if (
    candidateRelativePath === ''
    || candidateRelativePath.startsWith('..')
    || isAbsolute(candidateRelativePath)
  ) {
    throw new Error('Storage path is outside the managed directory')
  }
  return candidate
}

function isManifest(input: unknown, projectId: string): input is RecycleManifest {
  if (typeof input !== 'object' || input === null || !('entries' in input) || !Array.isArray(input.entries))
    return false
  return input.entries.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null)
      return false
    const candidate = entry as Partial<StorageRecycleEntry>
    return candidate.projectId === projectId
      && typeof candidate.recycleId === 'string'
      && typeof candidate.itemId === 'string'
      && typeof candidate.recycledRelativePath === 'string'
      && typeof candidate.originalRelativePath === 'string'
      && typeof candidate.expiresAt === 'string'
      && !Number.isNaN(Date.parse(candidate.expiresAt))
      && typeof candidate.sha256 === 'string'
      && /^[a-f0-9]{64}$/u.test(candidate.sha256)
      && typeof candidate.sizeBytes === 'number'
      && Number.isSafeInteger(candidate.sizeBytes)
      && candidate.sizeBytes >= 0
  })
}

function assertSafeSegment(value: string, name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value))
    throw new Error(`${name} must use lowercase kebab-case`)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code
}

function sha256(contents: Uint8Array): string {
  return createHash('sha256').update(contents).digest('hex')
}
