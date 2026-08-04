import type { RecorderAttemptReceipt } from '../types'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createRecorderArtifact,
  prepareAttemptDirectory,
  writeRecorderReceipt,
} from './artifacts'

describe('recorder artifact persistence', () => {
  it('creates isolated attempt directories without overwriting evidence', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-artifacts-'),
    )
    const outputDirectory = join(temporaryDirectory, 'recording-job')

    try {
      await expect(
        prepareAttemptDirectory(outputDirectory, 1),
      ).resolves.toBe(join(outputDirectory, 'attempt-1'))
      await expect(
        prepareAttemptDirectory(outputDirectory, 1),
      ).rejects.toThrow(/already exists/i)
      await expect(
        prepareAttemptDirectory(outputDirectory, 0),
      ).rejects.toThrow(/positive integer/i)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('hashes an artifact and writes a machine-readable receipt atomically', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-artifacts-'),
    )
    const outputDirectory = join(temporaryDirectory, 'recording-job')
    const artifactDirectory = join(outputDirectory, 'attempt-1')

    try {
      await prepareAttemptDirectory(outputDirectory, 1)
      const previewPath = join(artifactDirectory, 'previews', 'preview.png')
      await mkdir(join(artifactDirectory, 'previews'))
      await writeFile(previewPath, 'preview', 'utf8')
      const artifact = await createRecorderArtifact(
        artifactDirectory,
        'previews/preview.png',
        'preview-frame',
        'preview-1',
      )
      const receipt: RecorderAttemptReceipt = {
        artifactDirectory,
        artifacts: [artifact],
        attempt: 1,
        campaignId: 'quick-sort-launch',
        completedActions: 1,
        completedScenes: 1,
        jobId: 'recording-job-1',
        logs: {
          consoleErrors: 0,
          consoleWarnings: 0,
          entries: [],
          pageErrors: 0,
        },
        outcome: 'succeeded',
        planSha256: 'plan-sha',
        projectId: 'algorithm-visualizer',
        recordingConfig: {
          colorScheme: 'dark',
          deviceScaleFactor: 1,
          locale: 'en',
          outputSize: { height: 1080, width: 1920 },
          viewport: { height: 1080, width: 1920 },
        },
        receiptVersion: 1,
        totalActions: 1,
        totalScenes: 1,
      }

      await writeRecorderReceipt(receipt)
      await expect(
        writeRecorderReceipt(receipt),
      ).rejects.toThrow(/already exists/i)

      expect(artifact).toMatchObject({
        kind: 'preview-frame',
        relativePath: 'previews/preview.png',
        sizeBytes: 7,
      })
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(
        JSON.parse(
          await readFile(join(artifactDirectory, 'receipt.json'), 'utf8'),
        ),
      ).toEqual(receipt)
      await expect(
        createRecorderArtifact(
          artifactDirectory,
          '../outside.png',
          'preview-frame',
          'unsafe',
        ),
      ).rejects.toThrow(/unsafe/i)

      await mkdir(join(artifactDirectory, 'previews', 'directory'))
      await expect(
        createRecorderArtifact(
          artifactDirectory,
          'previews/directory',
          'preview-frame',
          'directory',
        ),
      ).rejects.toThrow(/not a file/i)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })
})
