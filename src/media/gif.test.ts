// @env node

import type { GenerateDeterministicGifInput } from './gif'
import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { probeMediaHasAudio, resolveFfmpegPath } from './ffmpeg'
import {
  generateDeterministicGif,
  resolveGifOutputSize,
} from './gif'

const execFile = promisify(execFileCallback)

const ffmpegIsAvailable = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
})()

async function makeClip(directory: string): Promise<string> {
  const path = join(directory, 'source.webm')
  await execFile(
    resolveFfmpegPath(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=0.8:size=320x240:rate=12',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '200k',
      path,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  )
  return path
}

describe('deterministic GIF configuration', () => {
  it('resolves a bounded long-edge size without upscaling', () => {
    expect(resolveGifOutputSize({ height: 1080, width: 1920 })).toEqual({
      height: 360,
      width: 640,
    })
    expect(resolveGifOutputSize({ height: 1920, width: 1080 })).toEqual({
      height: 640,
      width: 360,
    })
    expect(resolveGifOutputSize({ height: 1080, width: 1080 })).toEqual({
      height: 640,
      width: 640,
    })
    expect(resolveGifOutputSize({ height: 240, width: 320 })).toEqual({
      height: 240,
      width: 320,
    })
  })

  it.each([
    ['a fractional width', { outputSize: { height: 120, width: 1.5 } }, /width/i],
    ['a narrow width', { outputSize: { height: 120, width: 1 } }, /width/i],
    ['a fractional height', { outputSize: { height: 1.5, width: 160 } }, /height/i],
    ['a narrow height', { outputSize: { height: 1, width: 160 } }, /height/i],
    ['an excessive dimension', { outputSize: { height: 120, width: 1921 } }, /dimension/i],
    ['an excessive pixel area', { outputSize: { height: 1920, width: 1920 } }, /pixel/i],
    ['a zero frame rate', { fps: 0 }, /fps/i],
    ['an excessive frame rate', { fps: 25 }, /fps/i],
    ['a zero duration', { durationSeconds: 0 }, /duration/i],
    ['an excessive duration', { durationSeconds: 16 }, /duration/i],
    ['too many frames', { durationSeconds: 15, fps: 24 }, /frame count/i],
    ['a negative start', { startSeconds: -1 }, /start/i],
    ['a non-GIF output', { outputPath: 'cover.svg' }, /\.gif/i],
    ['an empty source path', { sourcePath: ' ' }, /source.*empty/i],
    ['an empty output path', { outputPath: ' ' }, /output.*empty/i],
    ['the same source and output path', {
      outputPath: '/tmp/content-studio-gif-validation/source.gif',
      sourcePath: '/tmp/content-studio-gif-validation/source.gif',
    }, /different/i],
  ] satisfies Array<[
    string,
    Partial<GenerateDeterministicGifInput>,
    RegExp,
  ]>)('rejects %s before touching the filesystem', async (_name, override, message) => {
    await expect(generateDeterministicGif({
      outputPath: '/tmp/content-studio-gif-validation/preview.gif',
      outputSize: { height: 120, width: 160 },
      sourcePath: '/tmp/content-studio-gif-validation/source.webm',
      ...override,
    })).rejects.toThrow(message)
  })

  it('honors a signal that was already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(generateDeterministicGif({
      outputPath: '/tmp/content-studio-gif-validation/preview.gif',
      outputSize: { height: 120, width: 160 },
      signal: controller.signal,
      sourcePath: '/tmp/content-studio-gif-validation/source.webm',
    })).rejects.toThrow(/cancelled/i)
  })
})

describe.skipIf(!ffmpegIsAvailable)('deterministic GIF generation', () => {
  it('creates a palette-optimized looping GIF with metadata and no audio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-gif-'))
    try {
      const sourcePath = await makeClip(directory)
      const outputPath = join(directory, 'nested', 'preview.gif')
      const result = await generateDeterministicGif({
        durationSeconds: 0.5,
        fps: 8,
        outputPath,
        outputSize: { height: 120, width: 160 },
        sourcePath,
        startSeconds: 0.1,
      })

      await expect(access(outputPath)).resolves.toBeUndefined()
      expect(result).toMatchObject({
        artifactPath: outputPath,
        fps: 8,
        height: 120,
        width: 160,
      })
      expect(result.durationSeconds).toBeGreaterThan(0.2)
      expect(result.durationSeconds).toBeLessThan(0.7)
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(result.sizeBytes).toBeGreaterThan(0)
      const gif = await readFile(outputPath)
      expect(gif.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/)
      expect(gif.toString('ascii')).toContain('NETSCAPE2.0')
      await expect(probeMediaHasAudio(outputPath)).resolves.toBe(false)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('applies bounded defaults when optional GIF settings are omitted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-gif-'))
    try {
      const sourcePath = await makeClip(directory)
      const result = await generateDeterministicGif({
        outputPath: join(directory, 'preview.gif'),
        signal: new AbortController().signal,
        sourcePath,
      })

      expect(result).toMatchObject({
        fps: 10,
        height: 360,
        width: 640,
      })
      expect(result.durationSeconds).toBeGreaterThan(0.2)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails closed when the source is unavailable or ffmpeg fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-gif-'))
    try {
      await expect(generateDeterministicGif({
        outputPath: join(directory, 'missing.gif'),
        outputSize: { height: 120, width: 160 },
        sourcePath: join(directory, 'missing.webm'),
      })).rejects.toThrow(/source.*exist/i)

      const sourcePath = await makeClip(directory)
      await expect(generateDeterministicGif({
        ffmpegPath: join(directory, 'missing-ffmpeg'),
        outputPath: join(directory, 'failed.gif'),
        outputSize: { height: 120, width: 160 },
        sourcePath,
      })).rejects.toThrow(/generation failed/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
