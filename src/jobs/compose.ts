// @env node

import type {
  ComposeProductionInput,
  ComposeProductionResult,
  ProductionVideoResult,
} from '../types'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  stat,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { composeVideoClips } from '../media/compose'
import { generateDeterministicCover } from '../media/cover'
import {
  generateDeterministicGif,
  resolveGifOutputSize,
} from '../media/gif'

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
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    transitionDurationMs: input.transitionDurationMs ?? 400,
  })
  const info = await stat(input.outputPath)
  const sha256 = await hashFile(input.outputPath, input.signal)
  const video: ProductionVideoResult = {
    artifactPath: input.outputPath,
    durationSeconds: composed.durationSeconds,
    reencoded: composed.reencoded,
    sha256,
    sizeBytes: info.size,
  }
  await input.emit?.({ artifact: video, kind: 'video-ready' })
  const cover = input.cover === undefined
    ? undefined
    : await generateDeterministicCover({
        ...input.cover,
        outputSize: input.outputSize ?? { height: 1080, width: 1920 },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        sourcePath: input.outputPath,
      })
  if (cover !== undefined)
    await input.emit?.({ artifact: cover, kind: 'cover-ready' })
  const gif = input.gif === undefined
    ? undefined
    : await generateDeterministicGif({
        ...input.gif,
        outputSize: input.gif.outputSize
          ?? resolveGifOutputSize(input.outputSize ?? { height: 1080, width: 1920 }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        sourcePath: input.outputPath,
      })
  if (gif !== undefined)
    await input.emit?.({ artifact: gif, kind: 'gif-ready' })
  return {
    ...video,
    ...(cover === undefined ? {} : { cover }),
    ...(gif === undefined ? {} : { gif }),
  }
}

async function hashFile(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (signal?.aborted === true)
    throw new Error('Production composition was cancelled')
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, {
      ...(signal === undefined ? {} : { signal }),
    })
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
