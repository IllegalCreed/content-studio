// @env node

import type {
  ProductionGifResult,
  ProductionGifSpec,
  VideoViewport,
} from '../types'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { GIF_LIMITS } from '../constants'
import { probeMediaDuration, resolveFfmpegPath } from './ffmpeg'

const execFile = promisify(execFileCallback)
const FFMPEG_MAX_BUFFER_BYTES = 4 * 1024 * 1024

export class MediaGifError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaGifError'
  }
}

export interface GenerateDeterministicGifInput extends ProductionGifSpec {
  ffmpegPath?: string
  signal?: AbortSignal
  sourcePath: string
}

/**
 * Converts a bounded section of a local video into a looping, palette-based
 * GIF. The operation is deterministic and never calls an image provider.
 */
export async function generateDeterministicGif(
  input: GenerateDeterministicGifInput,
): Promise<ProductionGifResult> {
  const outputSize = input.outputSize ?? resolveGifOutputSize({
    height: 1080,
    width: 1920,
  })
  const fps = input.fps ?? GIF_LIMITS.defaultFps
  const durationSeconds = input.durationSeconds ?? GIF_LIMITS.defaultDurationSeconds
  const startSeconds = input.startSeconds ?? 0
  validateInput(input, outputSize, durationSeconds, fps, startSeconds)
  throwIfAborted(input.signal)

  let temporaryDirectory: string | undefined
  try {
    const ffmpegPath = input.ffmpegPath ?? resolveFfmpegPath()
    try {
      await access(input.sourcePath)
    }
    catch {
      throw new MediaGifError(`GIF source does not exist: ${input.sourcePath}`)
    }
    const outputDirectory = dirname(input.outputPath)
    await mkdir(outputDirectory, { recursive: true })
    temporaryDirectory = await mkdtemp(join(outputDirectory, '.gif-frame-'))
    const palettePath = join(temporaryDirectory, 'palette.png')
    const temporaryOutputPath = join(temporaryDirectory, 'preview.gif')
    await execFile(
      ffmpegPath,
      [
        '-y',
        '-ss',
        formatSeconds(startSeconds),
        '-i',
        input.sourcePath,
        '-t',
        formatSeconds(durationSeconds),
        '-vf',
        `${gifFrameFilter(outputSize, fps)},palettegen=stats_mode=diff`,
        '-an',
        palettePath,
      ],
      ffmpegOptions(input.signal),
    )
    throwIfAborted(input.signal)
    await execFile(
      ffmpegPath,
      [
        '-y',
        '-ss',
        formatSeconds(startSeconds),
        '-i',
        input.sourcePath,
        '-i',
        palettePath,
        '-t',
        formatSeconds(durationSeconds),
        '-filter_complex',
        `[0:v]${gifFrameFilter(outputSize, fps)}[scaled];[scaled][1:v]paletteuse=dither=sierra2_4a`,
        '-loop',
        '0',
        '-an',
        '-f',
        'gif',
        temporaryOutputPath,
      ],
      ffmpegOptions(input.signal),
    )
    throwIfAborted(input.signal)

    const outputStatus = await stat(temporaryOutputPath)
    if (outputStatus.size > GIF_LIMITS.maxSizeBytes) {
      throw new MediaGifError(
        `Generated GIF exceeds the ${GIF_LIMITS.maxSizeBytes} byte safety limit`,
      )
    }
    const content = await readFile(temporaryOutputPath)
    const actualDurationSeconds = await probeMediaDuration(
      temporaryOutputPath,
      ffmpegPath,
    )
    throwIfAborted(input.signal)
    await rename(temporaryOutputPath, input.outputPath)
    return {
      artifactPath: input.outputPath,
      durationSeconds: actualDurationSeconds,
      fps,
      height: outputSize.height,
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: outputStatus.size,
      width: outputSize.width,
    }
  }
  catch (error: unknown) {
    if (error instanceof MediaGifError)
      throw error
    throw new MediaGifError(
      `Deterministic GIF generation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  finally {
    if (temporaryDirectory !== undefined)
      await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

export function resolveGifOutputSize(input: VideoViewport): VideoViewport {
  const sourceLongEdge = Math.max(input.width, input.height)
  const scale = Math.min(1, GIF_LIMITS.defaultLongEdge / sourceLongEdge)
  return {
    height: Math.max(2, Math.round(input.height * scale)),
    width: Math.max(2, Math.round(input.width * scale)),
  }
}

function ffmpegOptions(signal: AbortSignal | undefined): {
  maxBuffer: number
  signal?: AbortSignal
} {
  return {
    maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
    ...(signal === undefined ? {} : { signal }),
  }
}

function formatSeconds(value: number): string {
  return String(Number(value.toFixed(3)))
}

function gifFrameFilter(outputSize: VideoViewport, fps: number): string {
  return [
    `fps=${fps}`,
    `scale=${outputSize.width}:${outputSize.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${outputSize.width}:${outputSize.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ].join(',')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true)
    throw new MediaGifError('Deterministic GIF generation was cancelled')
}

function validateInput(
  input: GenerateDeterministicGifInput,
  outputSize: VideoViewport,
  durationSeconds: number,
  fps: number,
  startSeconds: number,
): void {
  if (!Number.isInteger(outputSize.width) || outputSize.width < 2)
    throw new MediaGifError('GIF output width must be an integer of at least 2')
  if (!Number.isInteger(outputSize.height) || outputSize.height < 2)
    throw new MediaGifError('GIF output height must be an integer of at least 2')
  if (outputSize.width > GIF_LIMITS.maxDimension || outputSize.height > GIF_LIMITS.maxDimension)
    throw new MediaGifError(`GIF output dimensions must be at most ${GIF_LIMITS.maxDimension}px`)
  if (outputSize.width * outputSize.height > GIF_LIMITS.maxPixels)
    throw new MediaGifError('GIF output pixel area exceeds the safety limit')
  if (!Number.isInteger(fps) || fps < 1 || fps > GIF_LIMITS.maxFps)
    throw new MediaGifError(`GIF fps must be an integer between 1 and ${GIF_LIMITS.maxFps}`)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > GIF_LIMITS.maxDurationSeconds)
    throw new MediaGifError(`GIF duration must be greater than 0 and at most ${GIF_LIMITS.maxDurationSeconds} seconds`)
  if (fps * durationSeconds > GIF_LIMITS.maxFrames)
    throw new MediaGifError(`GIF frame count must not exceed ${GIF_LIMITS.maxFrames}`)
  if (!Number.isFinite(startSeconds) || startSeconds < 0)
    throw new MediaGifError('GIF start time must be a non-negative number')
  if (input.sourcePath.trim() === '')
    throw new MediaGifError('GIF source path must not be empty')
  if (input.outputPath.trim() === '')
    throw new MediaGifError('GIF output path must not be empty')
  if (extname(input.outputPath).toLowerCase() !== '.gif')
    throw new MediaGifError('GIF output path must use the .gif extension')
  if (resolve(input.sourcePath) === resolve(input.outputPath))
    throw new MediaGifError('GIF source and output paths must be different')
}
