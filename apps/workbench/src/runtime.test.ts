import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchRuntime } from './runtime'

describe('workbench runtime client', () => {
  it('registers a project through the runtime registry endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      captureMode: 'assisted',
      currentSnapshotId: 'imported-snapshot-1',
      name: 'Imported',
      projectId: 'imported',
      repeatability: 'low',
      sourceAccess: 'web-assisted',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWorkbenchRuntime('/api/v1').registerProject({
      canonicalUrl: 'https://imported.example.com/',
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: 'Imported',
      projectId: 'imported',
      repositoryUrl: 'https://github.com/example/imported',
      schemaVersion: 1,
      sourceAccess: 'web-assisted',
      captureMode: 'assisted',
      repeatability: 'low',
      tagline: {
        'en': 'Imported',
        'zh-CN': 'Imported',
      },
    })).resolves.toMatchObject({
      projectId: 'imported',
      sourceAccess: 'web-assisted',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/registry/projects',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('reads the sanitized cross-project execution view', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      projectViews: [],
      projects: [],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWorkbenchRuntime('/api/v1').global()).resolves.toEqual({
      projectViews: [],
      projects: [],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/global',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('reads the explicit cross-project index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      projects: [{
        activityCount: 2,
        enabledChannels: [],
        previewReady: true,
        project: { projectId: 'project-a' },
        snapshotId: 'project-a-snapshot-1',
        snapshotVersion: 1,
        taskCount: 3,
        taskCounts: { monitoring: 1, production: 1, publication: 1 },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWorkbenchRuntime('/api/v1').projects()).resolves.toMatchObject({
      projects: [{ project: { projectId: 'project-a' }, taskCount: 3 }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

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

  it('reads a project-scoped marketing-ops status snapshot without adding write inputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authorizesExternalWrite: false,
      channels: [{
        accountAlias: '@project-a',
        adapterReady: true,
        channel: 'github',
        health: 'ready',
        nextStep: 'ready',
      }],
      contractVersion: 3,
      expiresAt: '2026-08-10T00:01:00.000Z',
      observedAt: '2026-08-10T00:00:00.000Z',
      projectId: 'project-a',
      runtimeVersion: '0.2.0',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createWorkbenchRuntime('/api/v1').marketingOpsStatus('project-a'))
      .resolves
      .toMatchObject({
        authorizesExternalWrite: false,
        projectId: 'project-a',
      })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/marketing-ops/channels-status',
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

  it('confirms cleanup and restores a recycle entry through explicit runtime calls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        previewId: 'preview-1',
        projectId: 'project-a',
        recycled: [{ recycleId: 'recycle-1' }],
        skipped: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [{ recycleId: 'recycle-1' }],
        projectId: 'project-a',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectId: 'project-a',
        restored: { recycleId: 'recycle-1' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.confirmStorageCleanup({
      itemIds: ['artifact-a'],
      previewId: 'preview-1',
      projectId: 'project-a',
    })).resolves.toMatchObject({ previewId: 'preview-1' })
    await expect(runtime.storageRecycle('project-a')).resolves.toMatchObject({
      entries: [{ recycleId: 'recycle-1' }],
    })
    await expect(runtime.restoreStorageRecycleEntry('project-a', 'recycle-1')).resolves.toMatchObject({
      restored: { recycleId: 'recycle-1' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/storage/cleanup/confirm',
      expect.objectContaining({
        body: JSON.stringify({
          itemIds: ['artifact-a'],
          previewId: 'preview-1',
          projectId: 'project-a',
        }),
        method: 'POST',
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-a/storage/recycle/recycle-1/restore',
      expect.objectContaining({ method: 'POST' }),
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

  it('completes and cancels owner handoffs without publishing on its own', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ handoffId: 'handoff-a', status: 'completed' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ handoffId: 'handoff-b', status: 'cancelled' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.completeOwnerHandoff('project-a', 'handoff-a')).resolves.toMatchObject({ status: 'completed' })
    await expect(runtime.cancelOwnerHandoff('project-a', 'handoff-b')).resolves.toMatchObject({ status: 'cancelled' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/owner-handoffs/handoff-a/complete',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-a/owner-handoffs/handoff-b/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses body-free typed actions for a managed publication handoff', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: 'assisted-prepare' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: 'assisted-confirm' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mode: 'assisted-abandon' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await runtime.resumeManagedPublicationHandoff('project-a', 'handoff-a')
    await runtime.confirmManagedPublicationHandoff('project-a', 'handoff-a')
    await runtime.abandonManagedPublicationHandoff('project-a', 'handoff-a')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/projects/project-a/owner-handoffs/handoff-a/marketing-ops/resume',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/projects/project-a/owner-handoffs/handoff-a/marketing-ops/confirm',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/projects/project-a/owner-handoffs/handoff-a/marketing-ops/abandon',
      expect.objectContaining({ method: 'POST' }),
    )
    for (const call of fetchMock.mock.calls)
      expect(call[1]).not.toHaveProperty('body')
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

  it('confirms a pending owner takeover for a paused recording task', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ownerTakeover: {
        confirmedAt: '2026-08-05T00:00:00.000Z',
        requestedAt: '2026-08-05T00:00:00.000Z',
      },
      projectId: 'project-a',
      taskId: 'video-task',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createWorkbenchRuntime('/api/v1').confirmOwnerTakeover('project-a', 'video-task'),
    ).resolves.toMatchObject({
      ownerTakeover: {
        confirmedAt: '2026-08-05T00:00:00.000Z',
      },
      taskId: 'video-task',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/tasks/video-task/owner-confirm',
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

  it('revises channel content media through a versioned scoped route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        artifactIds: ['article-draft', 'final-image'],
        contentId: 'content-a',
        version: 2,
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    const result = await runtime.reviseChannelContentMedia({
      artifactIds: ['final-image'],
      baseVersion: 1,
      contentId: 'content-a',
      mode: 'replace',
      projectId: 'project-a',
    })

    expect(result).toMatchObject({ version: 2, artifactIds: ['article-draft', 'final-image'] })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/channel-contents/content-a/media',
      expect.objectContaining({
        body: JSON.stringify({
          artifactIds: ['final-image'],
          baseVersion: 1,
          contentId: 'content-a',
          mode: 'replace',
          projectId: 'project-a',
        }),
        method: 'POST',
      }),
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

  it('revises an activity video plan through the local runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        version: 2,
        video: {
          format: 'landscape',
          recordingProfile: {
            defaults: {
              viewport: { height: 768, width: 1366 },
            },
          },
        },
        videoPlanReviewStatus: 'pending',
      }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    const result = await runtime.reviseActivity({
      activityId: 'activity-a',
      baseVersion: 1,
      projectId: 'project-a',
      topic: { 'en': 'A guide', 'zh-CN': '指南' },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          defaults: {
            viewport: { height: 768, width: 1366 },
          },
        },
      },
    })
    expect(result).toMatchObject({ version: 2, videoPlanReviewStatus: 'pending' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project-a/activities/activity-a/revise',
      expect.objectContaining({
        body: JSON.stringify({
          activityId: 'activity-a',
          baseVersion: 1,
          projectId: 'project-a',
          topic: { 'en': 'A guide', 'zh-CN': '指南' },
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
        method: 'POST',
      }),
    )
  })
})
