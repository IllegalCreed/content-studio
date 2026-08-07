// @env node

import type {
  ComposeProductionInput,
  ComposeProductionResult,
} from '../types'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  stat,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { composeVideoClips } from '../media/compose'

/**
 * Default composition for a production task: crossfades the scene clips of a
 * successful recording into one final channel variant with a short transition
 * (400 ms by default, disabled when 0) and returns its checksum and size for
 * artifact registration.
 */
export async function composeProductionVideoClips(
  input: ComposeProductionInput,
): Promise<ComposeProductionResult> {
  if (input.clipPaths.length === 0) {
    throw new Error('Production composition requires at least one clip')
  }
  await mkdir(dirname(input.outputPath), {
    recursive: true,
  })
  const composed = await composeVideoClips({
    clips: input.clipPaths,
    ...(input.normalizeLoudness === undefined
      ? {}
      : { normalizeLoudness: input.normalizeLoudness }),
    ...(input.outputSize === undefined ? {} : { outputSize: input.outputSize }),
    outputPath: input.outputPath,
    transitionDurationMs: input.transitionDurationMs ?? 400,
  })
  const info = await stat(input.outputPath)
  const sha256 = await hashFile(input.outputPath)
  return {
    artifactPath: input.outputPath,
    durationSeconds: composed.durationSeconds,
    reencoded: composed.reencoded,
    sha256,
    sizeBytes: info.size,
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
