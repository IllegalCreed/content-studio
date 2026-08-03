import type {
  ChannelContent,
  ContentGroup,
  ExecutionTask,
  OwnerHandoff,
  PublishingActivity,
} from '@content-studio/core-types'
import { describe, expect, it } from 'vitest'
import {
  activityToCampaign,
  preferRuntimeData,
  taskToProjection,
} from './projections'

describe('workbench runtime projections', () => {
  it('运行时已连接时只显示运行时数据，即使运行时返回空列表', () => {
    expect(preferRuntimeData([], ['演示活动'], true)).toEqual([])
  })

  it('运行时未连接时保留只读演示数据', () => {
    expect(preferRuntimeData([], ['演示活动'], false)).toEqual(['演示活动'])
  })

  it('把活动、内容组和人工交接整理成活动详情投影', () => {
    const activity: PublishingActivity = {
      activityId: 'activity-a',
      campaignId: 'activity-a',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId: 'project-a',
      projectSnapshotId: 'snapshot-a',
      status: 'planned',
      targetUrl: 'https://example.com/activity-a/',
      topic: { 'en': 'A topic', 'zh-CN': '一个主题' },
      version: 2,
    }
    const contentGroup: ContentGroup = {
      activityId: 'activity-a',
      contentGroupId: 'group-a',
      coreMessage: 'Core message',
      projectId: 'project-a',
      title: 'Core group',
      version: 1,
    }
    const content: ChannelContent = {
      activityId: 'activity-a',
      artifactIds: [],
      body: 'Body',
      channel: 'github',
      contentGroupId: 'group-a',
      contentId: 'content-a',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'Channel article',
      version: 1,
    }
    const handoff: OwnerHandoff = {
      activityId: 'activity-a',
      artifactChecksums: [],
      channel: 'github',
      checklist: ['登录并确认'],
      expiresAt: '2026-08-04T00:00:00.000Z',
      handoffId: 'handoff-a',
      officialTargetUrl: 'https://github.com/new',
      projectId: 'project-a',
      publicationId: 'publication-a',
      status: 'pending',
    }

    const campaign = activityToCampaign({
      accountAliasForChannel: () => '项目账号',
      activity,
      channelContents: [content],
      contentGroups: [contentGroup],
      ownerHandoffs: [handoff],
    })

    expect(campaign).toMatchObject({
      activityStatus: '已规划',
      channels: ['github'],
      contentGroups: [{ contents: [{ accountAlias: '项目账号', title: 'Channel article' }] }],
      handoffs: [{ handoffId: 'handoff-a', status: 'waiting' }],
      title: '一个主题',
    })
  })

  it('把执行任务和事件整理成任务面板投影', () => {
    const task: ExecutionTask = {
      activityId: 'activity-a',
      attempt: 1,
      channel: 'github',
      contentId: 'content-a',
      kind: 'production',
      productionType: 'article',
      projectId: 'project-a',
      skipStages: [],
      status: 'queued',
      taskId: 'task-a',
    }
    const projection = taskToProjection({
      accountAliasForChannel: () => '项目账号',
      campaigns: [{
        activityArtifacts: [],
        activityStatus: '草稿',
        assets: 0,
        campaignId: 'activity-a',
        channels: ['github'],
        contentGroups: [{
          contentGroupId: 'group-a',
          contents: [{
            channel: 'github',
            contentId: 'content-a',
            format: '文章',
            locale: 'en',
            status: '已生成',
            title: 'Channel article',
          }],
          coreMessage: 'Core',
          title: 'Group',
        }],
        executionStatus: 'queued',
        handoffs: [],
        nextAction: '下一步',
        referencedAssets: [],
        title: '一个主题',
        topic: '一个主题',
        version: 1,
        videoJob: null,
        videoPlan: null,
      }],
      events: [],
      task,
    })

    expect(projection).toMatchObject({
      accountAlias: '项目账号',
      activityTitle: '一个主题',
      contentTitle: 'Channel article',
      kind: '制作',
      status: 'queued',
      taskId: 'task-a',
    })
  })
})
