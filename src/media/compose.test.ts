import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  chmod,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  join,
  relative,
} from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { composeVideoClips } from './compose'
import {
  probeMediaDuration,
  probeMediaHasAudio,
  probeVideoSize,
  resolveFfmpegPath,
} from './ffmpeg'

const execFile = promisify(execFileCallback)

const ffmpegIsAvailable = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
    })
    return true
  }
  catch {
    return false
  }
})()

async function makeWebmClip(
  directory: string,
  name: string,
  durationSeconds: number,
): Promise<string> {
  const path = join(directory, name)
  await execFile(
    resolveFfmpegPath(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${durationSeconds}:size=320x240:rate=10`,
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

async function makeAudioWebmClip(
  directory: string,
  name: string,
  durationSeconds: number,
): Promise<string> {
  const path = join(directory, name)
  await execFile(
    resolveFfmpegPath(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${durationSeconds}:size=320x240:rate=10`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-c:v',
      'libvpx-vp9',
      '-c:a',
      'libopus',
      '-shortest',
      path,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  )
  return path
}

describe.skipIf(!ffmpegIsAvailable)('ffmpeg composition engine', () => {
  it('composes ordered clips into one output on the fast copy path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const second = await makeWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'composed.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        outputPath,
      })

      expect(result.reencoded).toBe(false)
      expect(result.durationSeconds).toBeGreaterThan(0.8)
      expect(result.durationSeconds).toBeLessThan(1.2)
      await expect(access(outputPath)).resolves.toBeUndefined()
      if (process.platform !== 'win32')
        expect((await stat(outputPath)).mode & 0o777).toBe(0o600)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('resolves relative clip paths before writing the concat manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const absoluteClip = await makeWebmClip(directory, 'relative.webm', 0.5)
      const outputPath = join(directory, 'relative-output.webm')

      const result = await composeVideoClips({
        clips: [relative(process.cwd(), absoluteClip)],
        outputPath,
      })

      expect(result.reencoded).toBe(false)
      await expect(access(outputPath)).resolves.toBeUndefined()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('supports an explicit re-encode request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeWebmClip(directory, 'single.webm', 0.5)
      const outputPath = join(directory, 'reencoded.webm')

      const result = await composeVideoClips({
        clips: [clip],
        outputPath,
        reencode: true,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.3)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('cancels an in-flight ffmpeg process and removes its concat manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeWebmClip(directory, 'single.webm', 0.5)
      const outputPath = join(directory, 'cancelled.webm')
      const slowFfmpegPath = join(directory, 'slow-ffmpeg.mjs')
      await writeFile(
        slowFfmpegPath,
        '#!/usr/bin/env node\nsetTimeout(() => {}, 30_000)\n',
        'utf8',
      )
      await chmod(slowFfmpegPath, 0o755)
      const controller = new AbortController()
      const composition = composeVideoClips({
        clips: [clip],
        ffmpegPath: slowFfmpegPath,
        outputPath,
        reencode: true,
        signal: controller.signal,
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      controller.abort()

      await expect(composition).rejects.toThrow(/cancel/i)
      await expect(access(`${outputPath}.concat.txt`)).rejects.toThrow()
      await expect(access(outputPath)).rejects.toThrow()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('scales and pads the composed output to a target size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const second = await makeWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'sized.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        outputPath,
        outputSize: { height: 360, width: 640 },
      })

      expect(result.reencoded).toBe(true)
      expect(await probeVideoSize(outputPath)).toEqual({
        height: 360,
        width: 640,
      })
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('normalizes loudness when the composed clips carry audio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeAudioWebmClip(directory, 'audio.webm', 0.5)
      const outputPath = join(directory, 'loudness.webm')

      const result = await composeVideoClips({
        clips: [clip],
        normalizeLoudness: true,
        outputPath,
      })

      expect(result.durationSeconds).toBeGreaterThan(0.3)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('composes video-only clips with loudness normalization requested', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeWebmClip(directory, 'silent.webm', 0.5)
      const outputPath = join(directory, 'silent-loudness.webm')

      const result = await composeVideoClips({
        clips: [clip],
        normalizeLoudness: true,
        outputPath,
      })

      expect(result.durationSeconds).toBeGreaterThan(0.3)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects a missing clip before running ffmpeg', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      await expect(composeVideoClips({
        clips: [join(directory, 'missing.webm')],
        outputPath: join(directory, 'out.webm'),
      })).rejects.toThrow(/clip/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects an empty clip list', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      await expect(composeVideoClips({
        clips: [],
        outputPath: join(directory, 'out.webm'),
      })).rejects.toThrow(/at least one composition clip/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects when ffmpeg cannot open the output path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeWebmClip(directory, 'clip.webm', 0.5)
      await expect(composeVideoClips({
        clips: [clip],
        outputPath: directory,
        reencode: true,
      })).rejects.toThrow(/composition failed/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects when the output directory does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const clip = await makeWebmClip(directory, 'clip.webm', 0.5)
      await expect(composeVideoClips({
        clips: [clip],
        outputPath: join(directory, 'missing-directory', 'out.webm'),
      })).rejects.toThrow(/composition/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('probes the duration of a media file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-probe-'))
    try {
      const clip = await makeWebmClip(directory, 'probe.webm', 0.5)
      expect(await probeMediaDuration(clip)).toBeGreaterThan(0.3)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('honors cancellation before starting a media probe', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(probeMediaDuration(
      '/tmp/content-studio-cancelled-probe.webm',
      resolveFfmpegPath(),
      controller.signal,
    )).rejects.toThrow(/cancel/i)
  })

  it('accepts successful probe output while carrying a cancellation signal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-probe-'))
    try {
      const probePath = join(directory, 'successful-probe.mjs')
      await writeFile(
        probePath,
        [
          '#!/usr/bin/env node',
          `process.stderr.write('Duration: 00:01:02.50\\nStream #0:0: Video: vp9, yuv420p, 640x360\\nStream #0:1: Audio: opus\\n')`,
        ].join('\n'),
        'utf8',
      )
      await chmod(probePath, 0o755)
      const signal = new AbortController().signal

      await expect(probeMediaDuration('fixture.webm', probePath, signal))
        .resolves
        .toBe(62.5)
      await expect(probeVideoSize('fixture.webm', probePath, signal))
        .resolves
        .toEqual({ height: 360, width: 640 })
      await expect(probeMediaHasAudio('fixture.webm', probePath, signal))
        .resolves
        .toBe(true)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('cancels an in-flight media probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-probe-'))
    try {
      const probePath = join(directory, 'slow-probe.mjs')
      await writeFile(
        probePath,
        '#!/usr/bin/env node\nsetTimeout(() => {}, 30_000)\n',
        'utf8',
      )
      await chmod(probePath, 0o755)
      const controller = new AbortController()
      const probe = probeVideoSize('fixture.webm', probePath, controller.signal)
      await new Promise(resolve => setTimeout(resolve, 50))
      controller.abort()

      await expect(probe).rejects.toThrow(/cancel/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails to probe a file that is not media', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-probe-'))
    try {
      const notMedia = join(directory, 'notes.txt')
      await writeFile(notMedia, 'plain text')
      await expect(probeMediaDuration(notMedia))
        .rejects
        .toThrow(/could not probe media duration/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('crossfades ordered clips with a short transition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const second = await makeWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'crossfaded.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        outputPath,
        transitionDurationMs: 400,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.5)
      expect(result.durationSeconds).toBeLessThan(0.7)
      await expect(access(outputPath)).resolves.toBeUndefined()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('crossfades clips that carry audio with acrossfade', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeAudioWebmClip(directory, 'first.webm', 0.5)
      const second = await makeAudioWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'crossfaded-audio.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        outputPath,
        transitionDurationMs: 400,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.5)
      expect(result.durationSeconds).toBeLessThanOrEqual(0.8)
      await expect(probeMediaHasAudio(outputPath)).resolves.toBe(true)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('preserves audio when a transition mixes an audio clip with a silent clip', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const withAudio = await makeAudioWebmClip(directory, 'audio.webm', 0.8)
      const silent = await makeWebmClip(directory, 'silent.webm', 0.8)
      const outputPath = join(directory, 'crossfaded-mixed-audio.webm')

      const result = await composeVideoClips({
        clips: [withAudio, silent],
        outputPath,
        transitionDurationMs: 200,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(1.2)
      expect(result.durationSeconds).toBeLessThan(1.6)
      await expect(probeMediaHasAudio(outputPath)).resolves.toBe(true)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects a transition that is not shorter than every clip', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const second = await makeWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'crossfaded.webm')

      await expect(composeVideoClips({
        clips: [first, second],
        outputPath,
        transitionDurationMs: 600,
      })).rejects.toThrow(/shorter than every clip/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects a negative transition duration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const outputPath = join(directory, 'crossfaded.webm')

      await expect(composeVideoClips({
        clips: [first],
        outputPath,
        transitionDurationMs: -1,
      })).rejects.toThrow(/must not be negative/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('keeps the fast copy path for a single clip even with a transition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const outputPath = join(directory, 'single.webm')

      const result = await composeVideoClips({
        clips: [first],
        outputPath,
        transitionDurationMs: 400,
      })

      expect(result.reencoded).toBe(false)
      expect(result.durationSeconds).toBeGreaterThan(0.4)
      expect(result.durationSeconds).toBeLessThan(0.6)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('combines transition with target size scaling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeWebmClip(directory, 'first.webm', 0.5)
      const second = await makeWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'crossfaded-sized.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        outputPath,
        outputSize: { height: 480, width: 640 },
        transitionDurationMs: 400,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.5)
      expect(result.durationSeconds).toBeLessThan(0.7)
      await expect(probeVideoSize(outputPath)).resolves.toEqual({
        height: 480,
        width: 640,
      })
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('normalizes loudness while crossfading audio clips', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const first = await makeAudioWebmClip(directory, 'first.webm', 0.5)
      const second = await makeAudioWebmClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'crossfaded-loud.webm')

      const result = await composeVideoClips({
        clips: [first, second],
        normalizeLoudness: true,
        outputPath,
        transitionDurationMs: 400,
      })

      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.5)
      expect(result.durationSeconds).toBeLessThan(0.7)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('probes whether media files carry audio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-'))
    try {
      const silent = await makeWebmClip(directory, 'silent.webm', 0.5)
      const withAudio = await makeAudioWebmClip(directory, 'audio.webm', 0.5)
      const notMedia = join(directory, 'notes.txt')
      await writeFile(notMedia, 'plain text')

      await expect(probeMediaHasAudio(silent)).resolves.toBe(false)
      await expect(probeMediaHasAudio(withAudio)).resolves.toBe(true)
      await expect(probeMediaHasAudio(notMedia)).resolves.toBe(false)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
