import type {
  ActivityArtifact,
  CampaignJobStatus,
  ChannelId,
  ContentStudioProjectView,
  ExecutionTask,
  ExecutionTaskEvent,
  ObservationMetric,
  VideoFormat,
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
  status: '监测中' | '发布失败' | '等待发布回执' | '等待监测数据'
}

const reportMetricLabels: Record<ObservationMetric, string> = {
  clicks: '点击量',
  comments: '评论',
  favorites: '收藏',
  likes: '点赞',
  reads: '阅读量',
  replies: '回复',
  shares: '转发',
  views: '播放量',
}

const reportMetricOrder: ObservationMetric[] = [
  'views',
  'reads',
  'likes',
  'comments',
  'favorites',
  'replies',
  'shares',
  'clicks',
]

export function runtimeReports(
  projectView: ContentStudioProjectView,
): ReportProjection[] {
  const activityById = new Map(
    projectView.activities.map(activity => [activity.activityId, activity]),
  )
  const contentById = new Map(
    projectView.channelContents.map(content => [content.contentId, content]),
  )
  const receiptByPublication = new Map(
    projectView.publicationReceipts.map(receipt => [receipt.publicationId, receipt]),
  )
  const observationsByPublication = new Map<string, ContentStudioProjectView['monitoringObservations']>()
  for (const observation of projectView.monitoringObservations) {
    const observations = observationsByPublication.get(observation.publicationId) ?? []
    observations.push(observation)
    observationsByPublication.set(observation.publicationId, observations)
  }
  const accountAliasByChannel = new Map(
    projectView.projectChannelBindings.map(binding => [
      binding.channel,
      binding.accountAlias ?? '项目账号',
    ]),
  )

  return projectView.publicationPlans.map((plan) => {
    const activity = activityById.get(plan.activityId)
    const content = contentById.get(plan.contentId)
    const receipt = receiptByPublication.get(plan.publicationId)
    const latestObservation = [...(observationsByPublication.get(plan.publicationId) ?? [])]
      .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))[0]
    const metrics = latestObservation === undefined
      ? defaultReportMetrics(content?.format)
      : reportMetrics(latestObservation.metrics, content?.format)
    const status = receipt?.status === 'failed'
      ? '发布失败'
      : latestObservation !== undefined
        ? '监测中'
        : receipt?.status === 'published'
          ? '等待监测数据'
          : '等待发布回执'
    return {
      activityId: plan.activityId,
      activityTitle: activity?.topic['zh-CN'] ?? activity?.topic.en ?? plan.activityId,
      accountAlias: accountAliasByChannel.get(plan.channel) ?? '项目账号待绑定',
      channel: plan.channel,
      contentType: content?.format === 'video' ? '视频' : '文章',
      lastChecked: latestObservation === undefined
        ? receipt?.status === 'published' ? '已发布 · 尚未采集' : '尚未采集 · 无成功发布回执'
        : `最近采集 · ${latestObservation.collectedAt}`,
      metrics,
      note: receipt?.status === 'failed'
        ? '渠道回执标记为失败，请检查授权人处理结果。'
        : latestObservation === undefined
          ? receipt?.status === 'published'
            ? '已收到成功发布回执，等待第一条监测数据。'
            : '发布安排已创建，等待匹配的 marketing-ops 发布回执。'
          : `数据来源：${latestObservation.source}`,
      status,
    }
  })
}

export function runtimeActivityArtifacts(
  projectView: ContentStudioProjectView,
): ActivityArtifactProjection[] {
  return activityArtifactProjections(projectView.activityArtifacts)
}

export function activityArtifactProjections(
  artifacts: ActivityArtifact[],
): ActivityArtifactProjection[] {
  return artifacts.map(artifact => ({
    activityId: artifact.activityId,
    artifactId: artifact.artifactId,
    kind: activityArtifactKindLabel(artifact.kind),
    name: fileName(artifact.relativePath),
    size: '未记录',
    status: '已登记',
  }))
}

export function runtimeProjectAssets(
  projectView: ContentStudioProjectView,
): AssetProjection[] {
  const activityById = new Map(
    projectView.activities.map(activity => [
      activity.activityId,
      activity.topic['zh-CN'] ?? activity.topic.en ?? activity.activityId,
    ]),
  )
  const artifactActivityById = new Map(
    projectView.activityArtifacts.map(artifact => [artifact.artifactId, artifact.activityId]),
  )
  const assetReferences = new Map<string, Set<string>>()
  const addReference = (assetId: string, activityId: string): void => {
    const references = assetReferences.get(assetId) ?? new Set<string>()
    const title = activityById.get(activityId)
    if (title !== undefined)
      references.add(title)
    assetReferences.set(assetId, references)
  }
  for (const content of projectView.channelContents) {
    for (const artifactId of content.artifactIds) {
      const activityId = artifactActivityById.get(artifactId) ?? content.activityId
      addReference(artifactId, activityId)
    }
  }
  for (const asset of projectView.projectAssets) {
    if (asset.sourceArtifactId !== undefined) {
      const sourceReferences = assetReferences.get(asset.sourceArtifactId)
      if (sourceReferences !== undefined)
        assetReferences.set(asset.assetId, new Set(sourceReferences))
    }
  }

  return projectView.projectAssets.map(asset => ({
    assetId: asset.assetId,
    kind: asset.kind,
    name: fileName(asset.relativePath),
    referencedBy: [...(assetReferences.get(asset.assetId) ?? new Set<string>())],
    retention: '长期保留',
    size: '未记录',
    source: asset.sourceArtifactId === undefined ? '项目登记' : '活动产物晋升',
    version: `v${asset.version}`,
  }))
}

function activityArtifactKindLabel(
  kind: ContentStudioProjectView['activityArtifacts'][number]['kind'],
): ActivityArtifactProjection['kind'] {
  return kind === 'article-version'
    ? '文章版本'
    : kind === 'preview-frame'
      ? '预览帧'
      : kind === 'video-clip'
        ? '视频片段'
        : kind === 'video'
          ? '视频'
          : kind === 'image'
            ? '图片'
            : '音频'
}

function fileName(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u)
  return segments.at(-1) || relativePath
}

function defaultReportMetrics(format: 'article' | 'video' | undefined): ReportProjection['metrics'] {
  const keys: ObservationMetric[] = format === 'video'
    ? ['views', 'likes', 'comments', 'favorites']
    : ['reads', 'likes', 'comments', 'shares']
  return keys.map(key => ({ label: reportMetricLabels[key], value: '—' }))
}

function reportMetrics(
  metrics: Partial<Record<ObservationMetric, number | null>>,
  format: 'article' | 'video' | undefined,
): ReportProjection['metrics'] {
  const preferredKeys: ObservationMetric[] = format === 'video'
    ? ['views', 'likes', 'comments', 'favorites']
    : ['reads', 'likes', 'comments', 'shares']
  const keys = [
    ...preferredKeys,
    ...reportMetricOrder.filter(key => !preferredKeys.includes(key) && metrics[key] !== undefined),
  ]
  return keys.map(key => ({
    label: reportMetricLabels[key],
    value: metrics[key] === null || metrics[key] === undefined
      ? '—'
      : metrics[key]!.toLocaleString('zh-CN'),
  }))
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

export interface VideoPlanSceneProjection {
  flowId: string
  objective: string
  startPath: string
  title: string
}

export interface VideoPlanProjection {
  format: VideoFormat
  planVersion: number
  reviewStatus: '已确认' | '待确认'
  scenes: VideoPlanSceneProjection[]
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

export type TaskStepStatus = 'done' | 'active' | 'pending' | 'blocked' | 'skipped'

export interface TaskStepProjection {
  detail: string
  label: string
  status: TaskStepStatus
}

export interface TaskAttemptProjection {
  attempt: number
  eventCount: number
  lastEvent: string
  status: string
}

export interface TaskLifecycleProjection {
  attempts: TaskAttemptProjection[]
  detail: string
  progress: number
  steps: TaskStepProjection[]
}

const taskLifecycleLabels: Record<CampaignJobStatus, string> = {
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

/**
 * Builds the task detail from the persisted task state and event stream.
 * The activity remains the business object; these stages describe only one
 * execution task and therefore vary by task kind.
 */
export function taskLifecycleProjection(
  task: ExecutionTask,
  events: ExecutionTaskEvent[] = [],
): TaskLifecycleProjection {
  const lifecycle = taskLifecycleFor(task)
  const currentIndex = lifecycle.indexOf(task.status)
  const completed = completedTask(task)
  const latestObservedIndex = terminalTask(task.status)
    ? latestLifecycleIndex(lifecycle, events)
    : currentIndex
  const progressIndex = Math.max(
    0,
    Math.min(latestObservedIndex < 0 ? 0 : latestObservedIndex, lifecycle.length - 1),
  )
  const isComplete = currentIndex === lifecycle.length - 1
    && (completed || task.kind !== 'monitoring')
  const progress = isComplete
    ? 100
    : lifecycle.length <= 1
      ? 0
      : Math.round((progressIndex / (lifecycle.length - 1)) * 100)
  const lastEvent = events.at(-1)
  const detail = lastEvent === undefined
    ? task.status === 'queued'
      ? '任务已创建，等待执行。'
      : `当前阶段：${humanizeTaskStatus(task.status)}`
    : taskEventSummary(lastEvent)

  return {
    attempts: taskAttemptProjections(task, events),
    detail,
    progress,
    steps: lifecycle.map((stage, index) => {
      const skipped = isTaskStageSkipped(task, stage)
      const status: TaskStepStatus = skipped
        ? 'skipped'
        : completed
          ? 'done'
          : terminalTask(task.status)
            ? index < latestObservedIndex
              ? 'done'
              : index === latestObservedIndex
                ? 'blocked'
                : 'pending'
            : index < currentIndex
              ? 'done'
              : index === currentIndex
                ? 'active'
                : 'pending'
      return {
        detail: skipped
          ? '该任务已配置跳过此阶段'
          : status === 'done'
            ? '已完成'
            : status === 'blocked'
              ? `在${humanizeTaskStatus(task.status)}前中断`
              : status === 'active'
                ? `当前阶段：${humanizeTaskStatus(stage)}`
                : '等待前一阶段完成',
        label: humanizeTaskStatus(stage),
        status,
      }
    }),
  }
}

export function humanizeTaskStatus(status: CampaignJobStatus): string {
  return taskLifecycleLabels[status]
}

export function humanizeTaskEventKind(kind: string): string {
  const labels: Record<string, string> = {
    'attempt-cancelled': '尝试已取消',
    'attempt-retried': '创建重试',
    'stage-skipped': '跳过阶段',
    'status-changed': '状态变化',
    'task-created': '任务创建',
  }
  return labels[kind] ?? kind
}

export function taskEventSummary(event: ExecutionTaskEvent): string {
  if (event.kind === 'task-created')
    return '任务已创建，等待执行。'
  if (event.kind === 'stage-skipped' && event.stage !== undefined)
    return `已跳过${humanizeTaskStatus(event.stage).replace(/中$/u, '')}阶段`
  if (event.kind === 'attempt-retried')
    return `已创建第 ${event.attempt} 次重试`
  if (event.kind === 'attempt-cancelled')
    return `第 ${event.attempt} 次尝试已取消`
  if (event.fromStatus !== undefined && event.toStatus !== undefined)
    return `任务从${humanizeTaskStatus(event.fromStatus)}进入${humanizeTaskStatus(event.toStatus)}`
  return event.message
}

function taskAttemptProjections(
  task: ExecutionTask,
  events: ExecutionTaskEvent[],
): TaskAttemptProjection[] {
  const byAttempt = new Map<number, ExecutionTaskEvent[]>()
  for (const event of events) {
    const attemptEvents = byAttempt.get(event.attempt) ?? []
    attemptEvents.push(event)
    byAttempt.set(event.attempt, attemptEvents)
  }
  if (!byAttempt.has(task.attempt))
    byAttempt.set(task.attempt, [])

  return [...byAttempt.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, attemptEvents]) => {
      const last = attemptEvents.at(-1)
      return {
        attempt,
        eventCount: attemptEvents.length,
        lastEvent: last === undefined
          ? attempt === task.attempt ? '当前尝试尚未产生事件' : '没有记录事件'
          : taskEventSummary(last),
        status: humanizeTaskStatus(last?.status ?? (attempt === task.attempt ? task.status : 'failed')),
      }
    })
}

function taskLifecycleFor(task: ExecutionTask): CampaignJobStatus[] {
  if (task.kind === 'publication')
    return ['queued', 'awaiting-owner', 'published']
  if (task.kind === 'monitoring')
    return ['queued', 'monitoring']
  return ['queued', 'generating', 'recording', 'composing']
}

function isTaskStageSkipped(
  task: ExecutionTask,
  stage: CampaignJobStatus,
): boolean {
  if (stage !== 'generating' && stage !== 'recording')
    return false
  return task.skipStages.includes(stage)
    || (task.kind === 'production'
      && task.productionType === 'article'
      && task.status !== 'recording'
      && stage === 'recording')
}

function latestLifecycleIndex(
  lifecycle: CampaignJobStatus[],
  events: ExecutionTaskEvent[],
): number {
  return events.reduce((latest, event) => {
    const candidates = [event.stage, event.toStatus, event.fromStatus, event.status]
    const index = candidates
      .map(status => status === undefined ? -1 : lifecycle.indexOf(status))
      .find(index => index >= 0)
    return index === undefined ? latest : Math.max(latest, index)
  }, -1)
}

function terminalTask(status: CampaignJobStatus): boolean {
  return status === 'cancelled' || status === 'failed'
}

function completedTask(task: ExecutionTask): boolean {
  return task.kind === 'publication' && task.status === 'published'
}

export interface ChannelContentProjection {
  accountAlias?: string
  artifactIds?: string[]
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
  kind: '文章版本' | '图片' | '音频' | '预览帧' | '视频片段' | '视频'
  name: string
  size: string
  status: '中间产物' | '最终产物' | '已登记'
}

export interface TaskProjection {
  accountAlias: string
  activityId: string
  activityTitle: string
  attempt: number
  channel: ChannelId
  contentId?: string
  contentTitle: string
  detail: string
  attempts: TaskAttemptProjection[]
  events: Array<{
    attempt?: number
    kind: string
    message: string
    sequence: number
    stage?: CampaignJobStatus
    status?: CampaignJobStatus
    summary?: string
  }>
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
  version: number
  activityArtifacts: ActivityArtifactProjection[]
  activityStatus: ActivityStatusProjection
  topic: string
  videoPlan: VideoPlanProjection | null
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
      version: 1,
      videoPlan: {
        format: 'portrait',
        planVersion: 2,
        reviewStatus: '待确认',
        scenes: [
          {
            flowId: 'quick-sort',
            objective: '展示分区步骤，让用户看懂比较和交换。',
            startPath: '/quick-sort',
            title: '快速排序 · 分区过程',
          },
        ],
      },
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
      version: 1,
      videoPlan: null,
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
      attempts: [{ attempt: 2, eventCount: 0, lastEvent: '演示数据未加载运行事件', status: '录制中' }],
      events: [],
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
      attempts: [{ attempt: 1, eventCount: 0, lastEvent: '演示数据未加载运行事件', status: '等待人工' }],
      events: [],
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
      attempts: [{ attempt: 1, eventCount: 0, lastEvent: '演示数据未加载运行事件', status: '监测中' }],
      events: [],
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
