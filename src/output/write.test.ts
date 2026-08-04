import type { StudioBundle } from '../types'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeStudioBundle } from './write'

const bundle: StudioBundle = {
  bundleVersion: 1,
  campaignId: 'quick-sort-launch',
  projectId: 'algorithm-visualizer',
  contentPackages: [
    {
      body: 'Understand quick sort.\n\nhttps://algo.illegalscreed.cn/quick-sort/',
      campaignId: 'quick-sort-launch',
      channel: 'youtube',
      delivery: 'owner-assisted',
      format: 'video-metadata',
      locale: 'en',
      tags: ['#algorithms'],
      targetUrl: 'https://algo.illegalscreed.cn/quick-sort/',
      title: 'Understand quick sort',
    },
  ],
  videoPlan: {
    campaignId: 'quick-sort-launch',
    durationMs: 2000,
    format: 'landscape',
    recordingConfig: {
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      locale: 'en',
      outputSize: { height: 1080, width: 1920 },
      viewport: { height: 1080, width: 1920 },
    },
    scenes: [],
  },
}

describe('bundle writer', () => {
  it('writes deterministic JSON and channel Markdown without deleting unknown files', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-'))
    const outputDirectory = join(temporaryDirectory, 'quick-sort-launch')

    try {
      const result = await writeStudioBundle(bundle, outputDirectory)
      const manifest = JSON.parse(
        await readFile(join(outputDirectory, 'bundle.json'), 'utf8'),
      )
      const content = await readFile(
        join(outputDirectory, 'content', 'youtube.en.md'),
        'utf8',
      )
      const video = JSON.parse(
        await readFile(join(outputDirectory, 'video', 'plan.json'), 'utf8'),
      )

      expect(result.files).toEqual([
        'bundle.json',
        'content/youtube.en.md',
        'video/plan.json',
      ])
      expect(manifest).toEqual(bundle)
      expect(content).toContain('# Understand quick sort')
      expect(content).toContain('Delivery: owner-assisted')
      expect(video).toEqual(bundle.videoPlan)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('rejects broad output targets before creating files', async () => {
    await expect(writeStudioBundle(bundle, '/')).rejects.toThrow(/unsafe/i)
    await expect(writeStudioBundle(bundle, ' ')).rejects.toThrow(/must not be empty/i)
  })

  it('omits the video directory when a campaign has no video plan', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-'))
    const outputDirectory = join(temporaryDirectory, 'text-only')

    try {
      const result = await writeStudioBundle(
        {
          ...bundle,
          videoPlan: null,
        },
        outputDirectory,
      )

      expect(result.files).toEqual([
        'bundle.json',
        'content/youtube.en.md',
      ])
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })
})
