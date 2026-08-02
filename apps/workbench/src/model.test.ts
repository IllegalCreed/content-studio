import type {
  ContentStudioProjectView,
  ExecutionTask,
  ExecutionTaskEvent,
} from '@content-studio/core-types'
import { describe, expect, it } from 'vitest'
import {
  runtimeActivityArtifacts,
  runtimeProjectAssets,
  runtimeReports,
  taskLifecycleProjection,
} from './model'

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

describe('runtime report projection', () => {
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
      size: '未记录',
      status: '已登记',
    }])
    expect(runtimeProjectAssets(view)).toEqual([{
      assetId: 'asset-a',
      kind: 'video',
      name: 'clip.webm',
      referencedBy: ['一篇指南'],
      retention: '长期保留',
      size: '未记录',
      source: '活动产物晋升',
      version: 'v1',
    }])
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

    expect(projection.progress).toBe(100)
    expect(projection.detail).toContain('已跳过录制阶段')
    expect(projection.steps).toEqual([
      { detail: '已完成', label: '排队中', status: 'done' },
      { detail: '已完成', label: '生成中', status: 'done' },
      { detail: '该任务已配置跳过此阶段', label: '录制中', status: 'skipped' },
      { detail: '当前阶段：合成中', label: '合成中', status: 'active' },
    ])
    expect(projection.attempts).toEqual([
      { attempt: 1, eventCount: 2, lastEvent: '任务从排队中进入失败', status: '失败' },
      { attempt: 2, eventCount: 3, lastEvent: '已跳过录制阶段', status: '合成中' },
    ])
  })
})
