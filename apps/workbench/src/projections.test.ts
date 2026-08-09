import type {
  ChannelContent,
  ContentGroup,
  ContentStudioProjectIndex,
  ExecutionTask,
  MarketingOpsChannelsStatusSnapshot,
  OwnerHandoff,
  ProjectChannelBinding,
  PublishingActivity,
} from '@content-studio/core-types'
import type { ChannelProjection } from './model'
import { describe, expect, it } from 'vitest'
import {
  activityBusinessProgressProjection,
  activityPublicationProjections,
  activityToCampaign,
  preferRuntimeData,
  projectChannels,
  projectIndexProjections,
  projectMarketingOpsChannels,
  taskToProjection,
} from './projections'

describe('workbench runtime projections', () => {
  it('把项目注册表摘要投影成项目切换和总览所需的数据', () => {
    const index: ContentStudioProjectIndex = {
      projects: [{
        activityCount: 2,
        enabledChannels: [{ channel: 'github', delivery: 'automatic-candidate' }],
        previewReady: true,
        project: {
          captureMode: 'deterministic',
          currentSnapshotId: 'snapshot-a',
          name: 'Project A',
          projectId: 'project-a',
          repeatability: 'high',
          sourceAccess: 'source-owned',
        },
        snapshotId: 'snapshot-a',
        snapshotVersion: 3,
        taskCount: 4,
        taskCounts: { monitoring: 1, production: 2, publication: 1 },
      }],
    }

    expect(projectIndexProjections(index)).toEqual([{
      activityCount: 2,
      enabledChannels: [{ channel: 'github', delivery: 'automatic-candidate' }],
      name: 'Project A',
      previewReady: true,
      projectId: 'project-a',
      snapshotVersion: 3,
      taskCount: 4,
      taskCounts: { monitoring: 1, production: 2, publication: 1 },
    }])
  })

  it('运行时已连接时只显示运行时数据，即使运行时返回空列表', () => {
    expect(preferRuntimeData([], ['演示活动'], true)).toEqual([])
  })

  it('运行时未连接时保留只读演示数据', () => {
    expect(preferRuntimeData([], ['演示活动'], false)).toEqual(['演示活动'])
  })

  it('把项目渠道绑定投影到全局渠道目录，不改动全局规格', () => {
    const channels: ChannelProjection[] = [{
      accounts: [],
      adapterReady: true,
      alias: 'Global account',
      bodyLimit: 12000,
      channel: 'github',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '已就绪',
      metrics: ['发布回执'],
      nextAction: null,
      projectAccountId: 'global-account',
      statusSource: 'marketing-ops',
      titleLimit: 128,
    }]
    const bindings: ProjectChannelBinding[] = [{
      accountRef: 'project-account',
      channel: 'github',
      delivery: 'owner-assisted',
      enabled: false,
      projectId: 'project-a',
    }]

    const [projected] = projectChannels({ bindings, channels })

    expect(projected).toMatchObject({
      bodyLimit: 12000,
      channel: 'github',
      enabled: false,
      projectAccountId: 'project-account',
      titleLimit: 128,
    })
    expect(channels[0]?.enabled).toBe(true)
  })

  it('只把新鲜 marketing-ops 快照映射成有限的渠道状态，不传播 nextAction 文本', () => {
    const channels: ChannelProjection[] = [{
      accounts: [{
        accountId: 'github-account',
        adapterReady: false,
        alias: '@project-a',
        assignedProjects: ['project-a'],
        channel: 'github',
        health: '未查询',
        isDefault: true,
        nextAction: '尚未读取该账号的 marketing-ops 状态',
        statusSource: '项目配置',
      }],
      adapterReady: false,
      alias: '@project-a',
      bodyLimit: 12000,
      channel: 'github',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '未查询',
      metrics: [],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      projectAccountId: 'github-account',
      statusSource: '项目配置',
      titleLimit: 128,
    }]
    const status: MarketingOpsChannelsStatusSnapshot = {
      authorizesExternalWrite: false,
      channels: [{
        accountAlias: '@project-a',
        adapterReady: false,
        channel: 'github',
        health: 'reauth-required',
        nextStep: 'reauthorize',
      }],
      contractVersion: 3,
      expiresAt: '2099-01-01T00:01:00.000Z',
      observedAt: '2099-01-01T00:00:00.000Z',
      projectId: 'project-a',
      runtimeVersion: '0.1.0',
    }

    const [projected] = projectMarketingOpsChannels(channels, status)

    expect(projected).toMatchObject({
      adapterReady: false,
      health: '需重新授权',
      nextAction: '需要重新授权',
      statusSource: 'marketing-ops',
      accounts: [{
        adapterReady: false,
        health: '需重新授权',
        nextAction: '需要重新授权',
        statusSource: 'marketing-ops',
      }],
    })
    expect(JSON.stringify(projected)).not.toContain('marketing-ops setup')
  })

  it('优先用稳定 accountRef 匹配项目账号，不受 alias 改名影响', () => {
    const channels: ChannelProjection[] = [{
      accounts: [{
        accountId: 'account.github.main',
        adapterReady: false,
        alias: '@old-release-bot',
        assignedProjects: ['project-a'],
        channel: 'github',
        health: '未查询',
        isDefault: true,
        nextAction: '尚未读取该账号的 marketing-ops 状态',
        statusSource: '项目配置',
      }],
      adapterReady: false,
      alias: '@old-release-bot',
      bodyLimit: 12000,
      channel: 'github',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '未查询',
      metrics: [],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      projectAccountId: 'account.github.main',
      statusSource: '项目配置',
      titleLimit: 128,
    }]
    const status: MarketingOpsChannelsStatusSnapshot = {
      authorizesExternalWrite: false,
      channels: [{
        accountRef: 'account.github.main',
        accountAlias: '@renamed-release-bot',
        adapterReady: true,
        channel: 'github',
        health: 'ready',
        nextStep: 'ready',
      }],
      contractVersion: 3,
      expiresAt: '2099-01-01T00:01:00.000Z',
      observedAt: '2099-01-01T00:00:00.000Z',
      projectId: 'project-a',
      runtimeVersion: '0.1.0',
    }

    const [projected] = projectMarketingOpsChannels(channels, status)

    expect(projected).toMatchObject({
      alias: '@renamed-release-bot',
      adapterReady: true,
      health: '已就绪',
      statusSource: 'marketing-ops',
      accounts: [{
        accountId: 'account.github.main',
        adapterReady: true,
        alias: '@old-release-bot',
        health: '已就绪',
        statusSource: 'marketing-ops',
      }],
    })
  })

  it('fails closed when a live accountRef does not match the project binding', () => {
    const channels: ChannelProjection[] = [{
      accounts: [{
        accountId: 'account.github.main',
        adapterReady: false,
        alias: '@project-a',
        assignedProjects: ['project-a'],
        channel: 'github',
        health: '未查询',
        isDefault: true,
        nextAction: '尚未读取该账号的 marketing-ops 状态',
        statusSource: '项目配置',
      }],
      adapterReady: false,
      alias: '@project-a',
      bodyLimit: 12000,
      channel: 'github',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '未查询',
      metrics: [],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      projectAccountId: 'account.github.main',
      statusSource: '项目配置',
      titleLimit: 128,
    }]
    const status: MarketingOpsChannelsStatusSnapshot = {
      authorizesExternalWrite: false,
      channels: [{
        accountRef: 'account.github.other',
        accountAlias: '@other-account',
        adapterReady: true,
        channel: 'github',
        health: 'ready',
        nextStep: 'ready',
      }],
      contractVersion: 3,
      expiresAt: '2099-01-01T00:01:00.000Z',
      observedAt: '2099-01-01T00:00:00.000Z',
      projectId: 'project-a',
      runtimeVersion: '0.1.0',
    }

    const [projected] = projectMarketingOpsChannels(channels, status)

    expect(projected).toMatchObject({
      adapterReady: false,
      health: '未查询',
      statusSource: '项目配置',
      accounts: [{
        adapterReady: false,
        health: '未查询',
        statusSource: '项目配置',
      }],
    })
    expect(JSON.stringify(projected)).not.toContain('@other-account')
  })

  it('将缺失或不可用的 live status 重置为未查询，保留内容生产能力投影', () => {
    const channels: ChannelProjection[] = [{
      accounts: [],
      adapterReady: true,
      alias: '@demo',
      bodyLimit: 300,
      channel: 'bluesky',
      delivery: '全自动候选',
      enabled: true,
      format: '短帖',
      health: '已就绪',
      metrics: [],
      nextAction: null,
      projectAccountId: null,
      statusSource: 'marketing-ops',
      titleLimit: 80,
    }]

    expect(projectMarketingOpsChannels(channels, null)).toEqual([expect.objectContaining({
      adapterReady: false,
      health: '未查询',
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      statusSource: '项目配置',
    })])
  })

  it('把活动、内容组和人工交接整理成活动详情投影', () => {
    const activity: PublishingActivity = {
      activityId: 'activity-a',
      campaignId: 'activity-a',
      channels: [{
        contentFormats: ['article'],
        id: 'github',
        locale: 'en',
      }],
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
      channelContentReadiness: {
        'content-a': {
          artifactIds: [],
          matchingArtifactIds: [],
          missingMediaKinds: ['image'],
          ready: false,
          reason: 'At least 1 matching image artifact is required',
          requirement: {
            allowedKinds: ['image'],
            minCount: 1,
          },
        },
      },
      channelContents: [content],
      contentGroups: [contentGroup],
      ownerHandoffs: [handoff],
    })

    expect(campaign).toMatchObject({
      activityStatus: '已规划',
      channelContentFormats: { github: ['article'] },
      channels: ['github'],
      contentGroups: [{ contents: [{
        accountAlias: '项目账号',
        publicationReadiness: '发布受阻 · 至少 1 张图片，当前匹配 0 个活动产物',
        publicationReady: false,
        title: 'Channel article',
      }] }],
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

  it('把活动渠道结果和业务进度集中投影，区分发布回执与监测观测', () => {
    const content = {
      channel: 'github' as const,
      contentId: 'content-a',
      format: '文章' as const,
      locale: 'zh-CN' as const,
      status: '已生成' as const,
      title: '版本说明',
    }
    const results = activityPublicationProjections({
      activityId: 'activity-a',
      contentGroups: [{
        contentGroupId: 'group-a',
        contents: [content],
        coreMessage: '说明版本变化',
        title: '版本内容',
      }],
      monitoringObservations: [{
        activityId: 'activity-a',
        channel: 'github',
        collectedAt: '2026-08-03T10:00:00.000Z',
        metrics: { reads: 12 },
        observationId: 'observation-a',
        projectId: 'project-a',
        publicationId: 'publication-a',
        source: 'public',
      }],
      publicationPlans: [{
        activityId: 'activity-a',
        channel: 'github',
        contentId: 'content-a',
        projectId: 'project-a',
        publicationId: 'publication-a',
      }],
      publicationReceipts: [{
        activityId: 'activity-a',
        channel: 'github',
        externalReceiptId: 'receipt-a',
        projectId: 'project-a',
        publicationId: 'publication-a',
        receiptId: 'receipt-a',
        status: 'published',
      }],
    })

    expect(results).toMatchObject([{
      channel: 'github',
      latestObservation: {
        metrics: '阅读 12',
        source: '公开页面',
      },
      status: '已发布',
    }])
    const progress = activityBusinessProgressProjection({
      channels: ['github'],
      contentGroups: [{
        contentGroupId: 'group-a',
        contents: [content],
        coreMessage: '说明版本变化',
        title: '版本内容',
      }],
      publicationResults: results,
      tasks: [{ kind: 'production', status: 'composing' }],
    })
    expect(progress.find(stage => stage.label === '主题与渠道')).toMatchObject({ status: 'done' })
    expect(progress.find(stage => stage.label === '发布回执')).toMatchObject({ status: 'done' })
  })
})
