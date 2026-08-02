import type { ContentStudioProjectView } from '@content-studio/core-types'
import { describe, expect, it } from 'vitest'
import { runtimeReports } from './model'

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
      topic: { en: 'A guide', 'zh-CN': '一篇指南' },
      version: 1,
    }],
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
        tagline: { en: 'Project A', 'zh-CN': '项目 A' },
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
})
