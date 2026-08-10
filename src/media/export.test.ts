import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { exportBilibiliVideo } from './export'
import { probeMediaDuration, resolveFfmpegPath } from './ffmpeg'

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

describe.skipIf(!ffmpegIsAvailable)('bilibili video export', () => {
  it('transcodes the local WebM composition to H.264/AAC MP4', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-export-'))
    try {
      const sourcePath = join(directory, 'source.webm')
      const outputPath = join(directory, 'bilibili.mp4')
      await execFile(resolveFfmpegPath(), [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=0.6:size=320x240:rate=10',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.6',
        '-c:v',
        'libvpx-vp9',
        '-c:a',
        'libopus',
        '-shortest',
        sourcePath,
      ], { maxBuffer: 4 * 1024 * 1024 })

      const result = await exportBilibiliVideo({ outputPath, sourcePath })

      expect(result).toMatchObject({ artifactPath: outputPath })
      expect(result.sizeBytes).toBeGreaterThan(0)
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(result.durationSeconds).toBeGreaterThan(0.4)
      await expect(access(outputPath)).resolves.toBeUndefined()
      const probe = await probeMediaDuration(outputPath)
      expect(probe).toBeGreaterThan(0.4)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails closed when the destination is not an MP4 file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-export-'))
    try {
      await expect(exportBilibiliVideo({
        outputPath: join(directory, 'bilibili.webm'),
        sourcePath: join(directory, 'missing.webm'),
      })).rejects.toThrow(/\.mp4/u)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('never overwrites an existing destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-export-'))
    try {
      const outputPath = join(directory, 'bilibili.mp4')
      await writeFile(outputPath, 'existing artifact', 'utf8')
      await expect(exportBilibiliVideo({
        outputPath,
        sourcePath: join(directory, 'missing.webm'),
      })).rejects.toThrow(/already exists/i)
      await expect(readFile(outputPath, 'utf8')).resolves.toBe('existing artifact')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

describe('bilibili video export validation', () => {
  it('rejects empty paths before touching ffmpeg', async () => {
    await expect(exportBilibiliVideo({
      outputPath: '',
      sourcePath: '/tmp/source.webm',
    })).rejects.toThrow(/output path/i)
  })

  it('rejects an empty source path before resolving a local file', async () => {
    await expect(exportBilibiliVideo({
      outputPath: '/tmp/content-studio-empty-source.mp4',
      sourcePath: '',
    })).rejects.toThrow(/source path/i)
  })

  it('rejects a source that aliases the upload destination', async () => {
    await expect(exportBilibiliVideo({
      outputPath: '/tmp/content-studio-same.mp4',
      sourcePath: '/tmp/content-studio-same.mp4',
    })).rejects.toThrow(/must differ/i)
  })

  it('fails closed when the controlled source artifact is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-export-'))
    try {
      await expect(exportBilibiliVideo({
        outputPath: join(directory, 'bilibili.mp4'),
        sourcePath: join(directory, 'missing.webm'),
      })).rejects.toThrow(/source is unavailable/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('stops before reading a path when the production task is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(exportBilibiliVideo({
      outputPath: '/tmp/content-studio-cancelled.mp4',
      signal: controller.signal,
      sourcePath: '/tmp/content-studio-cancelled.webm',
    })).rejects.toThrow(/cancelled/i)
  })

  it('sanitizes a controlled ffmpeg failure without exposing command output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-export-'))
    try {
      const sourcePath = join(directory, 'source.webm')
      await writeFile(sourcePath, 'not media', 'utf8')
      const controller = new AbortController()
      await expect(exportBilibiliVideo({
        ffmpegPath: process.execPath,
        outputPath: join(directory, 'bilibili.mp4'),
        signal: controller.signal,
        sourcePath,
      })).rejects.toThrow(/^Bilibili video export failed$/u)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
