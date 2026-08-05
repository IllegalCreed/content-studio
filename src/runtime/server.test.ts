// @env node

import type {
  PlaywrightRecordingOptions,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  RecorderAttemptReceipt,
} from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import { createAttachedPreviewAdapter } from '../recording/preview'
import {
  createContentStudioServer,
  parseCreateActivityArtifactInput,
  parseCreateActivityInput,
  parseCreateChannelContentInput,
  parseCreateOwnerHandoffInput,
  parsePromoteActivityArtifactInput,
  parseRecordMonitoringObservationInput,
  parseRecordPublicationReceiptInput,
  parseReviseActivityInput,
  parseUpdateProjectChannelBindingInput,
} from './server'

function createProject(projectId = 'project-a'): {
  project: ProjectRecord
  snapshot: ProjectSnapshot
} {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: projectId,
      projectId,
      repositoryUrl: `https://github.com/example/${projectId}`,
      schemaVersion: 1,
      tagline: {
        'en': projectId,
        'zh-CN': projectId,
      },
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  return {
    project: {
      captureMode: 'deterministic',
      currentSnapshotId: snapshot.snapshotId,
      name: projectId,
      projectId,
      repeatability: 'high',
      sourceAccess: 'source-owned',
    },
    snapshot,
  }
}

async function listen(server: ReturnType<typeof createContentStudioServer>['server']): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('Expected a TCP server address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

describe('content studio local application server', () => {
  it('requires a locally registered adapter for an adapter-enabled project', () => {
    const { project, snapshot: baseSnapshot } = createProject()
    const snapshot: ProjectSnapshot = {
      ...baseSnapshot,
      manifest: {
        ...baseSnapshot.manifest,
        adapterId: 'attached-preview',
      },
    }
    expect(() => createContentStudioServer({
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })).toThrow(/requires registered preview adapter/i)
  })

  it('parses an optional activity video plan without accepting arbitrary fields', () => {
    expect(parseCreateActivityInput({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'project-a-snapshot-1',
      status: 'draft',
      targetUrl: 'https://project-a.example.com/guide',
      topic: {
        'en': 'A guide',
        'zh-CN': '一篇指南',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 2,
        recordingProfile: {
          defaults: {
            colorScheme: 'light',
            deviceScaleFactor: 2,
            locale: 'en',
            viewport: { height: 768, width: 1366 },
          },
          channelVariants: {
            github: {
              outputSize: { height: 1080, width: 1920 },
            },
          },
        },
        outline: [{
          flowId: 'quick-sort',
          objective: {
            'en': 'Show the partition step',
            'zh-CN': '展示分区步骤',
          },
          title: {
            'en': 'Partition the array',
            'zh-CN': '数组分区',
          },
        }],
      },
    }, 'project-a')).toMatchObject({
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 2,
        recordingProfile: {
          defaults: {
            colorScheme: 'light',
            deviceScaleFactor: 2,
            locale: 'en',
            viewport: { height: 768, width: 1366 },
          },
          channelVariants: {
            github: {
              outputSize: { height: 1080, width: 1920 },
            },
          },
        },
        outline: [{ flowId: 'quick-sort' }],
      },
    })

    expect(() => parseCreateActivityInput({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'project-a-snapshot-1',
      status: 'draft',
      targetUrl: 'https://project-a.example.com/guide',
      topic: {
        'en': 'A guide',
        'zh-CN': '一篇指南',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'wide',
      },
    }, 'project-a')).toThrow(/video format/i)

    expect(() => parseCreateActivityInput({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'project-a-snapshot-1',
      status: 'draft',
      targetUrl: 'https://project-a.example.com/guide',
      topic: {
        'en': 'A guide',
        'zh-CN': '一篇指南',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          defaults: {
            viewport: {
              height: 100,
              width: 10_000,
            },
          },
        },
      },
    }, 'project-a')).toThrow(/viewport/i)

    expect(() => parseCreateActivityInput({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'project-a-snapshot-1',
      status: 'draft',
      targetUrl: 'https://project-a.example.com/guide',
      topic: {
        'en': 'A guide',
        'zh-CN': '一篇指南',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        browserArgs: ['--ignore-certificate-errors'],
      },
    }, 'project-a')).toThrow(/unsupported field/i)
  })

  it('parses a video plan revision with a custom viewport', () => {
    expect(parseReviseActivityInput({
      activityId: 'activity-a',
      baseVersion: 1,
      projectId: 'project-a',
      topic: {
        'en': 'A revised guide',
        'zh-CN': '修订指南',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          defaults: {
            viewport: { height: 768, width: 1366 },
          },
        },
      },
    }, 'project-a', 'activity-a')).toMatchObject({
      baseVersion: 1,
      video: {
        recordingProfile: {
          defaults: {
            viewport: { height: 768, width: 1366 },
          },
        },
      },
    })
  })

  it('parses channel content artifact ids, defaulting to empty and rejecting duplicates', () => {
    const baseBody = {
      activityId: 'activity-a',
      body: 'A video script',
      channel: 'github',
      contentGroupId: 'group-a',
      contentId: 'content-a',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'A title',
    }

    // 缺省 artifactIds 默认为空数组
    expect(parseCreateChannelContentInput(baseBody, 'project-a', 'activity-a', 'group-a'))
      .toMatchObject({ artifactIds: [] })

    // 显式提供时透传
    expect(parseCreateChannelContentInput(
      { ...baseBody, artifactIds: ['artifact-a'] },
      'project-a',
      'activity-a',
      'group-a',
    )).toMatchObject({ artifactIds: ['artifact-a'] })

    // 非 kebab-case id 被拒
    expect(() => parseCreateChannelContentInput(
      { ...baseBody, artifactIds: ['Not Valid'] },
      'project-a',
      'activity-a',
      'group-a',
    )).toThrow(/kebab-case/i)

    // 重复 id 被拒
    expect(() => parseCreateChannelContentInput(
      { ...baseBody, artifactIds: ['artifact-a', 'artifact-a'] },
      'project-a',
      'activity-a',
      'group-a',
    )).toThrow(/Duplicate artifactId/i)
  })

  it('parses a project channel binding update without accepting credentials or unknown fields', () => {
    expect(parseUpdateProjectChannelBindingInput({
      accountAlias: '项目视频账号',
      accountRef: 'account-youtube-main',
      delivery: 'owner-assisted',
      enabled: true,
    }, 'project-a', 'youtube')).toEqual({
      accountAlias: '项目视频账号',
      accountRef: 'account-youtube-main',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })
    expect(parseUpdateProjectChannelBindingInput({
      delivery: 'content-only',
      enabled: false,
    }, 'project-a', 'youtube')).toEqual({
      channel: 'youtube',
      delivery: 'content-only',
      enabled: false,
      projectId: 'project-a',
    })
    expect(() => parseUpdateProjectChannelBindingInput({
      accountRef: 'not an opaque ref',
      delivery: 'owner-assisted',
      enabled: true,
    }, 'project-a', 'youtube')).toThrow(/opaque/i)
    expect(() => parseUpdateProjectChannelBindingInput({
      accountAlias: '\u0001',
      delivery: 'owner-assisted',
      enabled: true,
    }, 'project-a', 'youtube')).toThrow(/control characters/i)
    expect(() => parseUpdateProjectChannelBindingInput({
      delivery: 'unsupported',
      enabled: true,
    }, 'project-a', 'youtube')).toThrow(/delivery/i)
    expect(() => parseUpdateProjectChannelBindingInput({
      delivery: 'owner-assisted',
      enabled: 'true',
    }, 'project-a', 'youtube')).toThrow(/boolean/i)
    expect(() => parseUpdateProjectChannelBindingInput({
      accountRef: 'account-youtube-main',
      delivery: 'owner-assisted',
      enabled: true,
      password: 'not-allowed',
    }, 'project-a', 'youtube')).toThrow(/sensitive/i)
    expect(() => parseUpdateProjectChannelBindingInput({
      delivery: 'owner-assisted',
      enabled: true,
      unknown: true,
    }, 'project-a', 'youtube')).toThrow(/unsupported/i)
  })

  it('parses a pending owner handoff without accepting unsafe or completed state', () => {
    const baseHandoff = {
      activityId: 'activity-a',
      artifactChecksums: ['a'.repeat(64)],
      channel: 'github',
      checklist: ['确认标题', '完成最终点击'],
      expiresAt: '2026-08-03T00:00:00.000Z',
      handoffId: 'handoff-a',
      officialTargetUrl: 'https://github.com/example/project/releases/new',
      projectId: 'project-a',
      publicationId: 'publication-a',
      status: 'pending',
    }

    expect(parseCreateOwnerHandoffInput(baseHandoff, 'project-a', 'activity-a'))
      .toMatchObject({ handoffId: 'handoff-a', status: 'pending' })
    expect(() => parseCreateOwnerHandoffInput({
      ...baseHandoff,
      artifactChecksums: ['duplicate', 'duplicate'],
    }, 'project-a', 'activity-a')).toThrow(/duplicates/i)
    expect(() => parseCreateOwnerHandoffInput({
      ...baseHandoff,
      status: 'completed',
    }, 'project-a', 'activity-a')).toThrow(/pending/i)
    expect(() => parseCreateOwnerHandoffInput({
      ...baseHandoff,
      officialTargetUrl: 'ftp://example.com/upload',
    }, 'project-a', 'activity-a')).toThrow(/URL/i)
  })

  it('parses publication receipts and monitoring observations with bounded fields', () => {
    const receipt = parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      publicUrl: 'https://github.com/example/project/releases/tag/v1',
      receiptId: 'receipt-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    }, 'project-a', 'activity-a', 'publication-a')
    expect(receipt).toMatchObject({ receiptId: 'receipt-a', status: 'published' })

    expect(() => parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      publicUrl: 'http://github.com/example/project/releases/tag/v1',
      receiptId: 'receipt-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/HTTPS/i)
    expect(parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a-failed',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a-failed',
      status: 'failed',
    }, 'project-a', 'activity-a', 'publication-a')).toMatchObject({
      status: 'failed',
    })
    expect(() => parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a-failed-owner',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a-failed-owner',
      source: 'owner-entered',
      status: 'failed',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/source/i)
    expect(() => parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'unknown',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/status/i)
    expect(() => parseRecordPublicationReceiptInput({
      activityId: 'activity-a',
      channel: 'github',
      externalReceiptId: 'release-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a',
      status: 'published',
      unsafe: true,
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/unsupported/i)

    const observation = parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: { comments: 2, favorites: null, views: 100 },
      observationId: 'observation-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'public',
    }, 'project-a', 'activity-a', 'publication-a')
    expect(observation).toMatchObject({ observationId: 'observation-a', source: 'public' })

    expect(() => parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: { views: -1 },
      observationId: 'observation-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'public',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/non-negative/i)
    expect(parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: {},
      observationId: 'observation-b',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'authorized-adapter',
    }, 'project-a', 'activity-a', 'publication-a')).toMatchObject({
      source: 'authorized-adapter',
    })
    expect(() => parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: { watchTime: 1 },
      observationId: 'observation-c',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'public',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/metric/i)
    expect(() => parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: 'not-a-date',
      metrics: {},
      observationId: 'observation-d',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'owner-entered',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/date-time/i)
    expect(() => parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: {},
      observationId: 'observation-e',
      projectId: 'project-a',
      publicationId: 'publication-a',
      source: 'private-api',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/source/i)
    expect(() => parseRecordMonitoringObservationInput({
      activityId: 'activity-a',
      channel: 'github',
      collectedAt: '2026-08-03T00:00:00.000Z',
      metrics: {},
      observationId: 'observation-f',
      projectId: 'project-a',
      publicationId: 'other-publication',
      source: 'owner-entered',
    }, 'project-a', 'activity-a', 'publication-a')).toThrow(/publicationId/i)
  })

  it('parses activity artifact registration and explicit project promotion', () => {
    const artifact = parseCreateActivityArtifactInput({
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: '.content-studio/activity-a/clip.webm',
      sha256: 'a'.repeat(64),
    }, 'project-a', 'activity-a')
    expect(artifact).toMatchObject({ artifactId: 'artifact-a', kind: 'video-clip' })
    expect(() => parseCreateActivityArtifactInput({
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: '../outside.webm',
      sha256: 'a'.repeat(64),
    }, 'project-a', 'activity-a')).toThrow(/relativePath/i)
    for (const relativePath of ['/absolute/clip.webm', 'C:/absolute/clip.webm', 'clip\u0000.webm']) {
      expect(() => parseCreateActivityArtifactInput({
        activityId: 'activity-a',
        artifactId: 'artifact-a',
        kind: 'video-clip',
        projectId: 'project-a',
        relativePath,
        sha256: 'a'.repeat(64),
      }, 'project-a', 'activity-a')).toThrow(/relativePath/i)
    }
    expect(() => parseCreateActivityArtifactInput({
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: 'unknown',
      projectId: 'project-a',
      relativePath: 'clip.webm',
      sha256: 'a'.repeat(64),
    }, 'project-a', 'activity-a')).toThrow(/kind/i)
    expect(() => parseCreateActivityArtifactInput({
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'clip.webm',
      sha256: 'not-a-digest',
    }, 'project-a', 'activity-a')).toThrow(/sha256/i)

    expect(parsePromoteActivityArtifactInput({
      artifactId: 'artifact-a',
      assetId: 'asset-a',
      kind: 'video',
      projectId: 'project-a',
    }, 'project-a', 'artifact-a')).toEqual({
      artifactId: 'artifact-a',
      assetId: 'asset-a',
      kind: 'video',
      projectId: 'project-a',
    })
    expect(() => parsePromoteActivityArtifactInput({
      artifactId: 'artifact-a',
      assetId: 'asset-a',
      kind: 'article-version',
      projectId: 'project-a',
    }, 'project-a', 'artifact-a')).toThrow(/kind/i)
  })

  it('serves a project-scoped view and creates an activity through the application service', async () => {
    const { project, snapshot } = createProject()
    const binding: ProjectChannelBinding = {
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: project.projectId,
    }
    const handle = createContentStudioServer({
      project,
      projectChannelBindings: [binding],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const healthResponse = await fetch(`${running.baseUrl}/api/v1/health`)
      expect(healthResponse.status).toBe(200)
      expect(await healthResponse.json()).toEqual({
        contractVersion: 1,
        projectId: 'project-a',
        status: 'ready',
      })

      const optionsResponse = await fetch(
        `${running.baseUrl}/api/v1/health`,
        { method: 'OPTIONS' },
      )
      expect(optionsResponse.status).toBe(204)
      const missingRouteResponse = await fetch(
        `${running.baseUrl}/not-an-api-route`,
      )
      expect(missingRouteResponse.status).toBe(404)
      const missingProjectResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-b`,
      )
      expect(missingProjectResponse.status).toBe(404)

      const beforeResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect(beforeResponse.status).toBe(200)
      expect((await beforeResponse.json()).activities).toEqual([])
      expect((await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      ).then(response => response.json())).tasks).toEqual([])

      const createResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            campaignId: 'campaign-a',
            channels: [{ id: 'github', locale: 'en' }],
            goal: 'education',
            projectId: 'project-a',
            projectSnapshotId: snapshot.snapshotId,
            status: 'draft',
            targetUrl: 'https://project-a.example.com/guide',
            topic: {
              'en': 'A guide',
              'zh-CN': '一篇指南',
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(createResponse.status).toBe(201)
      expect(await createResponse.json()).toMatchObject({
        activityId: 'activity-a',
        projectId: 'project-a',
        version: 1,
      })

      const groupResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/content-groups`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            contentGroupId: 'group-a',
            coreMessage: 'Explain the algorithm with a concrete example.',
            projectId: 'project-a',
            title: 'Algorithm explanation',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(groupResponse.status).toBe(201)
      expect(await groupResponse.json()).toMatchObject({ contentGroupId: 'group-a', version: 1 })

      const contentResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/content-groups/group-a/contents`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            body: 'A short explanation of partitioning.',
            channel: 'github',
            contentGroupId: 'group-a',
            contentId: 'content-a',
            format: 'article',
            locale: 'en',
            projectId: 'project-a',
            title: 'Partitioning explained',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(contentResponse.status).toBe(201)
      expect(await contentResponse.json()).toMatchObject({ contentId: 'content-a', version: 1 })

      const artifactResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/artifacts`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            artifactId: 'artifact-a',
            kind: 'video-clip',
            projectId: 'project-a',
            relativePath: '.content-studio/activity-a/clip.webm',
            sha256: 'a'.repeat(64),
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(artifactResponse.status).toBe(201)
      expect(await artifactResponse.json()).toMatchObject({
        activityId: 'activity-a',
        artifactId: 'artifact-a',
        version: 1,
      })

      const promoteResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activity-artifacts/artifact-a/promote`,
        {
          body: JSON.stringify({
            artifactId: 'artifact-a',
            assetId: 'asset-a',
            kind: 'video',
            projectId: 'project-a',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(promoteResponse.status).toBe(201)
      expect(await promoteResponse.json()).toMatchObject({
        assetId: 'asset-a',
        sourceArtifactId: 'artifact-a',
      })

      const publicationPlanResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/publication-plans`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            channel: 'github',
            contentId: 'content-a',
            projectId: 'project-a',
            publicationId: 'publication-a',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(publicationPlanResponse.status).toBe(201)
      expect(await publicationPlanResponse.json()).toMatchObject({
        activityId: 'activity-a',
        channel: 'github',
        contentId: 'content-a',
        publicationId: 'publication-a',
      })

      const handoffResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/owner-handoffs`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            artifactChecksums: ['a'.repeat(64)],
            channel: 'github',
            checklist: ['确认标题', '确认封面', '完成最终点击'],
            expiresAt: '2026-08-03T00:00:00.000Z',
            handoffId: 'handoff-a',
            officialTargetUrl: 'https://github.com/example/project/releases/new',
            projectId: 'project-a',
            publicationId: 'publication-a',
            status: 'pending',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(handoffResponse.status).toBe(201)
      expect(await handoffResponse.json()).toMatchObject({
        activityId: 'activity-a',
        channel: 'github',
        handoffId: 'handoff-a',
        publicationId: 'publication-a',
        status: 'pending',
      })

      const completeHandoffResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/owner-handoffs/handoff-a/complete`,
        { method: 'POST' },
      )
      expect(completeHandoffResponse.status).toBe(200)
      expect(await completeHandoffResponse.json()).toMatchObject({
        handoffId: 'handoff-a',
        status: 'completed',
      })

      const receiptResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/publication-plans/publication-a/receipts`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            channel: 'github',
            externalReceiptId: 'github-release-a',
            projectId: 'project-a',
            publicationId: 'publication-a',
            publicUrl: 'https://github.com/example/project/releases/tag/v1',
            receiptId: 'receipt-a',
            issuedAt: '2026-08-04T00:00:00.000Z',
            source: 'marketing-ops',
            status: 'published',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(receiptResponse.status).toBe(201)
      expect(await receiptResponse.json()).toMatchObject({
        publicationId: 'publication-a',
        receiptId: 'receipt-a',
        status: 'published',
      })

      const observationResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities/activity-a/publication-plans/publication-a/observations`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            channel: 'github',
            collectedAt: '2026-08-03T00:00:00.000Z',
            metrics: { comments: 2, likes: 10, views: 100 },
            observationId: 'observation-a',
            projectId: 'project-a',
            publicationId: 'publication-a',
            source: 'public',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(observationResponse.status).toBe(201)
      expect(await observationResponse.json()).toMatchObject({
        activityId: 'activity-a',
        observationId: 'observation-a',
        publicationId: 'publication-a',
      })

      const contentView = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      ).then(response => response.json())
      expect(contentView.contentGroups).toMatchObject([{ contentGroupId: 'group-a' }])
      expect(contentView.channelContents).toMatchObject([{ contentId: 'content-a' }])
      expect(contentView.activityArtifacts).toMatchObject([{ artifactId: 'artifact-a' }])
      expect(contentView.projectAssets).toMatchObject([{ assetId: 'asset-a' }])

      const taskResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect((await taskResponse.json()).tasks).toEqual([
        expect.objectContaining({
          activityId: 'activity-a',
          channel: 'github',
          contentId: 'content-a',
          kind: 'production',
          productionType: 'article',
          projectId: 'project-a',
          skipStages: [],
          status: 'queued',
          taskId: 'production-content-a',
        }),
        expect.objectContaining({
          activityId: 'activity-a',
          channel: 'github',
          contentId: 'content-a',
          kind: 'publication',
          status: 'published',
          taskId: 'publication-publication-a',
        }),
        expect.objectContaining({
          activityId: 'activity-a',
          channel: 'github',
          contentId: 'content-a',
          kind: 'monitoring',
          status: 'monitoring',
          taskId: 'monitoring-publication-a',
        }),
      ])
      expect((await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-content-a/events`,
      ).then(response => response.json())).events).toEqual([
        expect.objectContaining({ kind: 'task-created', sequence: 1 }),
      ])
      const startResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-content-a/start`,
        { method: 'POST' },
      )
      expect(startResponse.status).toBe(200)
      expect(await startResponse.json()).toMatchObject({ status: 'generating' })
      const cancelResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-content-a/cancel`,
        { method: 'POST' },
      )
      expect(cancelResponse.status).toBe(200)
      expect(await cancelResponse.json()).toMatchObject({ status: 'cancelled' })
      const retryResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-content-a/retry`,
        { method: 'POST' },
      )
      expect(retryResponse.status).toBe(200)
      expect(await retryResponse.json()).toMatchObject({ attempt: 2, status: 'queued' })

      const conflictResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            campaignId: 'campaign-a',
            channels: [{ id: 'github', locale: 'en' }],
            goal: 'education',
            projectId: 'project-a',
            projectSnapshotId: snapshot.snapshotId,
            status: 'draft',
            targetUrl: 'https://project-a.example.com/guide',
            topic: {
              'en': 'A guide',
              'zh-CN': '一篇指南',
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(conflictResponse.status).toBe(409)

      const afterResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect((await afterResponse.json()).activities).toHaveLength(1)
    }
    finally {
      await running.close()
    }
  })

  it('updates one project channel binding and returns the persisted projection', async () => {
    const { project, snapshot } = createProject()
    const binding: ProjectChannelBinding = {
      accountAlias: '主账号',
      accountRef: 'account-github-main',
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: project.projectId,
    }
    const handle = createContentStudioServer({
      project,
      projectChannelBindings: [binding],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const updateResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/channel-bindings/github`,
        {
          body: JSON.stringify({
            accountAlias: '文档账号',
            accountRef: 'account-github-docs',
            delivery: 'owner-assisted',
            enabled: false,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(updateResponse.status).toBe(200)
      expect(await updateResponse.json()).toEqual({
        accountAlias: '文档账号',
        accountRef: 'account-github-docs',
        channel: 'github',
        delivery: 'owner-assisted',
        enabled: false,
        projectId: 'project-a',
      })

      const projectResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect(projectResponse.status).toBe(200)
      expect((await projectResponse.json()).projectChannelBindings).toEqual([{
        accountAlias: '文档账号',
        accountRef: 'account-github-docs',
        channel: 'github',
        delivery: 'owner-assisted',
        enabled: false,
        projectId: 'project-a',
      }])
    }
    finally {
      await running.close()
      handle.close()
    }
  })

  it('runs a stored activity video plan through the local recording route', async () => {
    const { project, snapshot: baseSnapshot } = createProject()
    const snapshot: ProjectSnapshot = {
      ...baseSnapshot,
      manifest: {
        ...baseSnapshot.manifest,
        adapterId: 'attached-preview',
        captureFlows: [{
          id: 'quick-sort',
          startPath: '/quick-sort',
          steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
          title: {
            'en': 'Quick sort',
            'zh-CN': '快速排序',
          },
        }],
      },
    }
    let recordingInput: { baseUrl: string, outputDirectory: string, plan: unknown } | undefined
    let recordingOptions: PlaywrightRecordingOptions | undefined
    const productionOutputRoot = resolve('/tmp/content-studio-runtime-recording')
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: join(
        productionOutputRoot,
        project.projectId,
        'production-video-content',
        'attempt-1',
      ),
      artifacts: [{
        id: 'preview-1',
        kind: 'preview-frame',
        relativePath: 'previews/preview-1.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 7,
      }],
      attempt: 1,
      campaignId: 'video-campaign',
      completedActions: 1,
      completedScenes: 1,
      jobId: 'production-video-content',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'runtime-plan',
      projectId: project.projectId,
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: {
          height: 1080,
          width: 1920,
        },
        viewport: {
          height: 1080,
          width: 1920,
        },
      },
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const handle = createContentStudioServer({
      production: {
        record: async (input, options) => {
          recordingOptions = options
          recordingInput = {
            baseUrl: input.baseUrl,
            outputDirectory: input.outputDirectory,
            plan: input.plan,
          }
          return { attempts: [receipt], receipt }
        },
      },
      productionOutputRoot,
      projectPreviewAdapters: [{
        adapter: createAttachedPreviewAdapter('http://127.0.0.1:11000'),
        adapterId: 'attached-preview',
        adapterVersion: '1.0.0',
        ownerApproved: true,
        projectId: project.projectId,
      }],
      project,
      projectChannelBindings: [{
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: project.projectId,
      }],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const activity = handle.service.createActivity({
      activityId: 'video-activity',
      campaignId: 'video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://project-a.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const group = handle.service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'video-content-group',
      coreMessage: 'Explain quick sort.',
      projectId: project.projectId,
      title: 'Quick sort content',
    })
    const content = handle.service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Quick sort video content',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'video-content',
      format: 'video',
      locale: 'en',
      projectId: project.projectId,
      title: 'Quick sort video',
    })
    const taskId = `production-${content.contentId}`
    handle.service.startProductionTask(project.projectId, taskId)
    const running = await listen(handle.server)

    try {
      await mkdir(join(
        productionOutputRoot,
        project.projectId,
        taskId,
        'attempt-1',
        'previews',
      ), { recursive: true })
      await writeFile(join(
        productionOutputRoot,
        project.projectId,
        taskId,
        'attempt-1',
        'previews',
        'preview-1.png',
      ), 'preview')
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/record`,
        {
          body: JSON.stringify({
            baseUrl: 'https://project-a.example.com',
            projectOrigin: 'https://project-a.example.com',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        receipt: { outcome: 'succeeded' },
        task: { status: 'composing' },
      })
      expect(recordingInput?.outputDirectory).toBe(
        join(productionOutputRoot, project.projectId, taskId),
      )
      expect(recordingOptions?.headless).toBeUndefined()
      expect(recordingInput?.baseUrl).toBe('http://127.0.0.1:11000')
      expect(recordingInput?.plan).toMatchObject({
        campaignId: 'video-campaign',
        scenes: [{ id: 'quick-sort' }],
      })
      const artifactResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/recording-attempts/1/artifacts/preview-1`,
      )
      expect(artifactResponse.status).toBe(200)
      expect(artifactResponse.headers.get('content-type')).toBe('image/png')
      expect(await artifactResponse.text()).toBe('preview')
      const projectResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}`,
      )
      const projectView = await projectResponse.json() as {
        recordingReceipts: Array<Record<string, unknown>>
      }
      expect(projectView.recordingReceipts).toHaveLength(1)
      expect(projectView.recordingReceipts[0]).toMatchObject({
        attempt: 1,
        jobId: taskId,
      })
      expect(projectView.recordingReceipts[0]).not.toHaveProperty('artifactDirectory')
      const invalidAttemptResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/recording-attempts/0/artifacts/preview-1`,
      )
      expect(invalidAttemptResponse.status).toBe(400)
      const missingArtifactResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/recording-attempts/1/artifacts/missing`,
      )
      expect(missingArtifactResponse.status).toBe(404)
    }
    finally {
      await running.close()
      await rm(productionOutputRoot, { force: true, recursive: true })
    }
  })

  it('serves previews only for registered activity artifacts and project assets', async () => {
    const { project, snapshot } = createProject()
    const productionOutputRoot = '/tmp/content-studio-asset-preview'
    const artifactPath = join(
      productionOutputRoot,
      project.projectId,
      'activities/activity-a/article.md',
    )
    const assetPath = join(
      productionOutputRoot,
      project.projectId,
      'assets/logo.png',
    )
    await mkdir(join(productionOutputRoot, project.projectId, 'activities/activity-a'), { recursive: true })
    await mkdir(join(productionOutputRoot, project.projectId, 'assets'), { recursive: true })
    await writeFile(artifactPath, '# Preview article')
    await writeFile(assetPath, 'fake-png')
    const handle = createContentStudioServer({
      productionOutputRoot,
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    handle.service.createActivity({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: project.projectId === 'project-a'
        ? 'https://project-a.example.com'
        : 'https://project.example.com',
      topic: { 'en': 'Preview', 'zh-CN': '预览' },
    })
    handle.service.createActivityArtifact({
      activityId: 'activity-a',
      artifactId: 'article-artifact',
      kind: 'article-version',
      projectId: project.projectId,
      relativePath: 'activities/activity-a/article.md',
      sha256: 'a'.repeat(64),
    })
    handle.repository.saveProjectAsset({
      assetId: 'logo-asset',
      kind: 'logo',
      projectId: project.projectId,
      relativePath: 'assets/logo.png',
      sha256: 'b'.repeat(64),
      version: 1,
    })
    const running = await listen(handle.server)

    try {
      const artifactResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/activity-artifacts/article-artifact/preview`,
      )
      expect(artifactResponse.status).toBe(200)
      expect(artifactResponse.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
      expect(await artifactResponse.text()).toBe('# Preview article')
      expect(artifactResponse.headers.get('x-content-studio-sha256')).toBe('a'.repeat(64))

      const assetResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/project-assets/logo-asset/preview`,
      )
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('content-type')).toBe('image/png')
      expect(await assetResponse.text()).toBe('fake-png')

      const missingResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/project-assets/unknown/preview`,
      )
      expect(missingResponse.status).toBe(404)
    }
    finally {
      await running.close()
      await rm(productionOutputRoot, { force: true, recursive: true })
    }
  })

  it('pauses recording into awaiting-owner and resumes through the owner confirmation route', async () => {
    const { project, snapshot: baseSnapshot } = createProject('takeover-project')
    const snapshot: ProjectSnapshot = {
      ...baseSnapshot,
      manifest: {
        ...baseSnapshot.manifest,
        captureFlows: [{
          id: 'quick-sort',
          startPath: '/quick-sort',
          steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
          title: {
            'en': 'Quick sort',
            'zh-CN': '快速排序',
          },
        }],
        ownerTakeover: true,
        repeatability: 'conditional',
      },
    }
    const takeoverProject: ProjectRecord = {
      ...project,
      ownerTakeover: true,
      repeatability: 'conditional',
    }
    const productionOutputRoot = resolve('/tmp/content-studio-runtime-owner-takeover')
    let capturedOptions: PlaywrightRecordingOptions | undefined
    let notifyTakeoverRequested!: () => void
    const takeoverRequested = new Promise<void>((resolve) => {
      notifyTakeoverRequested = resolve
    })
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: join(
        productionOutputRoot,
        project.projectId,
        'production-takeover-content',
        'attempt-1',
      ),
      artifacts: [],
      attempt: 1,
      campaignId: 'takeover-campaign',
      completedActions: 1,
      completedScenes: 1,
      jobId: 'production-takeover-content',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'runtime-takeover-plan',
      projectId: project.projectId,
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: {
          height: 1080,
          width: 1920,
        },
        viewport: {
          height: 1080,
          width: 1920,
        },
      },
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const handle = createContentStudioServer({
      production: {
        record: async (input, options) => {
          capturedOptions = options
          const pending = options?.ownerTakeover?.request({
            jobId: input.jobId,
            pageUrl: 'https://takeover-project.example.com/login',
            projectId: input.projectId,
          })
          notifyTakeoverRequested()
          await pending
          return { attempts: [receipt], receipt }
        },
      },
      productionOutputRoot,
      project: takeoverProject,
      projectChannelBindings: [{
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: project.projectId,
      }],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const activity = handle.service.createActivity({
      activityId: 'takeover-activity',
      campaignId: 'takeover-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://takeover-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const group = handle.service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'takeover-content-group',
      coreMessage: 'Explain quick sort.',
      projectId: project.projectId,
      title: 'Quick sort content',
    })
    const content = handle.service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Quick sort video content',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'takeover-content',
      format: 'video',
      locale: 'en',
      projectId: project.projectId,
      title: 'Quick sort video',
    })
    const taskId = `production-${content.contentId}`
    handle.service.startProductionTask(project.projectId, taskId)
    const running = await listen(handle.server)

    try {
      const recordResponsePromise = fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/record`,
        {
          body: JSON.stringify({
            baseUrl: 'https://takeover-project.example.com',
            projectOrigin: 'https://takeover-project.example.com',
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      await takeoverRequested
      expect(capturedOptions?.ownerTakeover).toBeDefined()
      expect(capturedOptions?.headless).toBe(false)

      const pausedView = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}`,
      ).then(response => response.json()) as {
        tasks: Array<{ status: string, taskId: string }>
      }
      expect(pausedView.tasks.find(task => task.taskId === taskId)?.status)
        .toBe('awaiting-owner')

      const confirmResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/owner-confirm`,
        { method: 'POST' },
      )
      expect(confirmResponse.status).toBe(200)
      expect(await confirmResponse.json()).toMatchObject({
        ownerTakeover: {
          confirmedAt: expect.any(String),
          requestedAt: expect.any(String),
        },
        projectId: project.projectId,
        taskId,
      })

      const recordResponse = await recordResponsePromise
      expect(recordResponse.status).toBe(200)
      expect(await recordResponse.json()).toMatchObject({
        task: { status: 'composing' },
      })
    }
    finally {
      await running.close()
      await rm(productionOutputRoot, { force: true, recursive: true })
    }
  }, 15_000)

  it('rejects an owner confirmation when no takeover is pending', async () => {
    const { project, snapshot } = createProject()
    const handle = createContentStudioServer({
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)
    try {
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/missing-task/owner-confirm`,
        { method: 'POST' },
      )
      expect(response.status).toBe(409)
    }
    finally {
      await running.close()
    }
  })

  it('returns a cleanup preview for registered files without scanning unknown files', async () => {
    const { project, snapshot } = createProject('cleanup-preview-project')
    const cleanupRoot = '/tmp/content-studio-cleanup-preview'
    const productionOutputRoot = join(cleanupRoot, 'production')
    await rm(cleanupRoot, { force: true, recursive: true })
    const activityRoot = join(productionOutputRoot, project.projectId, 'activity-a')
    const assetRoot = join(productionOutputRoot, project.projectId, 'assets')
    await mkdir(activityRoot, { recursive: true })
    await mkdir(assetRoot, { recursive: true })
    await writeFile(join(activityRoot, 'draft.md'), 'draft')
    await writeFile(join(assetRoot, 'logo.png'), 'logo-file')
    await writeFile(join(productionOutputRoot, project.projectId, 'unknown.bin'), 'unknown')
    const handle = createContentStudioServer({
      productionOutputRoot,
      project,
      projectChannelBindings: [{
        channel: 'github',
        delivery: 'content-only',
        enabled: true,
        projectId: project.projectId,
      }],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    handle.service.createActivity({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://project-a.example.com',
      topic: { 'en': 'Cleanup', 'zh-CN': '清理' },
    })
    handle.service.createActivityArtifact({
      activityId: 'activity-a',
      artifactId: 'draft-artifact',
      kind: 'article-version',
      projectId: project.projectId,
      relativePath: 'activity-a/draft.md',
      sha256: 'a'.repeat(64),
    })
    handle.service.createActivityArtifact({
      activityId: 'activity-a',
      artifactId: 'missing-artifact',
      kind: 'preview-frame',
      projectId: project.projectId,
      relativePath: 'activity-a/missing.png',
      sha256: 'b'.repeat(64),
    })
    handle.repository.saveProjectAsset({
      assetId: 'logo-asset',
      kind: 'logo',
      projectId: project.projectId,
      relativePath: 'assets/logo.png',
      sha256: 'c'.repeat(64),
      version: 1,
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/cleanup-preview`,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(expect.objectContaining({
        projectId: project.projectId,
        retentionPolicy: {
          activityArtifactDays: 30,
          rebuildableCacheDays: 7,
          recycleRecoveryDays: 30,
        },
        totals: {
          files: 3,
          missingFiles: 1,
          protectedBytes: 9,
          protectedFiles: 1,
          recycledBytes: 0,
          recycledFiles: 0,
          reviewBytes: 5,
          reviewFiles: 1,
          totalBytes: 14,
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            id: 'draft-artifact',
            retentionClass: 'activity-artifact',
            sizeBytes: 5,
            status: 'review',
          }),
          expect.objectContaining({
            id: 'missing-artifact',
            retentionClass: 'rebuildable-cache',
            status: 'missing',
          }),
          expect.objectContaining({
            id: 'logo-asset',
            sizeBytes: 9,
            status: 'protected',
          }),
        ]),
      }))
    }
    finally {
      await running.close()
      await rm(cleanupRoot, { force: true, recursive: true })
    }
  })

  it('requires a fresh preview before moving an activity artifact to the recycle area', async () => {
    const { project, snapshot } = createProject('cleanup-confirm-project')
    const cleanupRoot = `/tmp/content-studio-cleanup-confirm-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const productionOutputRoot = join(cleanupRoot, 'production')
    const relativePath = 'activity-a/draft.md'
    const content = '# recyclable draft'
    await mkdir(join(productionOutputRoot, project.projectId, 'activity-a'), { recursive: true })
    await writeFile(join(productionOutputRoot, project.projectId, relativePath), content)
    const handle = createContentStudioServer({
      productionOutputRoot,
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    handle.service.createActivity({
      activityId: 'activity-a',
      campaignId: 'campaign-a',
      channels: [],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://project-a.example.com',
      topic: { 'en': 'Cleanup', 'zh-CN': '清理' },
    })
    handle.service.createActivityArtifact({
      activityId: 'activity-a',
      artifactId: 'draft-artifact',
      kind: 'article-version',
      projectId: project.projectId,
      relativePath,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
    const running = await listen(handle.server)

    try {
      const previewResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/cleanup-preview`,
      )
      const preview = await previewResponse.json() as {
        items: Array<{ id: string, status: string }>
        previewId: string
      }
      expect(preview.items).toEqual([
        expect.objectContaining({ id: 'draft-artifact', status: 'review' }),
      ])

      const confirmResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/cleanup/confirm`,
        {
          body: JSON.stringify({
            itemIds: ['draft-artifact'],
            previewId: preview.previewId,
            projectId: project.projectId,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(confirmResponse.status).toBe(200)
      const result = await confirmResponse.json() as { recycled: Array<{ recycleId: string }> }
      expect(result.recycled).toHaveLength(1)
      await expect(stat(join(productionOutputRoot, project.projectId, relativePath))).rejects.toMatchObject({ code: 'ENOENT' })

      const recycledResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/recycle`,
      )
      expect(recycledResponse.status).toBe(200)
      const recycledPayload = await recycledResponse.json() as {
        entries: Array<{ itemId: string, recycleId: string }>
      }
      expect(recycledPayload).toMatchObject({
        entries: [expect.objectContaining({ itemId: 'draft-artifact' })],
      })

      const staleResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/cleanup/confirm`,
        {
          body: JSON.stringify({
            itemIds: ['draft-artifact'],
            previewId: preview.previewId,
            projectId: project.projectId,
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(staleResponse.status).toBe(409)

      const restoreResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/recycle/${recycledPayload.entries[0]!.recycleId}/restore`,
        { method: 'POST' },
      )
      expect(restoreResponse.status).toBe(200)
      await expect(readFile(join(productionOutputRoot, project.projectId, relativePath))).resolves.toEqual(Buffer.from(content))
      const emptyRecycleResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/storage/recycle`,
      )
      expect(emptyRecycleResponse.status).toBe(200)
      expect(await emptyRecycleResponse.json()).toMatchObject({ entries: [] })
    }
    finally {
      await running.close()
      await rm(cleanupRoot, { force: true, recursive: true })
    }
  })

  it('confirms a stored activity video plan through the local runtime', async () => {
    const { project, snapshot: baseSnapshot } = createProject()
    const snapshot: ProjectSnapshot = {
      ...baseSnapshot,
      manifest: {
        ...baseSnapshot.manifest,
        captureFlows: [{
          id: 'quick-sort',
          startPath: '/quick-sort',
          steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
          title: {
            'en': 'Quick sort',
            'zh-CN': '快速排序',
          },
        }],
      },
    }
    const handle = createContentStudioServer({
      project,
      projectChannelBindings: [{
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: project.projectId,
      }],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const activity = handle.service.createActivity({
      activityId: 'video-activity',
      campaignId: 'video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://project-a.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        outline: [{
          flowId: 'quick-sort',
          objective: {
            'en': 'Show the partition step',
            'zh-CN': '展示分区步骤',
          },
          title: {
            'en': 'Partition the array',
            'zh-CN': '数组分区',
          },
        }],
        planVersion: 2,
      },
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/activities/${activity.activityId}/video-plan/confirm`,
        {
          body: JSON.stringify({ baseVersion: activity.version }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        version: 2,
        videoPlanReviewStatus: 'confirmed',
      })

      const reviseResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/activities/${activity.activityId}/revise`,
        {
          body: JSON.stringify({
            activityId: activity.activityId,
            baseVersion: 2,
            projectId: project.projectId,
            topic: activity.topic,
            video: {
              flowIds: ['quick-sort'],
              format: 'landscape',
              recordingProfile: {
                defaults: {
                  viewport: { height: 768, width: 1366 },
                },
              },
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(reviseResponse.status).toBe(200)
      expect(await reviseResponse.json()).toMatchObject({
        version: 3,
        video: {
          recordingProfile: {
            defaults: {
              viewport: { height: 768, width: 1366 },
            },
          },
        },
        videoPlanReviewStatus: 'pending',
      })
    }
    finally {
      await running.close()
    }
  })

  it('rejects a body that attempts to carry credentials', async () => {
    const { project, snapshot } = createProject()
    const handle = createContentStudioServer({
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({ password: 'never-accept-this' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Sensitive field')

      const malformedResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: '{',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(malformedResponse.status).toBe(400)
      expect(await malformedResponse.text()).toContain('valid JSON')

      const emptyResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        { method: 'POST' },
      )
      expect(emptyResponse.status).toBe(400)
      expect(await emptyResponse.text()).toContain('must be JSON')
    }
    finally {
      await running.close()
    }
  })

  it('schedules a video task from start and aborts it through cancel', async () => {
    const { project, snapshot: baseSnapshot } = createProject()
    const snapshot: ProjectSnapshot = {
      ...baseSnapshot,
      manifest: {
        ...baseSnapshot.manifest,
        captureFlows: [{
          id: 'quick-sort',
          startPath: '/quick-sort',
          steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
          title: {
            'en': 'Quick sort',
            'zh-CN': '快速排序',
          },
        }],
      },
    }
    let recordingSignal: AbortSignal | undefined
    let resolveRecording: ((result: {
      attempts: RecorderAttemptReceipt[]
      receipt: RecorderAttemptReceipt
    }) => void) | undefined
    const handle = createContentStudioServer({
      production: {
        record: async (input) => {
          recordingSignal = input.signal
          return new Promise((resolve) => {
            resolveRecording = resolve
          })
        },
      },
      project,
      projectChannelBindings: [{
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: project.projectId,
      }],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const activity = handle.service.createActivity({
      activityId: 'worker-activity',
      campaignId: 'worker-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: project.projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://project-a.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const group = handle.service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'worker-content-group',
      coreMessage: 'Explain quick sort.',
      projectId: project.projectId,
      title: 'Quick sort content',
    })
    const content = handle.service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Quick sort video content',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'worker-video-content',
      format: 'video',
      locale: 'en',
      projectId: project.projectId,
      title: 'Quick sort video',
    })
    const taskId = `production-${content.contentId}`
    const running = await listen(handle.server)

    try {
      const startResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/start`,
        { method: 'POST' },
      )
      expect(startResponse.status).toBe(200)
      expect(await startResponse.json()).toMatchObject({ status: 'generating' })
      await vi.waitFor(() => expect(
        handle.service.getProjectView(project.projectId).tasks.find(task => task.taskId === taskId)?.status,
      ).toBe('recording'))
      expect(recordingSignal).toBeInstanceOf(AbortSignal)

      const cancelResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/${project.projectId}/tasks/${taskId}/cancel`,
        { method: 'POST' },
      )
      expect(cancelResponse.status).toBe(200)
      expect(await cancelResponse.json()).toMatchObject({ status: 'cancelled' })
      expect(recordingSignal?.aborted).toBe(true)
      const receipt: RecorderAttemptReceipt = {
        artifactDirectory: '/tmp/content-studio-worker/attempt-1',
        artifacts: [],
        attempt: 1,
        campaignId: activity.campaignId,
        completedActions: 0,
        completedScenes: 0,
        jobId: taskId,
        logs: {
          consoleErrors: 0,
          consoleWarnings: 0,
          entries: [],
          pageErrors: 0,
        },
        outcome: 'cancelled',
        planSha256: 'worker-plan',
        projectId: project.projectId,
        recordingConfig: {
          colorScheme: 'dark',
          deviceScaleFactor: 1,
          locale: 'en',
          outputSize: {
            height: 1080,
            width: 1920,
          },
          viewport: {
            height: 1080,
            width: 1920,
          },
        },
        receiptVersion: 1,
        totalActions: 1,
        totalScenes: 1,
      }
      resolveRecording?.({ attempts: [receipt], receipt })
      await handle.worker.waitForIdle()
      expect(handle.service.getProjectView(project.projectId).tasks).toContainEqual(
        expect.objectContaining({ status: 'cancelled', taskId }),
      )
    }
    finally {
      await handle.close()
    }
  })

  it('serves an explicit cross-project index without scanning the filesystem', async () => {
    const { project, snapshot } = createProject()
    const secondProject = createProject('project-b')
    const repository = new InMemoryContentStudioRepository()
    const handle = createContentStudioServer({
      additionalProjects: [{
        project: secondProject.project,
        snapshot: secondProject.snapshot,
      }],
      project,
      repository,
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(`${running.baseUrl}/api/v1/projects`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        projects: [
          {
            activityCount: 0,
            enabledChannels: [],
            previewReady: false,
            project: { projectId: 'project-a' },
            snapshotId: 'project-a-snapshot-1',
            snapshotVersion: 1,
            taskCount: 0,
          },
          {
            activityCount: 0,
            enabledChannels: [],
            previewReady: false,
            project: { projectId: 'project-b' },
            snapshotId: 'project-b-snapshot-1',
            snapshotVersion: 1,
            taskCount: 0,
          },
        ],
      })
    }
    finally {
      await handle.close()
    }
  })

  it('serves a sanitized cross-project execution view', async () => {
    const { project, snapshot } = createProject()
    const secondProject = createProject('project-b')
    const repository = new InMemoryContentStudioRepository()
    const handle = createContentStudioServer({
      additionalProjects: [{
        project: secondProject.project,
        projectChannelBindings: [{
          accountAlias: 'Project B video account',
          accountRef: 'opaque-account-ref',
          channel: 'youtube',
          delivery: 'owner-assisted',
          enabled: true,
          projectId: 'project-b',
        }],
        snapshot: secondProject.snapshot,
      }],
      project,
      repository,
      snapshot,
    })
    handle.taskStore.createTask({
      activityId: 'project-b-activity',
      channel: 'youtube',
      kind: 'publication',
      projectId: 'project-b',
      taskId: 'project-b-publication',
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(`${running.baseUrl}/api/v1/global`)
      expect(response.status).toBe(200)
      const payload = await response.json() as {
        projectViews: Array<{
          project: { projectId: string }
          projectChannelBindings: Array<Record<string, unknown>>
          tasks: Array<{ projectId: string, taskId: string }>
        }>
      }
      expect(payload.projectViews.map(view => view.project.projectId)).toEqual([
        'project-a',
        'project-b',
      ])
      expect(payload.projectViews[1]?.tasks).toEqual([{
        activityId: 'project-b-activity',
        attempt: 1,
        channel: 'youtube',
        kind: 'publication',
        projectId: 'project-b',
        skipStages: [],
        status: 'queued',
        taskId: 'project-b-publication',
      }])
      expect(payload.projectViews[1]?.projectChannelBindings[0]).toEqual({
        accountAlias: 'Project B video account',
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: 'project-b',
      })
      expect(payload.projectViews[1]?.projectChannelBindings[0]).not.toHaveProperty('accountRef')
    }
    finally {
      await handle.close()
    }
  })

  it('does not register the same project twice when a runtime is reopened', async () => {
    const { project, snapshot } = createProject()
    const repository = new InMemoryContentStudioRepository()
    const first = createContentStudioServer({ project, repository, snapshot })
    const second = createContentStudioServer({ project, repository, snapshot })

    await first.close()
    await second.close()
  })
})
