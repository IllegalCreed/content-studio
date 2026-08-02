import type {
  CampaignJobStatus,
  ChannelId,
} from '@content-studio/core-types'

export interface ProjectProjection {
  canonicalUrl: string
  facts: string[]
  integrationMode: '有源项目' | '无源项目'
  locales: string[]
  name: string
  previewReady: boolean
  projectId: string
  recordingMode: '项目适配器' | '浏览器辅助'
  version: string
}

export interface ReportProjection {
  activityId: string
  activityTitle: string
  accountAlias: string
  channel: ChannelId
  contentType: '文章' | '视频'
  lastChecked: string
  metrics: Array<{ label: string, value: string }>
  note: string
  status: '监测中' | '等待发布回执'
}

export interface VideoJobProjection {
  attempt: number
  completedActions: number
  events: Array<{
    kind: string
    message: string
    sequence: number
  }>
  jobId: string
  previewLabel: string
  totalActions: number
}

export interface OwnerHandoffProjection {
  accountAlias: string
  checklist: string[]
  channel: ChannelId
  expiresAt: string
  handoffId: string
  officialTargetUrl: string
  reason: string
  status: 'ready' | 'waiting'
}

export type ActivityStatusProjection = '草稿' | '已规划' | '进行中' | '已完成' | '已归档'

export type TaskStepStatus = 'done' | 'active' | 'pending' | 'blocked'

export interface TaskStepProjection {
  detail: string
  label: string
  status: TaskStepStatus
}

export interface ChannelContentProjection {
  accountAlias?: string
  channel: ChannelId
  contentId: string
  format: '文章' | '视频'
  locale: 'zh-CN' | 'en'
  status: '草稿' | '已生成' | '制作中' | '待审核' | '已完成'
  title: string
}

export interface ContentGroupProjection {
  contents: ChannelContentProjection[]
  contentGroupId: string
  coreMessage: string
  title: string
}

export interface AssetProjection {
  assetId: string
  kind: 'audio' | 'font' | 'image' | 'logo' | 'template' | 'video'
  name: string
  referencedBy: string[]
  retention: '长期保留' | '可回收'
  size: string
  source: string
  version: string
}

export interface ActivityArtifactProjection {
  activityId: string
  artifactId: string
  kind: '文章版本' | '图片' | '预览帧' | '视频片段' | '视频'
  name: string
  size: string
  status: '中间产物' | '最终产物'
}

export interface TaskProjection {
  accountAlias: string
  activityId: string
  activityTitle: string
  attempt: number
  channel: ChannelId
  contentTitle: string
  detail: string
  kind: '制作' | '发布' | '监测'
  progress?: number
  status: CampaignJobStatus
  steps: TaskStepProjection[]
  taskId: string
  title: string
}

export interface StorageProjection {
  activityArtifacts: number
  cacheSize: string
  projectAssets: number
  projectSize: string
  retention: string
}

export interface ChannelProjection {
  accounts: ChannelAccountProjection[]
  adapterReady: boolean
  alias: string | null
  bodyLimit: number
  channel: ChannelId
  delivery: '全自动候选' | '人工辅助' | '仅生成内容'
  defaultAccountId: string | null
  enabled: boolean
  format: '文章' | '短帖' | '视频信息'
  health: '已就绪' | '需重新授权' | '已阻塞' | '未配置' | '未查询'
  metrics: string[]
  nextAction: string | null
  statusSource: 'marketing-ops' | '项目配置'
  titleLimit: number
}

export type ChannelHealthProjection = ChannelProjection['health']

export interface ChannelAccountProjection {
  accountId: string
  adapterReady: boolean
  alias: string
  assignedProjects: string[]
  channel: ChannelId
  health: ChannelHealthProjection
  isDefault: boolean
  nextAction: string | null
  statusSource: 'marketing-ops' | '项目配置'
}

export interface CampaignProjection {
  assets: number
  campaignId: string
  channels: ChannelId[]
  contentGroups: ContentGroupProjection[]
  executionStatus: CampaignJobStatus
  handoffs: OwnerHandoffProjection[]
  nextAction: string
  referencedAssets: string[]
  activityArtifacts: ActivityArtifactProjection[]
  activityStatus: ActivityStatusProjection
  topic: string
  title: string
  videoJob: VideoJobProjection | null
}

export interface WorkbenchSnapshot {
  activityArtifacts: ActivityArtifactProjection[]
  channelBlueprintCount: number
  campaigns: CampaignProjection[]
  channels: ChannelProjection[]
  projectAssets: AssetProjection[]
  project: ProjectProjection
  reports: ReportProjection[]
  runtimeConnected: boolean
  storage: StorageProjection
  tasks: TaskProjection[]
}

function channelAccount(input: Omit<ChannelAccountProjection, 'assignedProjects'> & { assignedProjects?: string[] }): ChannelAccountProjection {
  return {
    assignedProjects: ['algorithm-visualizer'],
    ...input,
  }
}

export const snapshot: WorkbenchSnapshot = {
  campaigns: [
    {
      assets: 14,
      campaignId: 'quick-sort-guide',
      channels: [
        'bilibili',
        'github',
        'youtube',
        'zhihu',
      ],
      contentGroups: [
        {
          contentGroupId: 'quick-sort-core',
          coreMessage: '用可视化演示解释分区、比较和交换的过程。',
          title: '核心算法演示',
          contents: [
            {
              accountAlias: 'Algorithm Visualizer',
              channel: 'bilibili',
              contentId: 'quick-sort-video-bilibili',
              format: '视频',
              locale: 'zh-CN',
              status: '制作中',
              title: '快速排序演示视频',
            },
            {
              accountAlias: 'Algorithm Visualizer Docs',
              channel: 'zhihu',
              contentId: 'quick-sort-article-zhihu',
              format: '文章',
              locale: 'zh-CN',
              status: '已生成',
              title: '快速排序原理与可视化',
            },
          ],
        },
      ],
      executionStatus: 'recording',
      handoffs: [],
      nextAction: '查看最新预览帧，确认录制是否符合拍摄大纲。',
      referencedAssets: [
        'algorithm-logo',
        'algorithm-font',
        'quick-sort-template',
      ],
      activityArtifacts: [
        {
          activityId: 'quick-sort-guide',
          artifactId: 'quick-sort-preview-frame',
          kind: '预览帧',
          name: '分区动画 · 第 20 帧',
          size: '420 KB',
          status: '中间产物',
        },
        {
          activityId: 'quick-sort-guide',
          artifactId: 'quick-sort-video-final',
          kind: '视频',
          name: '快速排序演示 · 竖屏版本',
          size: '86 MB',
          status: '最终产物',
        },
      ],
      activityStatus: '进行中',
      topic: '让第一次接触算法的用户看懂快速排序。',
      title: '快速排序可视化指南',
      videoJob: {
        attempt: 2,
        completedActions: 7,
        events: [
          {
            kind: 'scene-started',
            message: '英文快速排序场景已开始。',
            sequence: 18,
          },
          {
            kind: 'action-completed',
            message: '播放控件动作已完成。',
            sequence: 19,
          },
          {
            kind: 'preview-ready',
            message: '分区过程预览帧已生成。',
            sequence: 20,
          },
        ],
        jobId: 'quick-sort-guide-recording',
        previewLabel: '分区动画 · 第 20 帧',
        totalActions: 12,
      },
    },
    {
      assets: 22,
      campaignId: 'release-notes',
      channels: [
        'bluesky',
        'dev',
        'github',
        'x',
      ],
      contentGroups: [
        {
          contentGroupId: 'release-notes-summary',
          coreMessage: '用一组渠道化内容说明本次版本更新的重点。',
          title: '版本更新摘要',
          contents: [
            {
              accountAlias: 'IllegalCreed',
              channel: 'github',
              contentId: 'release-notes-github',
              format: '文章',
              locale: 'en',
              status: '待审核',
              title: 'Algorithm Visualizer release notes',
            },
            {
              accountAlias: 'Algorithm Visualizer',
              channel: 'x',
              contentId: 'release-notes-x',
              format: '视频',
              locale: 'en',
              status: '已生成',
              title: 'Version update overview',
            },
          ],
        },
      ],
      executionStatus: 'awaiting-owner',
      handoffs: [
        {
          accountAlias: 'Algorithm Visualizer',
          channel: 'x',
          checklist: [
            '打开官方发布页面并确认账号已登录',
            '检查标题、正文和视频版本',
            '完成平台审核或验证码',
            '点击最终发布并返回公开地址',
          ],
          expiresAt: '2026-08-03 18:00',
          handoffId: 'handoff-x-01',
          officialTargetUrl: 'https://x.com/compose/post',
          reason: '请在官方页面完成审核和最终发布点击。',
          status: 'ready',
        },
      ],
      nextAction: '先由渠道授权人审核，之后才能等待发布回执。',
      referencedAssets: [
        'algorithm-logo',
        'release-template',
      ],
      activityArtifacts: [
        {
          activityId: 'release-notes',
          artifactId: 'release-notes-article',
          kind: '文章版本',
          name: '版本更新文章 · 英文版',
          size: '18 KB',
          status: '最终产物',
        },
        {
          activityId: 'release-notes',
          artifactId: 'release-notes-cover',
          kind: '图片',
          name: '版本更新封面',
          size: '1.8 MB',
          status: '最终产物',
        },
      ],
      activityStatus: '已规划',
      topic: '让用户快速了解 Algorithm Visualizer 的本次版本更新。',
      title: '版本更新发布',
      videoJob: {
        attempt: 1,
        completedActions: 9,
        events: [
          {
            kind: 'attempt-completed',
            message: '录制回执已保存，共完成 9 个动作。',
            sequence: 27,
          },
        ],
        jobId: 'release-notes-recording',
        previewLabel: '版本更新概览 · 最终帧',
        totalActions: 9,
      },
    },
  ],
  activityArtifacts: [
    {
      activityId: 'quick-sort-guide',
      artifactId: 'quick-sort-preview-frame',
      kind: '预览帧',
      name: '分区动画 · 第 20 帧',
      size: '420 KB',
      status: '中间产物',
    },
    {
      activityId: 'quick-sort-guide',
      artifactId: 'quick-sort-video-final',
      kind: '视频',
      name: '快速排序演示 · 竖屏版本',
      size: '86 MB',
      status: '最终产物',
    },
    {
      activityId: 'release-notes',
      artifactId: 'release-notes-article',
      kind: '文章版本',
      name: '版本更新文章 · 英文版',
      size: '18 KB',
      status: '最终产物',
    },
    {
      activityId: 'release-notes',
      artifactId: 'release-notes-cover',
      kind: '图片',
      name: '版本更新封面',
      size: '1.8 MB',
      status: '最终产物',
    },
  ],
  channelBlueprintCount: 19,
  channels: [
    {
      accounts: [
        channelAccount({
          accountId: 'github-illegalcreed',
          adapterReady: true,
          alias: 'IllegalCreed',
          channel: 'github',
          health: '已就绪',
          isDefault: true,
          nextAction: null,
          statusSource: 'marketing-ops',
        }),
        channelAccount({
          accountId: 'github-algorithm-docs',
          adapterReady: false,
          alias: 'Algorithm Visualizer Docs',
          channel: 'github',
          health: '未查询',
          isDefault: false,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
      ],
      adapterReady: true,
      alias: 'IllegalCreed',
      bodyLimit: 12000,
      channel: 'github',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '已就绪',
      metrics: ['发布回执', '公开地址', '阅读量'],
      nextAction: null,
      statusSource: 'marketing-ops',
      titleLimit: 128,
      defaultAccountId: 'github-illegalcreed',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'bilibili-algorithm-visualizer',
          adapterReady: false,
          alias: 'Algorithm Visualizer',
          channel: 'bilibili',
          health: '未查询',
          isDefault: true,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
        channelAccount({
          accountId: 'bilibili-algorithm-shorts',
          adapterReady: false,
          alias: 'Algorithm Visualizer Shorts',
          channel: 'bilibili',
          health: '未查询',
          isDefault: false,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
      ],
      adapterReady: false,
      alias: 'Algorithm Visualizer',
      bodyLimit: 2000,
      channel: 'bilibili',
      delivery: '人工辅助',
      enabled: true,
      format: '视频信息',
      health: '未查询',
      metrics: ['发布回执', '公开地址', '播放量', '评论'],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      statusSource: '项目配置',
      titleLimit: 80,
      defaultAccountId: 'bilibili-algorithm-visualizer',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'bluesky-illegalscreed',
          adapterReady: true,
          alias: 'illegalscreed.bsky.social',
          channel: 'bluesky',
          health: '已就绪',
          isDefault: true,
          nextAction: null,
          statusSource: 'marketing-ops',
        }),
      ],
      adapterReady: true,
      alias: 'illegalscreed.bsky.social',
      bodyLimit: 300,
      channel: 'bluesky',
      delivery: '全自动候选',
      enabled: true,
      format: '短帖',
      health: '已就绪',
      metrics: ['发布回执', '公开地址', '点赞', '回复'],
      nextAction: null,
      statusSource: 'marketing-ops',
      titleLimit: 80,
      defaultAccountId: 'bluesky-illegalscreed',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'dev-illegal',
          adapterReady: false,
          alias: 'illegal',
          channel: 'dev',
          health: '需重新授权',
          isDefault: true,
          nextAction: '运行 marketing-ops setup dev',
          statusSource: 'marketing-ops',
        }),
      ],
      adapterReady: false,
      alias: 'illegal',
      bodyLimit: 12000,
      channel: 'dev',
      delivery: '全自动候选',
      enabled: true,
      format: '文章',
      health: '需重新授权',
      metrics: ['发布回执', '公开地址', '阅读量', '评论'],
      nextAction: '运行 marketing-ops setup dev',
      statusSource: 'marketing-ops',
      titleLimit: 128,
      defaultAccountId: 'dev-illegal',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'mastodon-illegals0001',
          adapterReady: true,
          alias: 'illegals0001@mastodon.social',
          channel: 'mastodon',
          health: '已就绪',
          isDefault: true,
          nextAction: null,
          statusSource: 'marketing-ops',
        }),
      ],
      adapterReady: true,
      alias: 'illegals0001@mastodon.social',
      bodyLimit: 500,
      channel: 'mastodon',
      delivery: '全自动候选',
      enabled: true,
      format: '短帖',
      health: '已就绪',
      metrics: ['发布回执', '公开地址', '点赞', '回复'],
      nextAction: null,
      statusSource: 'marketing-ops',
      titleLimit: 80,
      defaultAccountId: 'mastodon-illegals0001',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'youtube-algorithm-visualizer',
          adapterReady: false,
          alias: 'Algorithm Visualizer',
          channel: 'youtube',
          health: '未查询',
          isDefault: true,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
      ],
      adapterReady: false,
      alias: 'Algorithm Visualizer',
      bodyLimit: 5000,
      channel: 'youtube',
      delivery: '人工辅助',
      enabled: true,
      format: '视频信息',
      health: '未查询',
      metrics: ['发布回执', '公开地址', '播放量', '评论'],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      statusSource: '项目配置',
      titleLimit: 100,
      defaultAccountId: 'youtube-algorithm-visualizer',
    },
    {
      accounts: [
        channelAccount({
          accountId: 'zhihu-algorithm-docs',
          adapterReady: false,
          alias: 'Algorithm Visualizer Docs',
          channel: 'zhihu',
          health: '未查询',
          isDefault: true,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
      ],
      adapterReady: false,
      alias: 'Algorithm Visualizer Docs',
      bodyLimit: 20000,
      channel: 'zhihu',
      delivery: '人工辅助',
      enabled: true,
      format: '文章',
      health: '未查询',
      metrics: ['发布回执', '公开地址', '阅读量', '评论'],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      statusSource: '项目配置',
      titleLimit: 100,
      defaultAccountId: 'zhihu-algorithm-docs',
    },
    {
      accounts: [],
      adapterReady: false,
      alias: null,
      bodyLimit: 2000,
      channel: 'weibo',
      delivery: '人工辅助',
      enabled: false,
      format: '短帖',
      health: '已阻塞',
      metrics: ['发布回执', '公开地址', '阅读量', '评论'],
      nextAction: '在项目配置中启用渠道',
      statusSource: 'marketing-ops',
      titleLimit: 55,
      defaultAccountId: null,
    },
    {
      accounts: [
        channelAccount({
          accountId: 'x-algorithm-visualizer',
          adapterReady: false,
          alias: 'Algorithm Visualizer',
          channel: 'x',
          health: '未查询',
          isDefault: true,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
        channelAccount({
          accountId: 'x-company',
          adapterReady: false,
          alias: 'Company',
          channel: 'x',
          health: '未查询',
          isDefault: false,
          nextAction: '尚未读取该账号的 marketing-ops 状态',
          statusSource: '项目配置',
        }),
      ],
      adapterReady: false,
      alias: null,
      bodyLimit: 280,
      channel: 'x',
      delivery: '人工辅助',
      enabled: true,
      format: '短帖',
      health: '未查询',
      metrics: ['发布回执', '公开地址', '点赞', '回复'],
      nextAction: '尚未读取该渠道的 marketing-ops 状态',
      statusSource: '项目配置',
      titleLimit: 70,
      defaultAccountId: 'x-algorithm-visualizer',
    },
  ],
  projectAssets: [
    {
      assetId: 'algorithm-logo',
      kind: 'logo',
      name: 'Algorithm Visualizer 主 Logo',
      referencedBy: ['快速排序可视化指南', '版本更新发布'],
      retention: '长期保留',
      size: '18 KB',
      source: '项目上传',
      version: 'v3',
    },
    {
      assetId: 'algorithm-font',
      kind: 'font',
      name: '项目展示字体',
      referencedBy: ['快速排序可视化指南'],
      retention: '长期保留',
      size: '264 KB',
      source: '项目上传',
      version: 'v1',
    },
    {
      assetId: 'quick-sort-template',
      kind: 'template',
      name: '算法演示视频模板',
      referencedBy: ['快速排序可视化指南'],
      retention: '长期保留',
      size: '42 KB',
      source: '项目内适配器',
      version: 'v2',
    },
    {
      assetId: 'release-template',
      kind: 'image',
      name: '版本更新封面模板',
      referencedBy: ['版本更新发布'],
      retention: '长期保留',
      size: '1.2 MB',
      source: '项目上传',
      version: 'v1',
    },
  ],
  project: {
    canonicalUrl: 'https://algo.illegalscreed.cn/',
    facts: [
      '页面状态通过语义 testid 标注，可生成稳定录制计划',
      '项目适配器只允许受审查的窄范围动作',
      '内容生成与录制产物默认写入 .content-studio/',
    ],
    integrationMode: '有源项目',
    locales: [
      'zh-CN',
      'en',
    ],
    name: 'Algorithm Visualizer',
    previewReady: true,
    projectId: 'algorithm-visualizer',
    recordingMode: '项目适配器',
    version: 'manifest v1',
  },
  reports: [
    {
      activityId: 'quick-sort-guide',
      activityTitle: '快速排序可视化指南',
      accountAlias: 'Algorithm Visualizer',
      channel: 'bilibili',
      contentType: '视频',
      lastChecked: '演示数据 · 2026-08-02 09:30',
      metrics: [
        { label: '播放量', value: '1,284' },
        { label: '点赞', value: '86' },
        { label: '评论', value: '12' },
        { label: '收藏', value: '34' },
      ],
      note: '正式版本需要匹配的发布回执；当前仅用于展示监测面板。',
      status: '监测中',
    },
    {
      activityId: 'release-notes',
      activityTitle: '版本更新发布',
      accountAlias: 'Algorithm Visualizer',
      channel: 'x',
      contentType: '视频',
      lastChecked: '尚未采集 · 无成功发布回执',
      metrics: [
        { label: '播放量', value: '—' },
        { label: '阅读量', value: '—' },
        { label: '回复', value: '—' },
        { label: '转发', value: '—' },
      ],
      note: '等待渠道授权人审核和最终发布点击。',
      status: '等待发布回执',
    },
  ],
  runtimeConnected: false,
  storage: {
    activityArtifacts: 36,
    cacheSize: '412 MB',
    projectAssets: 14,
    projectSize: '2.8 GB',
    retention: '最终素材长期保留，临时产物 30 天',
  },
  tasks: [
    {
      accountAlias: 'Algorithm Visualizer',
      activityId: 'quick-sort-guide',
      activityTitle: '快速排序可视化指南',
      attempt: 2,
      channel: 'bilibili',
      contentTitle: '快速排序演示视频',
      detail: '7 / 12 个动作已完成 · 预览帧已生成',
      kind: '制作',
      progress: 58,
      status: 'recording',
      steps: [
        { detail: '主题和事实已确认', label: '生成脚本和拍摄大纲', status: 'done' },
        { detail: '12 个浏览器动作已编译', label: '生成分镜和录制计划', status: 'done' },
        { detail: '已完成 7 / 12 个动作', label: '浏览器录制', status: 'active' },
        { detail: '等待录制完成', label: '生成预览帧', status: 'pending' },
        { detail: '等待录制完成', label: '合成视频和资源变体', status: 'pending' },
      ],
      taskId: 'quick-sort-guide-recording',
      title: '录制快速排序演示视频',
    },
    {
      accountAlias: 'Algorithm Visualizer',
      activityId: 'release-notes',
      activityTitle: '版本更新发布',
      attempt: 1,
      channel: 'x',
      contentTitle: 'Version update overview',
      detail: '等待渠道授权人登录、审核和最终点击',
      kind: '发布',
      status: 'awaiting-owner',
      steps: [
        { detail: '文章、视频和封面已准备', label: '准备渠道发布包', status: 'done' },
        { detail: '等待渠道授权人处理', label: '官方页面审核和最终点击', status: 'active' },
        { detail: '需要公开地址才能继续', label: '保存发布回执', status: 'pending' },
      ],
      taskId: 'release-notes-publish-x',
      title: '发布到 X',
    },
    {
      accountAlias: 'Algorithm Visualizer',
      activityId: 'quick-sort-guide',
      activityTitle: '快速排序可视化指南',
      attempt: 1,
      channel: 'bilibili',
      contentTitle: '快速排序演示视频',
      detail: '发布后 1 小时采集播放量、点赞和评论',
      kind: '监测',
      status: 'monitoring',
      steps: [
        { detail: '已绑定发布回执', label: '建立监测计划', status: 'done' },
        { detail: '等待下一个采集窗口', label: '采集播放量和互动', status: 'active' },
        { detail: '发布后 48 小时采集', label: '补充长期数据', status: 'pending' },
      ],
      taskId: 'quick-sort-guide-monitoring',
      title: '追踪快速排序视频表现',
    },
  ],
}

export const lifecycleStages: CampaignJobStatus[] = [
  'queued',
  'generating',
  'recording',
  'composing',
  'awaiting-owner',
  'published',
  'monitoring',
]

export function humanizeStatus(status: CampaignJobStatus): string {
  const labels: Record<CampaignJobStatus, string> = {
    'awaiting-owner': '等待人工',
    'cancelled': '已取消',
    'composing': '合成中',
    'failed': '失败',
    'generating': '生成中',
    'monitoring': '监测中',
    'published': '已发布',
    'queued': '排队中',
    'recording': '录制中',
  }
  return labels[status]
}

export function humanizeActivityStatus(status: ActivityStatusProjection): string {
  return status
}

export function humanizeEventKind(kind: string): string {
  const labels: Record<string, string> = {
    'action-completed': '动作完成',
    'attempt-completed': '本轮完成',
    'attempt-started': '开始尝试',
    'preview-ready': '预览已生成',
    'scene-started': '场景开始',
  }
  return labels[kind] ?? kind
}
