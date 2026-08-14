import type {
  ActivityArtifactLocale,
  CampaignJobStatus,
  CampaignVideo,
  ChannelContentFormat,
  ChannelId,
  ContentFormat,
  ContentFormBlueprint,
  ContentMediaRequirement,
  DeliveryMode,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskKind,
  RecordingAttemptRecord,
  VideoFormat,
  VideoViewport,
} from '@content-studio/core-types'
import { CHANNEL_BLUEPRINTS } from '../../../src/constants'

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

export interface ProjectIndexProjection {
  activityCount: number
  enabledChannels: Array<{
    accountAlias?: string
    channel: ChannelId
    delivery: DeliveryMode
  }>
  name: string
  previewReady: boolean
  projectId: string
  snapshotVersion: number
  taskCount: number
  taskCounts: Record<ExecutionTaskKind, number>
}

export interface ReportTimelineProjection {
  collectedAt: string
  metrics: Array<{ label: string, value: string }>
  source: string
}

export interface ReportProjection {
  activityId: string
  activityTitle: string
  accountAlias: string
  channel: ChannelId
  contentType: HumanizedChannelContentFormat
  lastChecked: string
  metrics: Array<{ label: string, value: string }>
  note: string
  publicationId: string
  publicUrl?: string
  status: '监测中' | '发布失败' | '等待发布回执' | '等待监测数据'
  timeline: ReportTimelineProjection[]
}

export type HumanizedChannelContentFormat = '文章' | '图文' | '动态' | '视频'

export interface ChannelContentFormProjection {
  bodyLimit: number
  format: ContentFormat
  isDefault: boolean
  label: HumanizedChannelContentFormat
  mediaSummary: string
  titleLimit: number
}

function fileName(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u)
  return segments.at(-1) || relativePath
}

export interface VideoJobProjection {
  artifacts: Array<{
    id: string
    kind: 'diagnostic' | 'preview-frame' | 'video-clip'
    name: string
    relativePath: string
    size: string
    url: string
  }>
  attempt: number
  completedActions: number
  events: Array<{
    kind: string
    message: string
    sequence: number
  }>
  failure?: string
  jobId: string
  logs: {
    consoleErrors: number
    consoleWarnings: number
    entries: string[]
    pageErrors: number
  }
  outcome: '已取消' | '已完成' | '失败'
  previewLabel: string
  previewUrl?: string
  totalActions: number
}

export function recordingReceiptToVideoJob(
  receipt: RecordingAttemptRecord,
): VideoJobProjection {
  const artifacts = receipt.artifacts.map(artifact => ({
    id: artifact.id,
    kind: artifact.kind,
    name: fileName(artifact.relativePath),
    relativePath: artifact.relativePath,
    size: formatBytes(artifact.sizeBytes),
    url: recordingArtifactUrl(receipt.projectId, receipt.jobId, receipt.attempt, artifact.id),
  }))
  const preview = receipt.artifacts.find(artifact => artifact.kind === 'preview-frame')
  const outcome = receipt.outcome === 'succeeded'
    ? '已完成'
    : receipt.outcome === 'cancelled'
      ? '已取消'
      : '失败'
  const outcomeKind = receipt.outcome === 'succeeded'
    ? 'attempt-completed'
    : receipt.outcome === 'cancelled'
      ? 'attempt-cancelled'
      : 'attempt-failed'
  const events = [
    {
      kind: outcomeKind,
      message: receipt.outcome === 'succeeded'
        ? `本轮完成，共生成 ${receipt.artifacts.length} 个产物。`
        : receipt.failure?.message ?? `本轮${outcome}`,
      sequence: 1,
    },
    ...receipt.logs.entries.map((entry, index) => ({
      kind: 'log',
      message: entry,
      sequence: index + 2,
    })),
  ]
  return {
    artifacts,
    attempt: receipt.attempt,
    completedActions: receipt.completedActions,
    events,
    ...(receipt.failure === undefined ? {} : { failure: receipt.failure.message }),
    jobId: receipt.jobId,
    logs: receipt.logs,
    outcome,
    previewLabel: preview === undefined ? '暂无预览帧' : fileName(preview.relativePath),
    ...(preview === undefined
      ? {}
      : { previewUrl: recordingArtifactUrl(receipt.projectId, receipt.jobId, receipt.attempt, preview.id) }),
    totalActions: receipt.totalActions,
  }
}

function recordingArtifactUrl(
  projectId: string,
  taskId: string,
  attempt: number,
  artifactId: string,
): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/recording-attempts/${attempt}/artifacts/${encodeURIComponent(artifactId)}`
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024)
    return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024)
    return `${Math.round(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface VideoPlanActionProjection {
  kind: string
  label: string
}

export interface VideoPlanSceneProjection {
  actions: VideoPlanActionProjection[]
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
  viewport: VideoViewport
}

export function videoViewportForFormat(
  video: Pick<CampaignVideo, 'format' | 'recordingProfile'>,
): VideoViewport {
  return video.recordingProfile?.defaults?.viewport ?? {
    landscape: { height: 1080, width: 1920 },
    portrait: { height: 1920, width: 1080 },
    square: { height: 1080, width: 1080 },
  }[video.format]
}

export interface OwnerHandoffProjection {
  accountAlias: string
  checklist: string[]
  channel: ChannelId
  confirmationStatus?: 'confirmed' | 'pending'
  expiresAt: string
  handoffId: string
  handoffKind: 'generic' | 'marketing-ops'
  officialTargetUrl: string
  publicUrl?: string
  reason: string
  status: 'cancelled' | 'completed' | 'expired' | 'ready' | 'waiting'
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
  'completed': '已完成',
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

export function humanizeChannelContentFormat(
  format: ChannelContentFormat,
): HumanizedChannelContentFormat {
  return format === 'video'
    ? '视频'
    : format === 'image-text'
      ? '图文'
      : format === 'short-post'
        ? '动态'
        : '文章'
}

export function humanizeTaskEventKind(kind: string): string {
  const labels: Record<string, string> = {
    'attempt-cancelled': '尝试已取消',
    'attempt-retried': '创建重试',
    'composition-cancelled': '合成已取消',
    'composition-completed': '合成完成',
    'composition-cover-ready': '封面已生成',
    'composition-failed': '合成失败',
    'composition-gif-ready': 'GIF 已生成',
    'composition-started': '开始合成',
    'composition-video-ready': '成片已生成',
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
  if (event.kind === 'composition-started')
    return '开始合成成片、封面和 GIF'
  if (event.kind === 'composition-video-ready')
    return compositionArtifactSummary('成片', event)
  if (event.kind === 'composition-cover-ready')
    return compositionArtifactSummary('封面', event)
  if (event.kind === 'composition-gif-ready')
    return compositionArtifactSummary('GIF', event)
  if (event.kind === 'composition-completed')
    return '合成完成'
  if (event.kind === 'composition-cancelled')
    return '合成已取消'
  if (event.kind === 'composition-failed')
    return event.message === '' ? '合成失败' : `合成失败：${event.message}`
  if (event.fromStatus !== undefined && event.toStatus !== undefined)
    return `任务从${humanizeTaskStatus(event.fromStatus)}进入${humanizeTaskStatus(event.toStatus)}`
  return event.message
}

function compositionArtifactSummary(
  label: string,
  event: ExecutionTaskEvent,
): string {
  const artifact = event.artifact
  if (artifact === undefined)
    return event.message
  const dimensions = artifact.width === undefined || artifact.height === undefined
    ? undefined
    : `${artifact.width}×${artifact.height}`
  const details = [
    dimensions,
    formatBytes(artifact.sizeBytes),
  ].filter((value): value is string => value !== undefined)
  return details.length === 0
    ? `${label}已生成`
    : `${label}已生成 · ${details.join(' · ')}`
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
  return ['queued', 'generating', 'recording', 'composing', 'completed']
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
  return status === 'cancelled' || status === 'completed' || status === 'failed'
}

function completedTask(task: ExecutionTask): boolean {
  return task.status === 'completed'
    || (task.kind === 'publication' && task.status === 'published')
}

export interface ChannelContentProjection {
  accountAlias?: string
  artifactIds?: string[]
  body?: string
  channel: ChannelId
  contentId: string
  format: HumanizedChannelContentFormat
  locale: 'zh-CN' | 'en'
  publicationReadiness?: string
  publicationReady?: boolean
  status: '草稿' | '已生成' | '制作中' | '待审核' | '已完成'
  title: string
  version?: number
}

export interface ContentGroupProjection {
  contents: ChannelContentProjection[]
  contentGroupId: string
  coreMessage: string
  title: string
}

export interface AssetProjection {
  assetId: string
  checksum?: string
  kind: 'audio' | 'font' | 'image' | 'logo' | 'template' | 'video'
  name: string
  previewKind?: AssetPreviewKind
  previewUrl?: string
  referencedBy: string[]
  retention: '长期保留' | '可回收'
  size: string
  source: string
  version: string
}

export interface ActivityArtifactProjection {
  activityId: string
  artifactId: string
  checksum?: string
  kind: '文章版本' | '图片' | '音频' | '预览帧' | '视频片段' | '视频'
  locale?: ActivityArtifactLocale
  name: string
  previewKind?: AssetPreviewKind
  previewUrl?: string
  size: string
  status: '中间产物' | '最终产物' | '已登记'
}

export type AssetPreviewKind = 'audio' | 'image' | 'text' | 'unsupported' | 'video'

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
    artifact?: ExecutionTaskEvent['artifact']
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
  productionType?: '文章' | '视频'
  status: CampaignJobStatus
  steps: TaskStepProjection[]
  taskId: string
  title: string
  projectId?: string
  projectName?: string
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
  contentForms?: ChannelContentFormProjection[]
  delivery: '全自动候选' | '人工辅助' | '仅生成内容'
  projectAccountId: string | null
  enabled: boolean
  format: '文章' | '图文' | '短帖' | '视频信息'
  health: '已就绪' | '需重新授权' | '已阻塞' | '未配置' | '未查询'
  metrics: string[]
  nextAction: string | null
  statusSource: 'marketing-ops' | '项目配置'
  supportedFormats?: string[]
  titleLimit: number
}

export function isPublishingAssistantChannel(
  channel: Pick<ChannelProjection, 'delivery'>,
): boolean {
  return channel.delivery !== '仅生成内容'
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
  channelContentFormats?: Partial<Record<ChannelId, ContentFormat[]>>
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
  projectId?: string
  projectName?: string
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

interface DemoTaskInput {
  accountAlias: string
  activityId: string
  activityTitle: string
  channel: ChannelId
  contentId?: string
  contentTitle: string
  eventMessage: string
  projectId: string
  taskId: string
  taskKind: ExecutionTask['kind']
  productionType?: ExecutionTask['productionType']
  status: ExecutionTask['status']
  attempt: number
  title: string
}

function demoTaskProjection(input: DemoTaskInput): TaskProjection {
  const task: ExecutionTask = {
    activityId: input.activityId,
    attempt: input.attempt,
    channel: input.channel,
    ...(input.contentId === undefined ? {} : { contentId: input.contentId }),
    kind: input.taskKind,
    ...(input.productionType === undefined ? {} : { productionType: input.productionType }),
    projectId: input.projectId,
    skipStages: [],
    status: input.status,
    taskId: input.taskId,
  }
  const event: ExecutionTaskEvent = {
    attempt: task.attempt,
    eventId: `${task.taskId}-demo-event`,
    kind: 'status-changed',
    message: input.eventMessage,
    projectId: task.projectId,
    sequence: 1,
    status: task.status,
    taskId: task.taskId,
    schemaVersion: 1,
  }
  const lifecycle = taskLifecycleProjection(task, [event])
  return {
    accountAlias: input.accountAlias,
    activityId: input.activityId,
    activityTitle: input.activityTitle,
    attempt: task.attempt,
    channel: input.channel,
    ...(input.contentId === undefined ? {} : { contentId: input.contentId }),
    contentTitle: input.contentTitle,
    detail: lifecycle.detail,
    attempts: lifecycle.attempts,
    events: [{
      attempt: event.attempt,
      kind: event.kind,
      message: event.message,
      sequence: event.sequence,
      status: event.status,
      summary: taskEventSummary(event),
    }],
    kind: task.kind === 'production'
      ? '制作'
      : task.kind === 'publication'
        ? '发布'
        : '监测',
    progress: lifecycle.progress,
    status: task.status,
    steps: lifecycle.steps,
    taskId: task.taskId,
    title: input.title,
    projectId: task.projectId,
  }
}

function channelAccount(input: Omit<ChannelAccountProjection, 'assignedProjects'> & { assignedProjects?: string[] }): ChannelAccountProjection {
  return {
    assignedProjects: input.assignedProjects ?? (input.isDefault ? ['algorithm-visualizer'] : []),
    ...input,
  }
}

function deliveryLabel(delivery: DeliveryMode): ChannelProjection['delivery'] {
  return delivery === 'automatic-candidate'
    ? '全自动候选'
    : delivery === 'content-only'
      ? '仅生成内容'
      : '人工辅助'
}

function formatLabel(format: ContentFormat): ChannelProjection['format'] {
  return format === 'article'
    ? '文章'
    : format === 'image-text'
      ? '图文'
      : format === 'short-post'
        ? '短帖'
        : '视频信息'
}

export function humanizeContentFormat(
  format: ContentFormat,
): HumanizedChannelContentFormat {
  return format === 'video-metadata'
    ? '视频'
    : format === 'image-text'
      ? '图文'
      : format === 'short-post'
        ? '动态'
        : '文章'
}

export function mediaRequirementSummary(
  media: ContentMediaRequirement,
): string {
  if (media.allowedKinds.length === 0)
    return '无需媒体'
  const mediaLabel = media.allowedKinds
    .map(kind => kind === 'image' ? '图片' : '视频')
    .join('或')
  const counter = media.allowedKinds.length === 1 && media.allowedKinds[0] === 'image'
    ? '张'
    : '个'
  if (media.minCount === 0) {
    return media.maxCount === undefined
      ? `可选${mediaLabel}`
      : `最多 ${media.maxCount} ${counter}${mediaLabel}`
  }
  if (media.maxCount === media.minCount) {
    return `需要 ${media.minCount} ${counter}${mediaLabel}`
  }
  if (media.maxCount !== undefined) {
    return `需要 ${media.minCount}–${media.maxCount} ${counter}${mediaLabel}`
  }
  return `至少 ${media.minCount} ${counter}${mediaLabel}`
}

function contentFormProjection(
  form: ContentFormBlueprint,
  defaultFormat: ContentFormat,
): ChannelContentFormProjection {
  return {
    bodyLimit: form.maxBodyLength,
    format: form.format,
    isDefault: form.format === defaultFormat,
    label: humanizeContentFormat(form.format),
    mediaSummary: mediaRequirementSummary(form.media),
    titleLimit: form.maxTitleLength,
  }
}

function completeChannelDirectory(
  channels: readonly ChannelProjection[],
): ChannelProjection[] {
  const configuredChannels = new Map(
    channels.map(channel => [channel.channel, channel]),
  )
  return (Object.keys(CHANNEL_BLUEPRINTS) as ChannelId[]).map((channelId) => {
    const configured = configuredChannels.get(channelId)
    const blueprint = CHANNEL_BLUEPRINTS[channelId]
    const supportedFormats = blueprint.supportedFormats.map(formatLabel)
    const contentForms = blueprint.contentForms.map(form =>
      contentFormProjection(form, blueprint.format),
    )
    if (configured !== undefined) {
      return {
        ...configured,
        contentForms,
        supportedFormats: configured.supportedFormats ?? supportedFormats,
      }
    }
    return {
      accounts: [],
      adapterReady: false,
      alias: null,
      bodyLimit: blueprint.maxBodyLength,
      channel: channelId,
      contentForms,
      delivery: deliveryLabel(blueprint.delivery),
      enabled: false,
      format: formatLabel(blueprint.format),
      health: '未配置',
      metrics: [],
      nextAction: '尚未配置全局账号',
      projectAccountId: null,
      statusSource: '项目配置',
      supportedFormats,
      titleLimit: blueprint.maxTitleLength,
    }
  })
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
        viewport: { height: 1920, width: 1080 },
        scenes: [
          {
            actions: [
              { kind: 'wait-for', label: '等待拒绝按钮出现' },
              { kind: 'click', label: '点击拒绝按钮' },
              { kind: 'wait-for', label: '等待播放按钮出现' },
              { kind: 'click', label: '点击播放按钮' },
              { kind: 'wait', label: '等待 2400 毫秒' },
              { kind: 'capture', label: '截取分区动画' },
            ],
            flowId: 'quick-sort-zh',
            objective: '展示分区步骤，让用户看懂比较和交换。',
            startPath: '/docs/quick-sort',
            title: '快速排序中文演示',
          },
          {
            actions: [
              { kind: 'wait-for', label: '等待 Decline 按钮出现' },
              { kind: 'click', label: '点击 Decline 按钮' },
              { kind: 'wait-for', label: '等待 Play 按钮出现' },
              { kind: 'click', label: '点击 Play 按钮' },
              { kind: 'wait', label: '等待 2400 毫秒' },
              { kind: 'capture', label: '截取 partition-animation-en' },
            ],
            flowId: 'quick-sort-en',
            objective: '展示英文页面中的分区步骤。',
            startPath: '/en/docs/quick-sort',
            title: '快速排序英文演示',
          },
        ],
      },
      videoJob: {
        artifacts: [],
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
        logs: {
          consoleErrors: 0,
          consoleWarnings: 0,
          entries: [],
          pageErrors: 0,
        },
        outcome: '已完成',
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
          handoffKind: 'generic',
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
        artifacts: [],
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
        logs: {
          consoleErrors: 0,
          consoleWarnings: 0,
          entries: [],
          pageErrors: 0,
        },
        outcome: '已完成',
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
  channelBlueprintCount: Object.keys(CHANNEL_BLUEPRINTS).length,
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
      projectAccountId: 'github-illegalcreed',
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
      projectAccountId: 'bilibili-algorithm-visualizer',
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
      projectAccountId: 'bluesky-illegalscreed',
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
      projectAccountId: 'dev-illegal',
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
      projectAccountId: 'mastodon-illegals0001',
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
      projectAccountId: 'youtube-algorithm-visualizer',
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
      projectAccountId: 'zhihu-algorithm-docs',
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
      projectAccountId: null,
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
      projectAccountId: 'x-algorithm-visualizer',
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
      publicationId: 'demo-quick-sort-bilibili',
      status: '监测中',
      timeline: [{
        collectedAt: '2026-08-02 09:30',
        metrics: [
          { label: '播放量', value: '1,284' },
          { label: '点赞', value: '86' },
          { label: '评论', value: '12' },
          { label: '收藏', value: '34' },
        ],
        source: '演示数据',
      }],
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
      publicationId: 'demo-release-notes-x',
      status: '等待发布回执',
      timeline: [],
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
    demoTaskProjection({
      accountAlias: 'Algorithm Visualizer',
      activityId: 'quick-sort-guide',
      activityTitle: '快速排序可视化指南',
      channel: 'bilibili',
      contentId: 'quick-sort-video-bilibili',
      contentTitle: '快速排序演示视频',
      eventMessage: '录制阶段已开始，预览帧已生成。具体动作进度见录制产物。',
      projectId: 'algorithm-visualizer',
      taskId: 'quick-sort-guide-recording',
      taskKind: 'production',
      productionType: 'video',
      status: 'recording',
      attempt: 2,
      title: '录制快速排序演示视频',
    }),
    demoTaskProjection({
      accountAlias: 'Algorithm Visualizer',
      activityId: 'release-notes',
      activityTitle: '版本更新发布',
      channel: 'x',
      contentId: 'release-notes-x',
      contentTitle: 'Version update overview',
      eventMessage: '等待渠道授权人登录、审核和最终点击',
      projectId: 'algorithm-visualizer',
      taskId: 'release-notes-publish-x',
      taskKind: 'publication',
      status: 'awaiting-owner',
      attempt: 1,
      title: '发布到 X',
    }),
    demoTaskProjection({
      accountAlias: 'Algorithm Visualizer',
      activityId: 'quick-sort-guide',
      activityTitle: '快速排序可视化指南',
      channel: 'bilibili',
      contentId: 'quick-sort-video-bilibili',
      contentTitle: '快速排序演示视频',
      eventMessage: '发布后 1 小时采集播放量、点赞和评论',
      projectId: 'algorithm-visualizer',
      taskId: 'quick-sort-guide-monitoring',
      taskKind: 'monitoring',
      status: 'monitoring',
      attempt: 1,
      title: '追踪快速排序视频表现',
    }),
  ],
}

snapshot.channels = completeChannelDirectory(snapshot.channels)

export const lifecycleStages: CampaignJobStatus[] = [
  'queued',
  'generating',
  'recording',
  'composing',
  'completed',
  'awaiting-owner',
  'published',
  'monitoring',
]

export function humanizeStatus(status: CampaignJobStatus): string {
  const labels: Record<CampaignJobStatus, string> = {
    'awaiting-owner': '等待人工',
    'cancelled': '已取消',
    'composing': '合成中',
    'completed': '已完成',
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
