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
): Promise<number> {
  let stderr = ''
  try {
    const result = await execFile(
      ffmpegPath,
      ['-i', filePath, '-f', 'null', '-'],
      { maxBuffer: 4 * 1024 * 1024 },
    )
    stderr = String(result.stderr)
  }
  catch (error: unknown) {
    stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr: string | Buffer }).stderr)
      : ''
  }
  const match = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/u.exec(stderr)
  if (match === null)
    throw new Error(`Could not probe media duration for ${filePath}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}
