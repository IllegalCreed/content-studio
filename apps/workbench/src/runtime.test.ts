import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchRuntime } from './runtime'

describe('workbench runtime client', () => {
  it('reads health and a project view through the local application service', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contractVersion: 1,
        projectId: 'project-a',
        status: 'ready',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        activities: [],
        project: { projectId: 'project-a' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.health()).resolves.toEqual({
      contractVersion: 1,
      projectId: 'project-a',
      status: 'ready',
    })
    await expect(runtime.project('project-a')).resolves.toMatchObject({
      project: { projectId: 'project-a' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/health',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('reads a project-scoped cleanup preview without sending a path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        projectId: 'project-a',
        items: [],
        totals: { files: 0 },
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.storageCleanupPreview('project-a')).resolves.toMatchObject({
      projectId: 'project-a',
      items: [],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/storage/cleanup-preview',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('saves a project channel binding through the local runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        accountAlias: '项目视频账号',
        accountRef: 'account-youtube-main',
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: 'project-a',
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.saveProjectChannelBinding({
      accountAlias: '项目视频账号',
      accountRef: 'account-youtube-main',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })).resolves.toMatchObject({ channel: 'youtube', enabled: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/channel-bindings/youtube',
      expect.objectContaining({
        body: JSON.stringify({
          accountAlias: '项目视频账号',
          accountRef: 'account-youtube-main',
          channel: 'youtube',
          delivery: 'owner-assisted',
          enabled: true,
          projectId: 'project-a',
        }),
        method: 'POST',
      }),
    )
  })

  it('turns a non-success response into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'blocked' }), { status: 403 }),
    ))

    await expect(createWorkbenchRuntime().health()).rejects.toThrow(
      'Runtime request failed (403): blocked',
    )
  })

  it('sends task start, recording, cancellation, retry and event requests to the local runtime', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'generating' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: { status: 'composing' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attempt: 2, status: 'queued' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.startTask('project-a', 'task-a')).resolves.toMatchObject({ status: 'generating' })
    await expect(runtime.recordTask(
      'project-a',
      'task-a',
      {
        baseUrl: 'https://project-a.example.com',
        projectOrigin: 'https://project-a.example.com',
      },
    )).resolves.toMatchObject({ task: { status: 'composing' } })
    await expect(runtime.cancelTask('project-a', 'task-a')).resolves.toMatchObject({ status: 'cancelled' })
    await expect(runtime.retryTask('project-a', 'task-a')).resolves.toMatchObject({ attempt: 2 })
    await expect(runtime.taskEvents('project-a', 'task-a')).resolves.toEqual([])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/tasks/task-a/start',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-a/tasks/task-a/record',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-a/tasks/task-a/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('saves a content group and channel content through scoped routes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ contentGroupId: 'group-a' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ contentId: 'content-a' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await runtime.createContentGroup({
      activityId: 'activity-a',
      contentGroupId: 'group-a',
      coreMessage: 'Explain partitioning.',
      projectId: 'project-a',
      title: 'Algorithm explanation',
    })
    await runtime.createChannelContent({
      activityId: 'activity-a',
      artifactIds: [],
      body: 'A short article.',
      channel: 'github',
      contentGroupId: 'group-a',
      contentId: 'content-a',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'Partitioning explained',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/activities/activity-a/content-groups',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-a/activities/activity-a/content-groups/group-a/contents',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('registers an activity artifact and promotes it only through explicit runtime calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactId: 'artifact-a' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assetId: 'asset-a' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await runtime.createActivityArtifact({
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: '.content-studio/activity-a/clip.webm',
      sha256: 'a'.repeat(64),
    })
    await runtime.promoteActivityArtifact({
      artifactId: 'artifact-a',
      assetId: 'asset-a',
      kind: 'video',
      projectId: 'project-a',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/activities/activity-a/artifacts',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-a/activity-artifacts/artifact-a/promote',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('confirms an activity video plan with optimistic concurrency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        version: 2,
        videoPlanReviewStatus: 'confirmed',
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    const result = await runtime.confirmActivityVideoPlan('project-a', 'activity-a', 1)
    expect(result).toMatchObject({ videoPlanReviewStatus: 'confirmed' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/activities/activity-a/video-plan/confirm',
      expect.objectContaining({
        body: JSON.stringify({ baseVersion: 1 }),
        method: 'POST',
      }),
    )
  })
})
