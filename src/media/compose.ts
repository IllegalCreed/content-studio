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
  probeMediaHasAudio,
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
  transitionDurationMs?: number
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

  const transitionDurationMs = input.transitionDurationMs ?? 0
  if (transitionDurationMs < 0) {
    throw new MediaCompositionError(
      'Transition duration must not be negative',
    )
  }
  const needsTransitions = transitionDurationMs > 0 && input.clips.length >= 2
  const listPath = `${input.outputPath}.concat.txt`
  await writeFile(listPath, concatListFileContent(input.clips), 'utf8')
  const needsFilters = input.outputSize !== undefined
    || input.normalizeLoudness === true
  let reencoded = false
  try {
    if (!needsTransitions && input.reencode !== true && !needsFilters) {
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
      const args = needsTransitions
        ? await transitionCompositionArgs(
            input.clips,
            transitionDurationMs,
            input,
            ffmpegPath,
          )
        : concatReencodeArgs(input, listPath)
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

async function transitionCompositionArgs(
  clips: string[],
  transitionDurationMs: number,
  input: Pick<
    ComposeVideoClipsInput,
    'normalizeLoudness' | 'outputPath' | 'outputSize'
  >,
  ffmpegPath: string,
): Promise<string[]> {
  const durations = await Promise.all(
    clips.map(clip => probeMediaDuration(clip, ffmpegPath)),
  )
  const transitionSeconds = transitionDurationMs / 1000
  const shortestClip = Math.min(...durations)
  if (transitionSeconds >= shortestClip) {
    throw new MediaCompositionError(
      'Transition duration must be shorter than every clip',
    )
  }
  const hasAudio = await Promise.all(
    clips.map(clip => probeMediaHasAudio(clip, ffmpegPath)),
  )
  const allAudio = hasAudio.every(Boolean)
  const parts: string[] = []

  let videoLabel = '0:v'
  for (let index = 1; index < clips.length; index++) {
    const offset = durations
      .slice(0, index)
      .reduce((total, duration) => total + duration, 0)
      - index * transitionSeconds
    const nextLabel = index === clips.length - 1
      ? 'vchained'
      : `vx${index}`
    parts.push(
      `[${videoLabel}][${index}:v]xfade=transition=fade:`
      + `duration=${transitionSeconds.toFixed(3)}:offset=${offset.toFixed(3)}`
      + `[${nextLabel}]`,
    )
    videoLabel = nextLabel
  }
  if (input.outputSize !== undefined) {
    parts.push(`[${videoLabel}]${scalePadFilter(input.outputSize)}[vout]`)
    videoLabel = 'vout'
  }

  let audioLabel: string | undefined
  if (allAudio) {
    audioLabel = '0:a'
    for (let index = 1; index < clips.length; index++) {
      const nextLabel = index === clips.length - 1
        ? 'achained'
        : `ax${index}`
      parts.push(
        `[${audioLabel}][${index}:a]acrossfade=d=${transitionSeconds.toFixed(3)}`
        + `[${nextLabel}]`,
      )
      audioLabel = nextLabel
    }
    if (input.normalizeLoudness === true) {
      parts.push(`[${audioLabel}]${LOUDNESS_FILTER}[aout]`)
      audioLabel = 'aout'
    }
  }

  const args = ['-y']
  for (const clip of clips)
    args.push('-i', clip)
  args.push('-filter_complex', parts.join(';'))
  args.push('-map', `[${videoLabel}]`)
  if (audioLabel !== undefined)
    args.push('-map', `[${audioLabel}]`)
  return args
}

function concatReencodeArgs(
  input: Pick<
    ComposeVideoClipsInput,
    'normalizeLoudness' | 'outputPath' | 'outputSize'
  >,
  listPath: string,
): string[] {
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
  if (input.outputSize !== undefined) {
    args.push('-vf', scalePadFilter(input.outputSize))
  }
  if (input.normalizeLoudness === true) {
    args.push('-af', LOUDNESS_FILTER)
  }
  return args
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
