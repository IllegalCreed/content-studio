import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  mkdtemp,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { resolveFfmpegPath } from '../media/ffmpeg'
import { composeProductionVideoClips } from './compose'

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

async function makeClip(
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

describe.skipIf(!ffmpegIsAvailable)('production video composition', () => {
  it('rejects an empty clip list', async () => {
    await expect(composeProductionVideoClips({
      clipPaths: [],
      outputPath: join('/tmp', 'content-studio-compose-prod', 'final.webm'),
    })).rejects.toThrow(/at least one clip/i)
  })

  it('composes recording clips into a final variant with a checksum', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-prod-'))
    try {
      const first = await makeClip(directory, 'first.webm', 0.5)
      const second = await makeClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'composed', 'final.webm')

      const result = await composeProductionVideoClips({
        clipPaths: [first, second],
        outputPath,
      })

      expect(result.artifactPath).toBe(outputPath)
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(result.sizeBytes).toBeGreaterThan(0)
      expect(result.reencoded).toBe(true)
      expect(result.durationSeconds).toBeGreaterThan(0.5)
      expect(result.durationSeconds).toBeLessThan(0.7)
      await expect(access(outputPath)).resolves.toBeUndefined()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('composes without a transition when explicitly disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-prod-'))
    try {
      const first = await makeClip(directory, 'first.webm', 0.5)
      const second = await makeClip(directory, 'second.webm', 0.5)
      const outputPath = join(directory, 'composed', 'final.webm')

      const result = await composeProductionVideoClips({
        clipPaths: [first, second],
        outputPath,
        transitionDurationMs: 0,
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

  it('creates a deterministic cover alongside the final video', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-compose-prod-'))
    try {
      const source = await makeClip(directory, 'source.webm', 0.5)
      const outputPath = join(directory, 'composed', 'final.webm')
      const coverPath = join(directory, 'composed', 'cover.svg')
      const gifPath = join(directory, 'composed', 'preview.gif')

      const result = await composeProductionVideoClips({
        clipPaths: [source],
        cover: {
          outputPath: coverPath,
          subtitle: 'local fallback',
          title: 'Quick Sort',
        },
        gif: {
          durationSeconds: 0.4,
          fps: 8,
          outputPath: gifPath,
          outputSize: { height: 120, width: 160 },
        },
        outputPath,
        outputSize: { height: 240, width: 320 },
      })

      expect(result.cover).toMatchObject({
        artifactPath: coverPath,
        height: 240,
        width: 320,
      })
      await expect(access(coverPath)).resolves.toBeUndefined()
      expect(result.gif).toMatchObject({
        artifactPath: gifPath,
        fps: 8,
        height: 120,
        width: 160,
      })
      await expect(access(gifPath)).resolves.toBeUndefined()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
