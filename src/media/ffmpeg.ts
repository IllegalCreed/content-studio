// @env node

import type { Buffer } from 'node:buffer'
import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'

const execFile = promisify(execFileCallback)

/**
 * Resolves an ffmpeg binary: the pinned ffmpeg-static binary first, then a
 * system ffmpeg on PATH, and fails closed when neither is available.
 */
export function resolveFfmpegPath(): string {
  if (ffmpegStatic !== null)
    return ffmpegStatic
  try {
    execFileSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
    })
    return 'ffmpeg'
  }
  catch {
    throw new Error('ffmpeg is not available')
  }
}

export async function probeMediaDuration(
  filePath: string,
  ffmpegPath = resolveFfmpegPath(),
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal)
  let stderr = ''
  try {
    const result = await execFile(
      ffmpegPath,
      ['-i', filePath, '-f', 'null', '-'],
      ffmpegOptions(signal),
    )
    stderr = String(result.stderr)
  }
  catch (error: unknown) {
    if (signal?.aborted === true)
      throw new Error('Media probe was cancelled')
    stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr: string | Buffer }).stderr)
      : ''
  }
  throwIfAborted(signal)
  const match = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/u.exec(stderr)
  if (match === null)
    throw new Error(`Could not probe media duration for ${filePath}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export interface ProbedVideoSize {
  height: number
  width: number
}

export async function probeVideoSize(
  filePath: string,
  ffmpegPath = resolveFfmpegPath(),
  signal?: AbortSignal,
): Promise<ProbedVideoSize> {
  throwIfAborted(signal)
  let stderr = ''
  try {
    const result = await execFile(
      ffmpegPath,
      ['-i', filePath, '-f', 'null', '-'],
      ffmpegOptions(signal),
    )
    stderr = String(result.stderr)
  }
  catch (error: unknown) {
    if (signal?.aborted === true)
      throw new Error('Media probe was cancelled')
    stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr: string | Buffer }).stderr)
      : ''
  }
  throwIfAborted(signal)
  const match = /Stream #0:0: Video: .*?,\s*(\d+)x(\d+)/u.exec(stderr)
  if (match === null)
    throw new Error(`Could not probe video size for ${filePath}`)
  return {
    height: Number(match[2]),
    width: Number(match[1]),
  }
}

export async function probeMediaHasAudio(
  filePath: string,
  ffmpegPath = resolveFfmpegPath(),
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal)
  let stderr = ''
  try {
    const result = await execFile(
      ffmpegPath,
      ['-i', filePath, '-f', 'null', '-'],
      ffmpegOptions(signal),
    )
    stderr = String(result.stderr)
  }
  catch (error: unknown) {
    if (signal?.aborted === true)
      throw new Error('Media probe was cancelled')
    stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr: string | Buffer }).stderr)
      : ''
  }
  throwIfAborted(signal)
  return /Stream #.*: Audio:/u.test(stderr)
}

function ffmpegOptions(signal: AbortSignal | undefined): {
  maxBuffer: number
  signal?: AbortSignal
} {
  return {
    maxBuffer: 4 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal }),
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true)
    throw new Error('Media probe was cancelled')
}
