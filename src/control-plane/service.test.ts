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
  integration: Pick<ProjectRecord, 'captureMode' | 'repeatability' | 'sourceAccess'> = {
    captureMode: 'deterministic',
    repeatability: 'high',
    sourceAccess: 'source-owned',
  },
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
      ...integration,
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  const project: ProjectRecord = {
    captureMode: integration.captureMode,
    currentSnapshotId: snapshot.snapshotId,
    name: projectId,
    projectId,
    repeatability: integration.repeatability,
    sourceAccess: integration.sourceAccess,
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
    artifactIds: [],
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

function createProductionContent(
  service: ContentStudioApplicationService,
  activity: ReturnType<typeof createActivity>,
  format: 'article' | 'video' = 'video',
): string {
  const group = service.createContentGroup({
    activityId: activity.activityId,
    contentGroupId: `${activity.activityId}-content-group`,
    coreMessage: 'Explain the idea',
    projectId: activity.projectId,
    title: '内容组',
  })
  const content = service.createChannelContent({
    activityId: activity.activityId,
    artifactIds: [],
    body: 'Content body',
    channel: 'youtube',
    contentGroupId: group.contentGroupId,
    contentId: `${activity.activityId}-content`,
    format,
    locale: 'en',
    projectId: activity.projectId,
    title: 'Content',
  })
  return content.contentId
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

  it('creates production work only after content identifies its channel target', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(service.getProjectView('project-a').tasks).toEqual([])

    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'project-a-content-group',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: '内容组',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'project-a-video-content',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Video content',
    })

    expect(service.getProjectView('project-a').tasks).toEqual([
      expect.objectContaining({
        activityId: activity.activityId,
        channel: 'youtube',
        contentId: content.contentId,
        kind: 'production',
        productionType: 'video',
        status: 'queued',
        taskId: `production-${content.contentId}`,
      }),
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
      activityArtifacts: [],
      channelContents: [],
      contentGroups: [],
      ownerHandoffs: [],
      publicationPlans: [],
      publicationReceipts: [],
      recordingReceipts: [],
      monitoringObservations: [],
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
      reports: [],
      taskEvents: {},
      snapshot,
      tasks: [],
    })
  })

  it('keeps one explicit project account binding per channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    const binding = service.bindProjectChannel({
      accountAlias: '算法可视化账号',
      accountRef: 'project-a:youtube:owner-account',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })

    expect(binding).toMatchObject({
      accountAlias: '算法可视化账号',
      accountRef: 'project-a:youtube:owner-account',
      channel: 'youtube',
      projectId: 'project-a',
    })
    expect(() => service.bindProjectChannel({
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })).toThrow(/already exists/i)
  })

  it('updates an existing project channel binding without creating a second channel entry', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')

    const updated = service.updateProjectChannelBinding({
      accountAlias: '算法可视化备用账号',
      accountRef: 'account-youtube-backup',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: false,
      projectId: 'project-a',
    })

    expect(updated).toMatchObject({
      accountAlias: '算法可视化备用账号',
      accountRef: 'account-youtube-backup',
      enabled: false,
    })
    expect(repository.listProjectChannelBindings('project-a')).toEqual([updated])
    expect(() => service.updateProjectChannelBinding({
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: 'project-a',
    })).toThrow(/not found/i)
  })

  it('saves a new project channel binding when a global channel has not been configured yet', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    const binding = service.setProjectChannelBinding({
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: 'project-a',
    })

    expect(repository.listProjectChannelBindings('project-a')).toEqual([binding])
  })

  it('cancels and retries only the project task through the application service', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`

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
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
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

  it('keeps an activity video plan tied to the project snapshot', async () => {
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
      videoPlanReviewStatus: 'confirmed',
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
    })

    expect(activity.videoPlanReviewStatus).toBe('pending')
    const confirmedActivity = service.confirmActivityVideoPlan({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'video-project',
    })
    expect(confirmedActivity).toMatchObject({
      activityId: activity.activityId,
      version: activity.version + 1,
      videoPlanReviewStatus: 'confirmed',
    })
    expect(() => service.confirmActivityVideoPlan({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'video-project',
    })).toThrow(/moved past version/i)

    expect(activity.video).toEqual({
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
    })
    expect(service.getActivityVideoPlan('video-project', activity.activityId))
      .toMatchObject({
        campaignId: 'video-campaign',
        durationMs: 100,
        format: 'landscape',
        outline: [{ flowId: 'quick-sort' }],
        planVersion: 2,
        reviewStatus: 'confirmed',
        scenes: [{ id: 'quick-sort', startPath: '/quick-sort' }],
      })

    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('video-project', taskId)
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-video-plan-test/attempt-1',
      artifacts: [],
      attempt: 1,
      campaignId: activity.campaignId,
      completedActions: 1,
      completedScenes: 1,
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'video-plan-test',
      projectId: 'video-project',
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const recorderInputs: Array<{ plan: unknown, recordingContext: unknown }> = []
    await expect(service.runActivityProductionTask(
      'video-project',
      taskId,
      {
        baseUrl: 'https://video-project.example.com',
        outputDirectory: '/tmp/content-studio-video-plan-test',
        projectOrigin: 'https://video-project.example.com',
      },
      {
        record: async (input) => {
          recorderInputs.push({
            plan: input.plan,
            recordingContext: input.recordingContext,
          })
          return { attempts: [receipt], receipt }
        },
      },
    )).resolves.toMatchObject({ task: { status: 'composing' } })
    expect(service.getProjectView('video-project').recordingReceipts).toEqual([
      expect.objectContaining({
        attempt: 1,
        artifacts: [],
        jobId: taskId,
      }),
    ])
    const recordingReceipts = service.getProjectView('video-project').recordingReceipts
    expect(recordingReceipts[0]).not.toHaveProperty('artifactDirectory')
    expect(recorderInputs[0]?.plan).toMatchObject({
      campaignId: 'video-campaign',
      scenes: [{ id: 'quick-sort' }],
    })
    expect(recorderInputs[0]?.recordingContext).toEqual({
      captureMode: 'deterministic',
      humanIntervention: false,
      planVersion: 2,
      repeatability: 'high',
      sourceAccess: 'source-owned',
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

    const assistedRepository = new InMemoryContentStudioRepository()
    const assistedService = new ContentStudioApplicationService(assistedRepository)
    registerProject(
      assistedService,
      'assisted-project',
      [flow],
      {
        captureMode: 'assisted',
        repeatability: 'low',
        sourceAccess: 'web-assisted',
      },
    )
    enableYouTube(assistedService, 'assisted-project')
    const assistedActivity = assistedService.createActivity({
      activityId: 'assisted-activity',
      campaignId: 'assisted-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'assisted-project',
      projectSnapshotId: 'assisted-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://assisted-project.example.com/quick-sort',
      topic: {
        'en': 'Assisted',
        'zh-CN': '辅助',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const assistedContentId = createProductionContent(assistedService, assistedActivity)
    const assistedTaskId = `production-${assistedContentId}`
    assistedService.startProductionTask('assisted-project', assistedTaskId)
    expect(() => assistedService.runActivityProductionTask(
      'assisted-project',
      assistedTaskId,
      {
        baseUrl: 'https://assisted-project.example.com',
        outputDirectory: '/tmp/content-studio-assisted-project',
        projectOrigin: 'https://assisted-project.example.com',
      },
      {
        record: async () => {
          throw new Error('recorder must not run')
        },
      },
    )).toThrow(/source-owned deterministic/i)
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
        artifactIds: [],
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

    expect(service.getProjectView('project-a').activityArtifacts).toEqual([
      expect.objectContaining({ artifactId: 'artifact-1' }),
    ])
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

  it('revises a video plan and requires confirmation for the new version', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a', [{
      id: 'quick-sort',
      startPath: '/quick-sort',
      steps: [{ kind: 'capture', label: 'partition' }],
      title: { 'en': 'Quick sort', 'zh-CN': '快速排序' },
    }])
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const revised = service.reviseActivity({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'project-a',
      topic: activity.topic,
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        viewport: { height: 768, width: 1366 },
      },
    })

    expect(revised.version).toBe(2)
    expect(revised.video?.viewport).toEqual({ height: 768, width: 1366 })
    expect(revised.videoPlanReviewStatus).toBe('pending')
    expect(repository.getActivity('project-a', activity.activityId, 1)?.video?.viewport)
      .toBeUndefined()
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
      artifactIds: [],
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-1',
    })

    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: 'youtube',
        contentId: content.contentId,
        kind: 'publication',
        status: 'queued',
        taskId: `publication-${publication.publicationId}`,
      }),
    ]))

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
    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'publication',
        status: 'published',
        taskId: `publication-${publication.publicationId}`,
      }),
      expect.objectContaining({
        kind: 'monitoring',
        status: 'queued',
        taskId: `monitoring-${publication.publicationId}`,
      }),
    ]))
    expect(service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'receipt-1-repeat',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-1-repeat',
      status: 'published',
    })).toMatchObject({ status: 'published' })
    expect(service.getProjectView('project-a')).toMatchObject({
      publicationPlans: [publication],
      publicationReceipts: expect.arrayContaining([
        expect.objectContaining({ receiptId: 'receipt-1' }),
      ]),
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
      artifactIds: [],
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
      artifactIds: [],
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
      artifactIds: [],
    })).toThrow(/activity channel/i)

    expect(() => service.createPublicationPlan({
      activityId: activityA.activityId,
      channel: 'youtube',
      contentId: 'missing-content',
      projectId: 'project-a',
      publicationId: 'publication-missing-content',
    })).toThrow(/not found/i)
  })

  it('binds channel content artifacts to the same activity and rejects duplicates', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activityA = createActivity(service)
    const activityB = createActivity(service, 'project-a', 'project-a-activity-b')
    const groupA = service.createContentGroup({
      activityId: activityA.activityId,
      contentGroupId: 'artifact-group-a',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    service.createActivityArtifact({
      activityId: activityA.activityId,
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'a'.repeat(64),
    })

    // missing artifact
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['missing-artifact'],
      body: 'Missing artifact',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-missing-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Missing artifact',
    })).toThrow(/not found/i)

    // artifact belongs to a different activity: give activity B its own
    // legit group + channel so we isolate the artifact-ownership check
    const groupB = service.createContentGroup({
      activityId: activityB.activityId,
      contentGroupId: 'artifact-group-b',
      coreMessage: 'Other activity',
      projectId: 'project-a',
      title: 'Other activity',
    })
    expect(() => service.createChannelContent({
      activityId: activityB.activityId,
      artifactIds: ['artifact-a'],
      body: 'Wrong activity artifact',
      channel: 'youtube',
      contentGroupId: groupB.contentGroupId,
      contentId: 'content-cross-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong activity artifact',
    })).toThrow(/belong to the activity/i)

    // duplicate artifact id within one content
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['artifact-a', 'artifact-a'],
      body: 'Duplicate artifact',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-duplicate-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Duplicate artifact',
    })).toThrow(/Duplicate channel content artifact/i)

    // happy path: artifact in the same activity is recorded on the content
    const content = service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['artifact-a'],
      body: 'Happy path',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-with-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Happy path',
    })
    expect(content.artifactIds).toEqual(['artifact-a'])
    const view = service.getProjectView('project-a')
    expect(view.channelContents.find(item => item.contentId === 'content-with-artifact')?.artifactIds)
      .toEqual(['artifact-a'])
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
      artifactIds: [],
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
      artifactIds: [],
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
    expect(service.completeOwnerHandoff('project-a', handoff.handoffId)).toMatchObject({
      handoffId: handoff.handoffId,
      status: 'completed',
    })
    expect(service.getProjectView('project-a').ownerHandoffs).toEqual([
      expect.objectContaining({ handoffId: handoff.handoffId, status: 'completed' }),
    ])
    expect(() => service.completeOwnerHandoff('project-a', handoff.handoffId))
      .toThrow(/pending/i)
    expect(service.getProjectView('project-a')).toMatchObject({
      ownerHandoffs: [expect.objectContaining({ handoffId: handoff.handoffId, status: 'completed' })],
      tasks: [
        expect.objectContaining({
          kind: 'production',
          status: 'queued',
        }),
        expect.objectContaining({
          kind: 'publication',
          status: 'awaiting-owner',
          taskId: `publication-${publication.publicationId}`,
        }),
      ],
    })
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
      artifactIds: [],
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
    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'monitoring',
        status: 'monitoring',
        taskId: `monitoring-${publication.publicationId}`,
      }),
    ]))
    expect(service.getProjectView('project-a').monitoringObservations).toEqual([observation])
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
      artifactIds: [],
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
    expect(service.getProjectView('project-a').reports).toEqual([report])
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
