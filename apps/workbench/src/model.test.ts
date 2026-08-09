import type {
  ContentStudioProjectView,
  ExecutionTask,
  ExecutionTaskEvent,
} from '@content-studio/core-types'
import { describe, expect, it } from 'vitest'
import {
  humanizeTaskEventKind,
  isPublishingAssistantChannel,
  recordingReceiptToVideoJob,
  snapshot,
  taskEventSummary,
  taskLifecycleProjection,
  videoViewportForFormat,
} from './model'
import {
  runtimeActivityArtifacts,
  runtimeProjectAssets,
  runtimeReports,
} from './projections'

function projectView(overrides: Partial<ContentStudioProjectView> = {}): ContentStudioProjectView {
  return {
    activities: [{
      activityId: 'activity-a',
      campaignId: 'activity-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'snapshot-a',
      status: 'active',
      targetUrl: 'https://project-a.example.com',
      topic: { 'en': 'A guide', 'zh-CN': '一篇指南' },
      version: 1,
    }],
    activityArtifacts: [],
    channelContents: [{
      activityId: 'activity-a',
      artifactIds: [],
      body: 'A guide',
      channel: 'github',
      contentGroupId: 'group-a',
      contentId: 'content-a',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'A guide',
      version: 1,
    }],
    compositionReceipts: [],
    contentGroups: [],
    monitoringObservations: [],
    ownerHandoffs: [],
    publicationPlans: [{
      activityId: 'activity-a',
      channel: 'github',
      contentId: 'content-a',
      projectId: 'project-a',
      publicationId: 'publication-a',
    }],
    publicationReceipts: [],
    recordingReceipts: [],
    project: {
      captureMode: 'deterministic',
      currentSnapshotId: 'snapshot-a',
      name: 'Project A',
      projectId: 'project-a',
      repeatability: 'high',
      sourceAccess: 'source-owned',
    },
    projectAssets: [],
    projectChannelBindings: [{
      accountAlias: 'Project Docs',
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: 'project-a',
    }],
    reports: [],
    snapshot: {
      manifest: {
        canonicalUrl: 'https://project-a.example.com',
        captureFlows: [],
        facts: [],
        locales: ['en'],
        name: 'Project A',
        projectId: 'project-a',
        repositoryUrl: 'https://github.com/example/project-a',
        schemaVersion: 1,
        tagline: { 'en': 'Project A', 'zh-CN': '项目 A' },
      },
      projectId: 'project-a',
      snapshotId: 'snapshot-a',
      version: 1,
    },
    tasks: [],
    taskEvents: {},
    ...overrides,
  }
}

describe('video plan projection', () => {
  it('keeps custom viewport settings visible to the workbench', () => {
    expect(videoViewportForFormat({
      format: 'landscape',
      recordingProfile: {
        defaults: {
          viewport: { height: 768, width: 1366 },
        },
      },
    })).toEqual({ height: 768, width: 1366 })
    expect(videoViewportForFormat({ format: 'portrait' })).toEqual({
      height: 1920,
      width: 1080,
    })
  })
})

describe('channel delivery projection', () => {
  it('keeps content-only channels out of the publishing assistant', () => {
    const contentOnly = snapshot.channels.find(channel => channel.channel === 'wechat')
    const ownerAssisted = snapshot.channels.find(channel => channel.channel === 'youtube')

    expect(contentOnly?.delivery).toBe('仅生成内容')
    expect(isPublishingAssistantChannel(contentOnly!)).toBe(false)
    expect(isPublishingAssistantChannel(ownerAssisted!)).toBe(true)
    expect(snapshot.channels).toHaveLength(19)
  })
})

describe('runtime report projection', () => {
  it('projects a persisted recording receipt into real video evidence', () => {
    const job = recordingReceiptToVideoJob({
      artifacts: [{
        id: 'preview-1',
        kind: 'preview-frame',
        relativePath: 'previews/preview-1.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
      }],
      attempt: 2,
      campaignId: 'activity-a',
      completedActions: 2,
      completedScenes: 1,
      jobId: 'task-a',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 1,
        entries: ['console:warning'],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'b'.repeat(64),
      projectId: 'project-a',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
      receiptVersion: 1,
      totalActions: 3,
      totalScenes: 1,
    })

    expect(job).toMatchObject({
      attempt: 2,
      completedActions: 2,
      jobId: 'task-a',
      outcome: '已完成',
      previewLabel: 'preview-1.png',
      previewUrl: '/api/v1/projects/project-a/tasks/task-a/recording-attempts/2/artifacts/preview-1',
      totalActions: 3,
    })
    expect(job.artifacts).toEqual([expect.objectContaining({
      id: 'preview-1',
      name: 'preview-1.png',
      size: '42 B',
    })])
    expect(job.logs).toEqual({
      consoleErrors: 0,
      consoleWarnings: 1,
      entries: ['console:warning'],
      pageErrors: 0,
    })
  })

  it('shows a pending report before a publication receipt arrives', () => {
    const [report] = runtimeReports(projectView())

    expect(report).toMatchObject({
      accountAlias: 'Project Docs',
      activityTitle: '一篇指南',
      contentType: '文章',
      status: '等待发布回执',
    })
    expect(report?.metrics).toEqual([
      { label: '阅读量', value: '—' },
      { label: '点赞', value: '—' },
      { label: '评论', value: '—' },
      { label: '转发', value: '—' },
    ])
  })

  it('uses the newest monitoring observation and exposes failed receipts', () => {
    const view = projectView({
      monitoringObservations: [
        {
          activityId: 'activity-a',
          channel: 'github',
          collectedAt: '2026-08-02T00:00:00.000Z',
          metrics: { likes: 2, reads: 10 },
          observationId: 'observation-old',
          projectId: 'project-a',
          publicationId: 'publication-a',
          source: 'public',
        },
        {
          activityId: 'activity-a',
          channel: 'github',
          collectedAt: '2026-08-03T00:00:00.000Z',
          metrics: { comments: 3, likes: 20, reads: 100 },
          observationId: 'observation-new',
          projectId: 'project-a',
          publicationId: 'publication-a',
          source: 'authorized-adapter',
        },
      ],
      publicationReceipts: [{
        activityId: 'activity-a',
        channel: 'github',
        externalReceiptId: 'external-a',
        projectId: 'project-a',
        publicationId: 'publication-a',
        receiptId: 'receipt-a',
        status: 'published',
      }],
    })
    const [report] = runtimeReports(view)
    expect(report).toMatchObject({
      lastChecked: '最近采集 · 2026-08-03T00:00:00.000Z',
      note: '数据来源：authorized-adapter',
      status: '监测中',
    })
    expect(report?.metrics).toEqual([
      { label: '阅读量', value: '100' },
      { label: '点赞', value: '20' },
      { label: '评论', value: '3' },
      { label: '转发', value: '—' },
    ])
    expect(report?.timeline).toEqual([
      {
        collectedAt: '2026-08-03T00:00:00.000Z',
        metrics: [
          { label: '阅读量', value: '100' },
          { label: '点赞', value: '20' },
          { label: '评论', value: '3' },
        ],
        source: 'authorized-adapter',
      },
      {
        collectedAt: '2026-08-02T00:00:00.000Z',
        metrics: [
          { label: '阅读量', value: '10' },
          { label: '点赞', value: '2' },
        ],
        source: 'public',
      },
    ])

    const [failedReport] = runtimeReports(projectView({
      publicationReceipts: [{
        activityId: 'activity-a',
        channel: 'github',
        externalReceiptId: 'external-failed',
        projectId: 'project-a',
        publicationId: 'publication-a',
        receiptId: 'receipt-failed',
        status: 'failed',
      }],
    }))
    expect(failedReport).toMatchObject({ status: '发布失败' })
  })

  it('projects registered activity artifacts and promoted project assets without inventing file sizes', () => {
    const view = projectView({
      activityArtifacts: [{
        activityId: 'activity-a',
        artifactId: 'artifact-a',
        kind: 'video-clip',
        projectId: 'project-a',
        relativePath: '.content-studio/activity-a/clip.webm',
        sha256: 'a'.repeat(64),
        version: 2,
      }, {
        activityId: 'activity-a',
        artifactId: 'cover-a',
        kind: 'image',
        projectId: 'project-a',
        relativePath: '.content-studio/activity-a/cover.svg',
        sha256: 'c'.repeat(64),
        version: 1,
      }, {
        activityId: 'activity-a',
        artifactId: 'gif-a',
        kind: 'image',
        projectId: 'project-a',
        relativePath: '.content-studio/activity-a/preview.gif',
        sha256: 'd'.repeat(64),
        version: 1,
      }],
      channelContents: [{
        activityId: 'activity-a',
        artifactIds: ['artifact-a'],
        body: 'A guide',
        channel: 'github',
        contentGroupId: 'group-a',
        contentId: 'content-a',
        format: 'article',
        locale: 'en',
        projectId: 'project-a',
        title: 'A guide',
        version: 1,
      }],
      projectAssets: [{
        assetId: 'asset-a',
        kind: 'video',
        projectId: 'project-a',
        relativePath: 'assets/clip.webm',
        sha256: 'b'.repeat(64),
        sourceArtifactId: 'artifact-a',
        version: 1,
      }],
    })

    expect(runtimeActivityArtifacts(view)).toEqual([{
      activityId: 'activity-a',
      artifactId: 'artifact-a',
      kind: '视频片段',
      name: 'clip.webm',
      previewKind: 'video',
      previewUrl: '/api/v1/projects/project-a/activity-artifacts/artifact-a/preview',
      checksum: 'a'.repeat(64),
      size: '未记录',
      status: '已登记',
    }, {
      activityId: 'activity-a',
      artifactId: 'cover-a',
      kind: '图片',
      name: 'cover.svg',
      previewKind: 'image',
      previewUrl: '/api/v1/projects/project-a/activity-artifacts/cover-a/preview',
      checksum: 'c'.repeat(64),
      size: '未记录',
      status: '已登记',
    }, {
      activityId: 'activity-a',
      artifactId: 'gif-a',
      kind: '图片',
      name: 'preview.gif',
      previewKind: 'image',
      previewUrl: '/api/v1/projects/project-a/activity-artifacts/gif-a/preview',
      checksum: 'd'.repeat(64),
      size: '未记录',
      status: '已登记',
    }])
    expect(runtimeProjectAssets(view)).toEqual([{
      assetId: 'asset-a',
      kind: 'video',
      name: 'clip.webm',
      previewKind: 'video',
      previewUrl: '/api/v1/projects/project-a/project-assets/asset-a/preview',
      checksum: 'b'.repeat(64),
      referencedBy: ['一篇指南'],
      retention: '长期保留',
      size: '未记录',
      source: '活动产物晋升',
      version: 'v1',
    }])
  })
})

describe('demo task projection', () => {
  it('uses the same lifecycle stages as runtime tasks', () => {
    const [recording, publication, monitoring] = snapshot.tasks

    expect(recording?.steps.map(step => step.label)).toEqual([
      '排队中',
      '生成中',
      '录制中',
      '合成中',
      '已完成',
    ])
    expect(recording?.progress).toBe(50)
    expect(publication?.steps.map(step => step.label)).toEqual([
      '排队中',
      '等待人工',
      '已发布',
    ])
    expect(monitoring?.steps.map(step => step.label)).toEqual([
      '排队中',
      '监测中',
    ])
  })
})

describe('execution task projection', () => {
  it('projects the task-specific lifecycle from real status events', () => {
    const task: ExecutionTask = {
      activityId: 'activity-a',
      attempt: 2,
      channel: 'github',
      contentId: 'content-a',
      kind: 'production',
      productionType: 'article',
      projectId: 'project-a',
      skipStages: ['recording'],
      status: 'composing',
      taskId: 'task-a',
    }
    const events: ExecutionTaskEvent[] = [
      {
        attempt: 1,
        eventId: 'task-a:1',
        kind: 'task-created',
        message: 'Task created',
        projectId: 'project-a',
        sequence: 1,
        status: 'queued',
        taskId: 'task-a',
        schemaVersion: 1,
      },
      {
        attempt: 1,
        eventId: 'task-a:2',
        fromStatus: 'queued',
        kind: 'status-changed',
        message: 'Task changed from queued to failed',
        projectId: 'project-a',
        sequence: 2,
        status: 'failed',
        taskId: 'task-a',
        toStatus: 'failed',
        schemaVersion: 1,
      },
      {
        attempt: 2,
        eventId: 'task-a:3',
        fromStatus: 'failed',
        kind: 'attempt-retried',
        message: 'Retry created as attempt 2',
        previousAttempt: 1,
        projectId: 'project-a',
        sequence: 3,
        status: 'queued',
        taskId: 'task-a',
        toStatus: 'queued',
        schemaVersion: 1,
      },
      {
        attempt: 2,
        fromStatus: 'queued',
        eventId: 'task-a:4',
        kind: 'status-changed',
        message: 'Task changed from queued to generating',
        projectId: 'project-a',
        sequence: 4,
        status: 'generating',
        taskId: 'task-a',
        toStatus: 'generating',
        schemaVersion: 1,
      },
      {
        attempt: 2,
        eventId: 'task-a:5',
        fromStatus: 'generating',
        kind: 'stage-skipped',
        message: 'Task skipped recording',
        projectId: 'project-a',
        sequence: 5,
        stage: 'recording',
        status: 'composing',
        taskId: 'task-a',
        toStatus: 'composing',
        schemaVersion: 1,
      },
    ]

    const projection = taskLifecycleProjection(task, events)

    expect(projection.progress).toBe(75)
    expect(projection.detail).toContain('已跳过录制阶段')
    expect(projection.steps).toEqual([
      { detail: '已完成', label: '排队中', status: 'done' },
      { detail: '已完成', label: '生成中', status: 'done' },
      { detail: '该任务已配置跳过此阶段', label: '录制中', status: 'skipped' },
      { detail: '当前阶段：合成中', label: '合成中', status: 'active' },
      { detail: '等待前一阶段完成', label: '已完成', status: 'pending' },
    ])
    expect(projection.attempts).toEqual([
      { attempt: 1, eventCount: 2, lastEvent: '任务从排队中进入失败', status: '失败' },
      { attempt: 2, eventCount: 3, lastEvent: '已跳过录制阶段', status: '合成中' },
    ])

    const completed = taskLifecycleProjection(
      { ...task, status: 'completed' },
      [...events, {
        attempt: 2,
        eventId: 'task-a:6',
        fromStatus: 'composing',
        kind: 'status-changed',
        message: 'Task changed from composing to completed',
        projectId: 'project-a',
        sequence: 6,
        status: 'completed',
        taskId: 'task-a',
        toStatus: 'completed',
        schemaVersion: 1,
      }],
    )
    expect(completed.progress).toBe(100)
    expect(completed.steps.at(-1)).toEqual({
      detail: '已完成',
      label: '已完成',
      status: 'done',
    })
  })

  it('localizes composition progress events with artifact metadata', () => {
    const event: ExecutionTaskEvent = {
      artifact: {
        artifactId: 'gif-task-a',
        durationSeconds: 4,
        fps: 10,
        height: 360,
        kind: 'gif',
        sha256: 'a'.repeat(64),
        sizeBytes: 278766,
        width: 640,
      },
      attempt: 1,
      eventId: 'task-a:7',
      kind: 'composition-gif-ready',
      message: 'GIF preview ready',
      projectId: 'project-a',
      sequence: 7,
      stage: 'composing',
      status: 'composing',
      taskId: 'task-a',
      schemaVersion: 1,
    }

    expect(humanizeTaskEventKind(event.kind)).toBe('GIF 已生成')
    expect(taskEventSummary(event)).toContain('640×360')
    expect(taskEventSummary(event)).toContain('272 KB')
  })
})
