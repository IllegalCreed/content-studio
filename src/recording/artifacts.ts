// @env node

import type {
  RecorderArtifact,
  RecorderArtifactKind,
  RecorderAttemptReceipt,
} from '../types'
import { createHash } from 'node:crypto'
import {
  link,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path'
import process from 'node:process'
import { validateOutputDirectory } from '../output/write'

export async function prepareAttemptDirectory(
  outputDirectoryInput: string,
  attempt: number,
): Promise<string> {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new Error('Recorder attempt must be a positive integer')

  const outputDirectory = validateOutputDirectory(outputDirectoryInput)
  await mkdir(outputDirectory, {
    recursive: true,
  })
  const artifactDirectory = resolve(outputDirectory, `attempt-${attempt}`)
  try {
    await mkdir(artifactDirectory)
  }
  catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(
        `Recorder attempt directory already exists: ${artifactDirectory}`,
      )
    }
    throw error
  }
  return artifactDirectory
}

export async function createRecorderArtifact(
  artifactDirectoryInput: string,
  relativePathInput: string,
  kind: RecorderArtifactKind,
  id: string,
  sceneId?: string,
): Promise<RecorderArtifact> {
  const artifactDirectory = resolve(artifactDirectoryInput)
  const artifactPath = resolve(artifactDirectory, relativePathInput)
  if (!isWithin(artifactDirectory, artifactPath))
    throw new Error(`Unsafe recorder artifact path: ${relativePathInput}`)

  const fileStatus = await stat(artifactPath)
  if (!fileStatus.isFile())
    throw new Error(`Recorder artifact is not a file: ${relativePathInput}`)
  const content = await readFile(artifactPath)

  return {
    id,
    kind,
    relativePath: toPortableRelativePath(relative(artifactDirectory, artifactPath)),
    ...(sceneId === undefined ? {} : { sceneId }),
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: fileStatus.size,
  }
}

export async function writeRecorderReceipt(
  receipt: RecorderAttemptReceipt,
): Promise<void> {
  const artifactDirectory = resolve(receipt.artifactDirectory)
  const receiptPath = resolve(artifactDirectory, 'receipt.json')
  if (!isWithin(dirname(artifactDirectory), receiptPath))
    throw new Error('Unsafe recorder receipt path')

  const temporaryPath = `${receiptPath}.tmp-${process.pid}`
  await writeFile(
    temporaryPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )
  try {
    await link(temporaryPath, receiptPath)
  }
  catch (error) {
    if (isAlreadyExistsError(error))
      throw new Error(`Recorder receipt already exists: ${receiptPath}`)
    throw error
  }
  finally {
    await unlink(temporaryPath).catch(() => {})
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'EEXIST'
}

function isWithin(parent: string, child: string): boolean {
  const childRelativePath = relative(parent, child)
  return childRelativePath !== ''
    && !childRelativePath.startsWith('..')
    && !isAbsolute(childRelativePath)
}

function toPortableRelativePath(path: string): string {
  return path.replaceAll('\\', '/')
}
