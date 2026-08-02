// @env node

import type {
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  RecorderAttemptReceipt,
} from '../types'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import {
  createContentStudioServer,
  parseCreateActivityInput,
  parseCreateChannelContentInput,
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

      const contentView = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      ).then(response => response.json())
      expect(contentView.contentGroups).toMatchObject([{ contentGroupId: 'group-a' }])
      expect(contentView.channelContents).toMatchObject([{ contentId: 'content-a' }])

      const taskResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect((await taskResponse.json()).tasks).toEqual([
        expect.objectContaining({
          activityId: 'activity-a',
          kind: 'production',
          status: 'queued',
          taskId: 'production-activity-a',
        }),
      ])
      expect((await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-activity-a/events`,
      ).then(response => response.json())).events).toEqual([
        expect.objectContaining({ kind: 'task-created', sequence: 1 }),
      ])
      const startResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-activity-a/start`,
        { method: 'POST' },
      )
      expect(startResponse.status).toBe(200)
      expect(await startResponse.json()).toMatchObject({ status: 'generating' })
      const cancelResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-activity-a/cancel`,
        { method: 'POST' },
      )
      expect(cancelResponse.status).toBe(200)
      expect(await cancelResponse.json()).toMatchObject({ status: 'cancelled' })
      const retryResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/tasks/production-activity-a/retry`,
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

  it('runs a stored activity video plan through the local recording route', async () => {
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
    let recordingInput: { outputDirectory: string, plan: unknown } | undefined
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-runtime-recording/attempt-1',
      artifacts: [],
      attempt: 1,
      campaignId: 'video-campaign',
      completedActions: 1,
      completedScenes: 1,
      jobId: 'production-video-activity',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'runtime-plan',
      projectId: project.projectId,
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const handle = createContentStudioServer({
      production: {
        record: async (input) => {
          recordingInput = {
            outputDirectory: input.outputDirectory,
            plan: input.plan,
          }
          return { attempts: [receipt], receipt }
        },
      },
      productionOutputRoot: '/tmp/content-studio-runtime-recording',
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
    const taskId = `production-${activity.activityId}`
    handle.service.startProductionTask(project.projectId, taskId)
    const running = await listen(handle.server)

    try {
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
        join('/tmp/content-studio-runtime-recording', project.projectId, taskId),
      )
      expect(recordingInput?.plan).toMatchObject({
        campaignId: 'video-campaign',
        scenes: [{ id: 'quick-sort' }],
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

  it('does not register the same project twice when a runtime is reopened', async () => {
    const { project, snapshot } = createProject()
    const repository = new InMemoryContentStudioRepository()
    const first = createContentStudioServer({ project, repository, snapshot })
    const second = createContentStudioServer({ project, repository, snapshot })

    await first.close()
    await second.close()
  })
})
