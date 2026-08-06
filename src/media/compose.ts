// @env node

import type { VideoViewport } from '../types'
import { execFile as execFileCallback } from 'node:child_process'
import {
  access,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import {
  probeMediaDuration,
  resolveFfmpegPath,
} from './ffmpeg'

const execFile = promisify(execFileCallback)
const LOUDNESS_FILTER = 'loudnorm=I=-16:TP=-1.5:LRA=11'

export class MediaCompositionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaCompositionError'
  }
}

export interface ComposeVideoClipsInput {
  clips: string[]
  ffmpegPath?: string
  normalizeLoudness?: boolean
  outputPath: string
  outputSize?: VideoViewport
  reencode?: boolean
}

export interface ComposeVideoClipsResult {
  durationSeconds: number
  outputPath: string
  reencoded: boolean
}

/**
 * Concatenates ordered video clips into a single output file. The default
 * path stream-copies frames (`-c copy`) for speed; when that fails or
 * `reencode` is requested, ffmpeg re-encodes the joined stream.
 */
export async function composeVideoClips(
  input: ComposeVideoClipsInput,
): Promise<ComposeVideoClipsResult> {
  if (input.clips.length === 0) {
    throw new MediaCompositionError(
      'At least one composition clip is required',
    )
  }
  const ffmpegPath = input.ffmpegPath ?? resolveFfmpegPath()
  for (const clip of input.clips) {
    try {
      await access(clip)
    }
    catch {
      throw new MediaCompositionError(
        `Composition clip does not exist: ${clip}`,
      )
    }
  }
  try {
    await access(dirname(input.outputPath))
  }
  catch {
    throw new MediaCompositionError(
      `Composition output directory does not exist: ${dirname(input.outputPath)}`,
    )
  }

  const listPath = `${input.outputPath}.concat.txt`
  await writeFile(listPath, concatListFileContent(input.clips), 'utf8')
  const needsFilters = input.outputSize !== undefined
    || input.normalizeLoudness === true
  let reencoded = false
  try {
    if (input.reencode !== true && !needsFilters) {
      try {
        await execFile(
          ffmpegPath,
          ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', input.outputPath],
          { maxBuffer: 4 * 1024 * 1024 },
        )
      }
      catch {
        reencoded = true
      }
    }
    else {
      reencoded = true
    }
    if (reencoded) {
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
      if (input.outputSize !== undefined) {
        args.push('-vf', scalePadFilter(input.outputSize))
      }
      if (input.normalizeLoudness === true) {
        args.push('-af', LOUDNESS_FILTER)
      }
      await execFile(
        ffmpegPath,
        [...args, input.outputPath],
        { maxBuffer: 4 * 1024 * 1024 },
      )
    }
  }
  catch (error: unknown) {
    throw new MediaCompositionError(
      `Video composition failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  finally {
    await unlink(listPath).catch(() => {})
  }

  const durationSeconds = await probeMediaDuration(input.outputPath, ffmpegPath)
  return {
    durationSeconds,
    outputPath: input.outputPath,
    reencoded,
  }
}

function scalePadFilter(size: VideoViewport): string {
  return [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
  ].join(',')
}

function concatListFileContent(clips: string[]): string {
  return `${clips
    .map(clip => `file '${clip.replace(/'/g, `'\\''`)}'`)
    .join('\n')}\n`
}
