import type {
  CaptureFlow,
  ContentStudioReport,
  MonitoringObservation,
  OwnerHandoff,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  RecorderAttemptReceipt,
} from '../types'
import { describe, expect, it } from 'vitest'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
  ProjectScopeError,
} from './service'

function registerProject(
  service: ContentStudioApplicationService,
  projectId: string,
  captureFlows: CaptureFlow[] = [],
): { project: ProjectRecord, snapshot: ProjectSnapshot } {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows,
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
  const project: ProjectRecord = {
    captureMode: 'deterministic',
    currentSnapshotId: snapshot.snapshotId,
    name: projectId,
    projectId,
    repeatability: 'high',
    sourceAccess: 'source-owned',
  }
  service.registerProject(project, snapshot)
  return { project, snapshot }
}

function enableYouTube(
  service: ContentStudioApplicationService,
  projectId: string,
): ProjectChannelBinding {
  return service.bindProjectChannel({
    channel: 'youtube',
    delivery: 'owner-assisted',
    enabled: true,
    projectId,
  })
}

function createActivity(
  service: ContentStudioApplicationService,
  projectId = 'project-a',
  activityId = `${projectId}-activity`,
) {
  return service.createActivity({
    activityId,
    campaignId: `${projectId}-campaign`,
    channels: [
      {
        id: 'youtube',
        locale: 'en',
      },
    ],
    goal: 'education',
    projectId,
    projectSnapshotId: `${projectId}-snapshot-1`,
    status: 'draft',
    targetUrl: `https://${projectId}.example.com/`,
    topic: {
      'en': 'A topic',
      'zh-CN': '主题',
    },
  })
}

function createPublication(
  service: ContentStudioApplicationService,
  projectId = 'project-a',
): {
  activity: ReturnType<typeof createActivity>
  publication: ReturnType<ContentStudioApplicationService['createPublicationPlan']>
} {
  const activity = createActivity(service, projectId)
  const group = service.createContentGroup({
    activityId: activity.activityId,
    contentGroupId: `${projectId}-report-group`,
    coreMessage: 'Explain the idea',
    projectId,
    title: 'Quick sort',
  })
  const content = service.createChannelContent({
    activityId: activity.activityId,
    body: 'A video script',
    channel: 'youtube',
    contentGroupId: group.contentGroupId,
    contentId: `${projectId}-report-content`,
    format: 'video',
    locale: 'en',
    projectId,
    title: 'Quick sort explained',
  })
  const publication = service.createPublicationPlan({
    activityId: activity.activityId,
    channel: 'youtube',
    contentId: content.contentId,
    projectId,
    publicationId: `${projectId}-report-publication`,
  })
  return { activity, publication }
}

describe('content studio application service', () => {
  it('denies cross-project reads instead of returning another project record', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    createActivity(service)

    expect(() =>
      repository.getActivity('project-b', 'project-a-activity'),
    ).toThrow(ProjectScopeError)
  })

  it('allows an activity to target only enabled project channels', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    expect(() => createActivity(service)).toThrow(/enabled channel/i)

    enableYouTube(service, 'project-a')
    expect(createActivity(service).channels).toEqual([
      {
        id: 'youtube',
        locale: 'en',
      },
    ])
  })

  it('returns one project-scoped view for the local control surface', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const { project, snapshot } = registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(service.getProjectView('project-a')).toEqual({
      activities: [activity],
      channelContents: [],
      contentGroups: [],
      project,
      projectAssets: [],
      projectChannelBindings: [
        {
          channel: 'youtube',
          delivery: 'owner-assisted',
          enabled: true,
          projectId: 'project-a',
        },
      ],
      taskEvents: {
        [`production-${activity.activityId}`]: [
          {
            attempt: 1,
            eventId: `production-${activity.activityId}:1`,
            kind: 'task-created',
            message: 'Task created',
            projectId: 'project-a',
            sequence: 1,
            status: 'queued',
            taskId: `production-${activity.activityId}`,
            schemaVersion: 1,
          },
        ],
      },
      snapshot,
      tasks: [
        {
          activityId: activity.activityId,
          attempt: 1,
          kind: 'production',
          projectId: 'project-a',
          skipStages: [],
          status: 'queued',
          taskId: `production-${activity.activityId}`,
        },
      ],
    })
  })

  it('cancels and retries only the project task through the application service', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const taskId = `production-${activity.activityId}`

    expect(service.startProductionTask('project-a', taskId)).toMatchObject({
      attempt: 1,
      status: 'generating',
    })
    expect(service.cancelTask('project-a', taskId)).toMatchObject({
      attempt: 1,
      status: 'cancelled',
    })
    expect(service.retryTask('project-a', taskId)).toMatchObject({
      attempt: 2,
      status: 'queued',
    })
    expect(service.listTaskEvents('project-a', taskId).map(event => event.kind))
      .toEqual(['task-created', 'status-changed', 'attempt-cancelled', 'attempt-retried'])
  })

  it('runs a production task through the application service boundary', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const taskId = `production-${activity.activityId}`
    service.startProductionTask('project-a', taskId)

    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-service-test/attempt-1',
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
      outcome: 'succeeded',
      planSha256: 'test-plan',
      projectId: 'project-a',
      receiptVersion: 1,
      totalActions: 0,
      totalScenes: 0,
    }
    const result = await service.runProductionTask(
      {
        baseUrl: 'https://project-a.example.com',
        outputDirectory: '/tmp/content-studio-service-test',
        plan: {
          campaignId: activity.campaignId,
          durationMs: 100,
          format: 'landscape',
          scenes: [],
          viewport: {
            height: 1080,
            width: 1920,
          },
        },
        projectId: 'project-a',
        projectOrigin: 'https://project-a.example.com',
        taskId,
      },
      {
        record: async () => ({
          attempts: [receipt],
          receipt,
        }),
      },
    )

    expect(result.task.status).toBe('composing')
    expect(service.listTaskEvents('project-a', taskId).map(event => event.status))
      .toEqual(['queued', 'generating', 'recording', 'composing'])
  })

  it('keeps an activity video plan tied to the project snapshot', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const flow: CaptureFlow = {
      id: 'quick-sort',
      startPath: '/quick-sort',
      steps: [{
        durationMs: 100,
        kind: 'capture',
        label: 'algorithm',
      }],
      title: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
    }
    registerProject(service, 'video-project', [flow])
    enableYouTube(service, 'video-project')

    const activity = service.createActivity({
      activityId: 'video-activity',
      campaignId: 'video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'video-project',
      projectSnapshotId: 'video-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://video-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })

    expect(activity.video).toEqual({
      flowIds: ['quick-sort'],
      format: 'landscape',
    })
    expect(service.getActivityVideoPlan('video-project', activity.activityId))
      .toMatchObject({
        campaignId: 'video-campaign',
        durationMs: 100,
        format: 'landscape',
        scenes: [{ id: 'quick-sort', startPath: '/quick-sort' }],
      })

    expect(() => service.createActivity({
      activityId: 'invalid-video-activity',
      campaignId: 'invalid-video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'video-project',
      projectSnapshotId: 'video-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://video-project.example.com/quick-sort',
      topic: {
        'en': 'Invalid',
        'zh-CN': '无效',
      },
      video: {
        flowIds: ['missing-flow'],
        format: 'landscape',
      },
    })).toThrow(/capture flow/i)
  })

  it('saves an activity content pack after preflighting all channel versions', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const input = {
      activityId: activity.activityId,
      contentGroupId: 'pack-group',
      contents: [{
        body: 'A reviewable video draft',
        channel: 'youtube' as const,
        contentId: 'pack-content',
        format: 'video' as const,
        locale: 'en' as const,
        title: 'A video draft',
      }],
      coreMessage: 'Explain the idea clearly',
      projectId: 'project-a',
      title: 'Core message',
    }

    expect(service.saveActivityContentPack(input)).toMatchObject({
      contentGroup: { contentGroupId: 'pack-group', version: 1 },
      contents: [{ contentId: 'pack-content', version: 1 }],
    })
    expect(repository.listContentGroups('project-a')).toHaveLength(1)
    expect(repository.listChannelContents('project-a')).toHaveLength(1)

    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'empty-pack',
      contents: [],
    })).toThrow(/at least one/i)
    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'duplicate-pack',
      contents: [
        { ...input.contents[0]!, contentId: 'duplicate-new' },
        { ...input.contents[0]!, contentId: 'duplicate-new' },
      ],
    })).toThrow(/duplicate content/i)
    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'wrong-locale-pack',
      contents: [{ ...input.contents[0]!, contentId: 'wrong-locale', locale: 'zh-CN' }],
    })).toThrow(/channel and locale/i)
    expect(() => service.saveActivityContentPack(input)).toThrow(/already exists/i)
  })

  it('keeps activity artifacts out of the project asset library until explicit promotion', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'artifact-1',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'a'.repeat(64),
    })

    expect(repository.listProjectAssets('project-a')).toEqual([])
    service.promoteActivityArtifact({
      artifactId: 'artifact-1',
      assetId: 'asset-1',
      kind: 'video',
      projectId: 'project-a',
    })
    expect(repository.listProjectAssets('project-a')).toHaveLength(1)
  })

  it('stores immutable activity versions and preserves historical content', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const versionOne = createActivity(service)
    const versionTwo = service.reviseActivity({
      activityId: versionOne.activityId,
      baseVersion: versionOne.version,
      projectId: 'project-a',
      topic: {
        'en': 'A revised topic',
        'zh-CN': '修订主题',
      },
    })

    expect(versionTwo.version).toBe(2)
    expect(repository.getActivity('project-a', versionOne.activityId, 1)?.topic.en)
      .toBe('A topic')
    expect(repository.getActivity('project-a', versionOne.activityId)?.topic.en)
      .toBe('A revised topic')
  })

  it('binds publication receipts to the exact activity, content, and channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-1',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-1',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-1',
    })

    expect(() =>
      service.recordPublicationReceipt({
        activityId: activity.activityId,
        channel: 'github',
        externalReceiptId: 'receipt-1',
        projectId: 'project-a',
        publicationId: publication.publicationId,
        receiptId: 'receipt-1',
        status: 'published',
      }),
    ).toThrow(/channel/i)

    expect(
      service.recordPublicationReceipt({
        activityId: activity.activityId,
        channel: 'youtube',
        externalReceiptId: 'receipt-1',
        projectId: 'project-a',
        publicationId: publication.publicationId,
        receiptId: 'receipt-1',
        status: 'published',
      }),
    ).toMatchObject({
      activityId: activity.activityId,
      channel: 'youtube',
      publicationId: publication.publicationId,
      status: 'published',
    })
  })

  it('rejects mismatched ownership and duplicate immutable records', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const registered = registerProject(service, 'project-a')

    expect(() =>
      service.registerProject(
        {
          ...registered.project,
          currentSnapshotId: 'wrong-snapshot',
        },
        registered.snapshot,
      ),
    ).toThrow(/ownership/i)
    expect(() => repository.saveProject(registered.project)).toThrow(/already exists/i)
    expect(() => repository.saveProjectSnapshot(registered.snapshot)).toThrow(/already exists/i)

    const binding = enableYouTube(service, 'project-a')
    expect(() => repository.saveProjectChannelBinding(binding)).toThrow(/already exists/i)
    expect(repository.getActivity('project-a', 'unknown')).toBeUndefined()
    expect(repository.getPublicationPlan('project-a', 'unknown')).toBeUndefined()
    expect(repository.getPublicationReceipt('project-a', 'unknown')).toBeUndefined()
  })

  it('rejects missing references and stale activity revisions', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)

    expect(() => createActivity(service)).toThrow(/Project .* was not found/)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(() => service.reviseActivity({
      activityId: activity.activityId,
      baseVersion: 0,
      projectId: 'project-a',
      topic: {
        'en': 'Stale',
        'zh-CN': '过期',
      },
    })).toThrow(/moved past/i)
    expect(() => service.promoteActivityArtifact({
      artifactId: 'missing-artifact',
      assetId: 'asset-1',
      kind: 'video',
      projectId: 'project-a',
    })).toThrow(/not found/i)
    expect(() => service.createActivityArtifact({
      activityId: 'missing-activity',
      artifactId: 'artifact-1',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'b'.repeat(64),
    })).toThrow(/not found/i)
  })

  it('rejects content and publication records that cross activity boundaries', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activityA = createActivity(service)
    const activityB = createActivity(service, 'project-a', 'project-a-activity-b')
    const groupA = service.createContentGroup({
      activityId: activityA.activityId,
      contentGroupId: 'group-a',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })

    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      body: 'Missing group',
      channel: 'youtube',
      contentGroupId: 'missing-group',
      contentId: 'content-missing-group',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Missing group',
    })).toThrow(/not found/i)
    expect(() => service.createChannelContent({
      activityId: activityB.activityId,
      body: 'Wrong group',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-wrong-group',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong group',
    })).toThrow(/belong to the activity/i)
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      body: 'Wrong channel',
      channel: 'github',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-wrong-channel',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong channel',
    })).toThrow(/activity channel/i)

    expect(() => service.createPublicationPlan({
      activityId: activityA.activityId,
      channel: 'youtube',
      contentId: 'missing-content',
      projectId: 'project-a',
      publicationId: 'publication-missing-content',
    })).toThrow(/not found/i)
  })

  it('rejects a publication receipt that does not match its saved plan', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-1',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-1',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-1',
    })

    expect(() => service.recordPublicationReceipt({
      activityId: 'wrong-activity',
      channel: 'youtube',
      externalReceiptId: 'receipt-wrong',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-wrong',
      status: 'published',
    })).toThrow(/match activity/i)
    expect(() => service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'receipt-missing-plan',
      projectId: 'project-a',
      publicationId: 'missing-publication',
      receiptId: 'receipt-missing-plan',
      status: 'published',
    })).toThrow(/not found/i)
  })

  it('creates an owner handoff only for the exact publication plan', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-handoff',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-handoff',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-handoff',
    })
    const handoff: OwnerHandoff = {
      activityId: activity.activityId,
      artifactChecksums: ['a'.repeat(64)],
      channel: 'youtube',
      checklist: ['确认标题', '确认封面'],
      expiresAt: '2026-08-03T00:00:00.000Z',
      handoffId: 'handoff-1',
      officialTargetUrl: 'https://studio.youtube.com/upload',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      status: 'pending',
    }

    expect(service.createOwnerHandoff(handoff)).toEqual(handoff)
    expect(() => service.createOwnerHandoff({
      ...handoff,
      handoffId: 'handoff-wrong-activity',
      activityId: 'wrong-activity',
    })).toThrow(/match activity/i)
  })

  it('只允许已发布回执产生监测数据快照', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-observation',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-observation',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-observation',
    })
    const observation: MonitoringObservation = {
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: {
        comments: 2,
        likes: 10,
        replies: null,
        views: 100,
      },
      observationId: 'observation-1',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'public',
    }

    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-failed',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-failed',
      status: 'failed',
    })
    expect(() => service.recordMonitoringObservation(observation))
      .toThrow(/published receipt/i)
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-1',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-observation',
      status: 'published',
    })
    expect(service.recordMonitoringObservation(observation)).toEqual(observation)
  })

  it('报告只能引用同一项目和活动的监测快照', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-report',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-report',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-report',
    })
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-report',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-report',
      status: 'published',
    })
    service.recordMonitoringObservation({
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: { views: 100 },
      observationId: 'observation-report',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'authorized-adapter',
    })
    const report: ContentStudioReport = {
      activityId: activity.activityId,
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: { views: 100 },
      observationIds: ['observation-report'],
      projectId: 'project-a',
      reportId: 'report-1',
      scope: 'activity',
    }

    expect(service.createReport(report)).toEqual(report)
    expect(() => service.createReport({
      ...report,
      activityId: 'wrong-activity',
      reportId: 'report-wrong-activity',
    })).toThrow(/activity/i)
    expect(() => service.createReport({
      ...report,
      observationIds: ['missing-observation'],
      reportId: 'report-missing-observation',
    })).toThrow(/observation/i)
  })

  it('拒绝不完整的人工接管、错绑的监测数据和空报告', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const { activity, publication } = createPublication(service)
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-invalid',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-invalid',
      status: 'published',
    })
    const handoff: OwnerHandoff = {
      activityId: activity.activityId,
      artifactChecksums: ['a'.repeat(64)],
      channel: 'youtube',
      checklist: ['确认标题'],
      expiresAt: '2026-08-03T00:00:00.000Z',
      handoffId: 'handoff-invalid',
      officialTargetUrl: 'https://studio.youtube.com/upload',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      status: 'pending',
    }
    expect(() => service.createOwnerHandoff({
      ...handoff,
      artifactChecksums: [],
    })).toThrow(/checksum/i)
    expect(() => service.createOwnerHandoff({
      ...handoff,
      checklist: [],
    })).toThrow(/checklist/i)
    service.createOwnerHandoff(handoff)
    expect(() => repository.saveOwnerHandoff(handoff)).toThrow(/already exists/i)

    const observation: MonitoringObservation = {
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: { views: 100 },
      observationId: 'observation-invalid',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'owner-entered',
    }
    expect(() => service.recordMonitoringObservation({
      ...observation,
      channel: 'github',
    })).toThrow(/match publication/i)
    service.recordMonitoringObservation(observation)
    expect(() => repository.saveMonitoringObservation(observation))
      .toThrow(/already exists/i)

    expect(() => service.createReport({
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: {},
      observationIds: [],
      projectId: 'project-a',
      reportId: 'empty-report',
      scope: 'project',
    })).toThrow(/at least one observation/i)
    expect(() => service.createReport({
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: {},
      observationIds: ['observation-invalid'],
      projectId: 'project-a',
      reportId: 'missing-activity-report',
      scope: 'activity',
    })).toThrow(/requires an activity/i)
    const report: ContentStudioReport = {
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: { views: 100 },
      observationIds: ['observation-invalid'],
      projectId: 'project-a',
      reportId: 'report-invalid',
      scope: 'project',
    }
    service.createReport(report)
    expect(() => repository.saveReport(report)).toThrow(/already exists/i)
    expect(() => repository.savePublicationPlan(publication))
      .toThrow(/already exists/i)
  })
})
