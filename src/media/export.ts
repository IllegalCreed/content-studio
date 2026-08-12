// @env node

import type {
  BilibiliVideoExportInput,
  BilibiliVideoExportResult,
} from '../types'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  stat,
} from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { probeMediaDuration, resolveFfmpegPath } from './ffmpeg'

const execFile = promisify(execFileCallback)
const FFMPEG_MAX_BUFFER_BYTES = 4 * 1024 * 1024

export class MediaExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaExportError'
  }
}

export type ExportBilibiliVideoInput = BilibiliVideoExportInput & {
  /** Test/runtime seam; never supplied through MCP. */
  ffmpegPath?: string
}

export type ExportBilibiliVideoResult = BilibiliVideoExportResult

/**
 * Produces an upload-oriented Bilibili video variant from a local composition.
 *
 * The composition engine intentionally keeps its deterministic WebM output.
 * This explicit export step creates an MP4 container with H.264 video and AAC
 * audio, without accepting arbitrary ffmpeg flags or reading any credentials.
 */
export async function exportBilibiliVideo(
  input: ExportBilibiliVideoInput,
): Promise<ExportBilibiliVideoResult> {
  validateInput(input)
  throwIfAborted(input.signal)
  const sourcePath = resolve(input.sourcePath)
  const outputPath = resolve(input.outputPath)
  if (sourcePath === outputPath) {
    throw new MediaExportError('Bilibili video export source and output must differ')
  }
  const outputExists = await access(outputPath)
    .then(() => true)
    .catch(() => false)
  if (outputExists)
    throw new MediaExportError('Bilibili video export destination already exists')
  try {
    await access(sourcePath)
  }
  catch {
    throw new MediaExportError('Bilibili video source is unavailable')
  }
  const ffmpegPath = input.ffmpegPath ?? resolveFfmpegPath()
  try {
    await execFile(
      ffmpegPath,
      [
        '-n',
        '-i',
        sourcePath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-shortest',
        '-f',
        'mp4',
        outputPath,
      ],
      {
        maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    )
    throwIfAborted(input.signal)
    await chmod(outputPath, 0o600)
    const outputStatus = await stat(outputPath)
    const durationSeconds = await probeMediaDuration(outputPath, ffmpegPath, input.signal)
    const sha256 = await hashFile(outputPath, input.signal)
    return {
      artifactPath: input.outputPath,
      durationSeconds,
      sha256,
      sizeBytes: outputStatus.size,
    }
  }
  catch (error: unknown) {
    if (input.signal?.aborted === true)
      throw new MediaExportError('Bilibili video export was cancelled')
    if (error instanceof MediaExportError)
      throw error
    throw new MediaExportError('Bilibili video export failed')
  }
}

function validateInput(input: ExportBilibiliVideoInput): void {
  if (input.sourcePath.trim() === '')
    throw new MediaExportError('Bilibili video source path must not be empty')
  if (input.outputPath.trim() === '')
    throw new MediaExportError('Bilibili video output path must not be empty')
  if (extname(input.outputPath).toLowerCase() !== '.mp4') {
    throw new MediaExportError('Bilibili video output path must use the .mp4 extension')
  }
}

async function hashFile(filePath: string, signal: AbortSignal | undefined): Promise<string> {
  throwIfAborted(signal)
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath, {
      ...(signal === undefined ? {} : { signal }),
    })
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', resolvePromise)
    stream.on('error', reject)
  })
  throwIfAborted(signal)
  return hash.digest('hex')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true)
    throw new MediaExportError('Bilibili video export was cancelled')
}
