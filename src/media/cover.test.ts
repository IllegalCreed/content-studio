// @env node

import type { GenerateDeterministicCoverInput } from './cover'
import { execFile as execFileCallback, execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  generateDeterministicCover,
} from './cover'
import { resolveFfmpegPath } from './ffmpeg'

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
      'color=c=0x102850:s=320x240:d=0.2',
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

describe.skipIf(!ffmpegIsAvailable)('deterministic media covers', () => {
  it('embeds the first video frame and escaped title in a fixed-size SVG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-cover-'))
    try {
      const sourcePath = await makeClip(directory)
      const result = await generateDeterministicCover({
        outputPath: join(directory, 'nested', 'cover.svg'),
        outputSize: { height: 360, width: 640 },
        sourcePath,
        subtitle: 'local fallback',
        title: '<Quick & Sort>',
      })

      await expect(access(result.artifactPath)).resolves.toBeUndefined()
      expect(result).toMatchObject({
        height: 360,
        width: 640,
      })
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(result.sizeBytes).toBeGreaterThan(0)
      const svg = await readFile(result.artifactPath, 'utf8')
      expect(svg).toContain('width="640" height="360"')
      expect(svg).toContain('&lt;Quick &amp; Sort&gt;')
      expect(svg).toContain('data:image/png;base64,')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails closed when the source frame is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-cover-'))
    try {
      await expect(generateDeterministicCover({
        outputPath: join(directory, 'cover.svg'),
        outputSize: { height: 360, width: 640 },
        sourcePath: join(directory, 'missing.webm'),
        title: 'Missing source',
      })).rejects.toThrow(/source.*exist/i)
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('wraps encoder failures and removes temporary frame directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-cover-'))
    try {
      const sourcePath = await makeClip(directory)
      await expect(generateDeterministicCover({
        ffmpegPath: join(directory, 'missing-ffmpeg'),
        outputPath: join(directory, 'cover.svg'),
        outputSize: { height: 360, width: 640 },
        sourcePath,
        title: 'Encoder failure',
      })).rejects.toThrow(/generation failed/i)
      const entries = await readFile(join(directory, 'cover.svg'), 'utf8').catch(() => '')
      expect(entries).toBe('')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('wraps long titles and omits an absent subtitle deterministically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-cover-'))
    try {
      const sourcePath = await makeClip(directory)
      const controller = new AbortController()
      const result = await generateDeterministicCover({
        outputPath: join(directory, 'cover.svg'),
        outputSize: { height: 360, width: 640 },
        signal: controller.signal,
        sourcePath,
        title: `  ${'Long title '.repeat(8)}\n`,
      })
      const svg = await readFile(result.artifactPath, 'utf8')
      expect(svg).toContain('…')
      expect(svg).not.toContain('fill="#d7e3f4"')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

describe('deterministic media cover validation', () => {
  it.each([
    ['a fractional width', { outputSize: { height: 360, width: 1.5 } }, /width/i],
    ['a narrow width', { outputSize: { height: 360, width: 1 } }, /width/i],
    ['a fractional height', { outputSize: { height: 1.5, width: 640 } }, /height/i],
    ['a narrow height', { outputSize: { height: 1, width: 640 } }, /height/i],
    ['an empty source path', { sourcePath: ' ' }, /source.*empty/i],
    ['an empty output path', { outputPath: ' ' }, /output.*empty/i],
    ['an empty title', { title: ' ' }, /title.*empty/i],
  ] satisfies Array<[
    string,
    Partial<GenerateDeterministicCoverInput>,
    RegExp,
  ]>)('rejects %s before touching the filesystem', async (_name, override, message) => {
    await expect(generateDeterministicCover({
      outputPath: '/tmp/content-studio-cover-validation/cover.svg',
      outputSize: { height: 360, width: 640 },
      sourcePath: '/tmp/content-studio-cover-validation/source.webm',
      title: 'Valid title',
      ...override,
    })).rejects.toThrow(message)
  })

  it('honors a signal that was already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(generateDeterministicCover({
      outputPath: '/tmp/content-studio-cover-validation/cover.svg',
      outputSize: { height: 360, width: 640 },
      signal: controller.signal,
      sourcePath: '/tmp/content-studio-cover-validation/source.webm',
      title: 'Cancelled title',
    })).rejects.toThrow(/cancelled/i)
  })
})
