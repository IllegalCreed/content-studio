import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { composeVideoClips } from './compose'
import {
  probeMediaDuration,
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
})
