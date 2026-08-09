import type {
  ActivityArtifact,
  CaptureFlow,
  CaptureStep,
  ChannelContent,
  ChannelContentFormat,
  ChannelContentReadiness,
  ChannelId,
  ContentGroup,
  ContentStudioProjectIndex,
  ContentStudioProjectView,
  ExecutionTask,
  ExecutionTaskEvent,
  MonitoringObservation,
  ObservationMetric,
  OwnerHandoff,
  ProjectAsset,
  ProjectChannelBinding,
  PublicationPlan,
  PublicationReceipt,
  PublishingActivity,
  RecordingAttemptRecord,
  SemanticLocator,
} from '@content-studio/core-types'
import type {
  ActivityArtifactProjection,
  AssetPreviewKind,
  AssetProjection,
  CampaignProjection,
  ChannelContentProjection,
  ChannelProjection,
  ContentGroupProjection,
  ProjectIndexProjection,
  ReportProjection,
  ReportTimelineProjection,
  TaskProjection,
  VideoPlanProjection,
} from './model'
import {
  humanizeChannelContentFormat,
  humanizeTaskStatus,
  mediaRequirementSummary,
  recordingReceiptToVideoJob,
  taskEventSummary,
  taskLifecycleProjection,
  videoViewportForFormat,
} from './model'

export function preferRuntimeData<T>(
  runtimeItems: readonly T[],
  demoItems: readonly T[],
  runtimeConnected: boolean,
): T[] {
  return [...(runtimeConnected ? runtimeItems : demoItems)]
}

export function projectIndexProjections(
  index: ContentStudioProjectIndex,
): ProjectIndexProjection[] {
  return index.projects.map(item => ({
    activityCount: item.activityCount,
    enabledChannels: item.enabledChannels,
    name: item.project.name,
    previewReady: item.previewReady,
    projectId: item.project.projectId,
    snapshotVersion: item.snapshotVersion,
    taskCount: item.taskCount,
    taskCounts: item.taskCounts,
  }))
}

export interface ProjectChannelsInput {
  bindings: readonly ProjectChannelBinding[]
  channels: readonly ChannelProjection[]
}

export function projectChannels({
  bindings,
  channels,
}: ProjectChannelsInput): ChannelProjection[] {
  const bindingByChannel = new Map(
    bindings.map(binding => [binding.channel, binding]),
  )
  return channels.map((channel) => {
    const binding = bindingByChannel.get(channel.channel)
    return {
      ...channel,
      enabled: binding?.enabled ?? false,
      projectAccountId: binding?.accountRef ?? null,
    }
  })
}

export function runtimeActivityArtifacts(
  projectView: ContentStudioProjectView,
): ActivityArtifactProjection[] {
  return activityArtifactProjections(projectView.activityArtifacts)
}

export function activityArtifactProjections(
  artifacts: readonly ActivityArtifact[],
): ActivityArtifactProjection[] {
  return artifacts.map(artifact => ({
    activityId: artifact.activityId,
    artifactId: artifact.artifactId,
    checksum: artifact.sha256,
    kind: activityArtifactKindLabel(artifact.kind),
    name: fileName(artifact.relativePath),
    previewKind: activityArtifactPreviewKind(artifact.kind),
    previewUrl: `/api/v1/projects/${encodeURIComponent(artifact.projectId)}/activity-artifacts/${encodeURIComponent(artifact.artifactId)}/preview`,
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
    checksum: asset.sha256,
    kind: asset.kind,
    name: fileName(asset.relativePath),
    previewKind: projectAssetPreviewKind(asset.kind),
    previewUrl: `/api/v1/projects/${encodeURIComponent(asset.projectId)}/project-assets/${encodeURIComponent(asset.assetId)}/preview`,
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

function activityArtifactPreviewKind(
  kind: ContentStudioProjectView['activityArtifacts'][number]['kind'],
): AssetPreviewKind {
  return kind === 'article-version'
    ? 'text'
    : kind === 'audio'
      ? 'audio'
      : kind === 'image' || kind === 'preview-frame'
        ? 'image'
        : kind === 'video' || kind === 'video-clip'
          ? 'video'
          : 'unsupported'
}

function projectAssetPreviewKind(
  kind: ContentStudioProjectView['projectAssets'][number]['kind'],
): AssetPreviewKind {
  return kind === 'audio'
    ? 'audio'
    : kind === 'image' || kind === 'logo'
      ? 'image'
      : kind === 'video'
        ? 'video'
        : 'unsupported'
}

function fileName(relativePath: string): string {
  const segments = relativePath.split(/[\\/]/u)
  return segments.at(-1) || relativePath
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
    const sortedObservations = [...(observationsByPublication.get(plan.publicationId) ?? [])]
      .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))
    const timeline = sortedObservations
      .map<ReportTimelineProjection>(observation => ({
        collectedAt: observation.collectedAt,
        metrics: reportMetrics(observation.metrics, content?.format, false),
        source: observation.source,
      }))
    const latestObservation = sortedObservations[0]
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
      contentType: content?.format === undefined
        ? '文章'
        : humanizeChannelContentFormat(content.format),
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
      publicationId: plan.publicationId,
      ...(receipt?.publicUrl === undefined ? {} : { publicUrl: receipt.publicUrl }),
      status,
      timeline,
    }
  })
}

function defaultReportMetrics(format: ChannelContentFormat | undefined): ReportProjection['metrics'] {
  const keys: ObservationMetric[] = format === 'video'
    ? ['views', 'likes', 'comments', 'favorites']
    : ['reads', 'likes', 'comments', 'shares']
  return keys.map(key => ({ label: reportMetricLabels[key], value: '—' }))
}

function reportMetrics(
  metrics: Partial<Record<ObservationMetric, number | null>>,
  format: ChannelContentFormat | undefined,
  includeMissing = true,
): ReportProjection['metrics'] {
  const preferredKeys: ObservationMetric[] = format === 'video'
    ? ['views', 'likes', 'comments', 'favorites']
    : ['reads', 'likes', 'comments', 'shares']
  const keys = includeMissing
    ? [
        ...preferredKeys,
        ...reportMetricOrder.filter(key => !preferredKeys.includes(key) && metrics[key] !== undefined),
      ]
    : [
        ...preferredKeys.filter(key => metrics[key] !== undefined),
        ...reportMetricOrder.filter(key => !preferredKeys.includes(key) && metrics[key] !== undefined),
      ]
  return keys.map(key => ({
    label: reportMetricLabels[key],
    value: metrics[key] === null || metrics[key] === undefined
      ? '—'
      : metrics[key]!.toLocaleString('zh-CN'),
  }))
}

export interface ActivityPublicationProjection {
  channel: ChannelId
  contentId?: string
  contentTitle: string
  format: string
  latestObservation?: {
    collectedAt: string
    metrics: string
    source: string
  }
  publicUrl?: string
  publicationId: string
  status: '已发布' | '发布失败' | '已安排' | '待建立安排'
}

export interface ActivityPublicationProjectionInput {
  activityId: string
  contentGroups: readonly ContentGroupProjection[]
  monitoringObservations?: readonly MonitoringObservation[]
  publicationPlans?: readonly PublicationPlan[]
  publicationReceipts?: readonly PublicationReceipt[]
}

export function activityPublicationProjections({
  activityId,
  contentGroups,
  monitoringObservations = [],
  publicationPlans = [],
  publicationReceipts = [],
}: ActivityPublicationProjectionInput): ActivityPublicationProjection[] {
  const contents = contentGroups.flatMap(group => group.contents)
  const plans = publicationPlans.filter(plan => plan.activityId === activityId)
  const receiptsByPublication = new Map(
    publicationReceipts.map(receipt => [receipt.publicationId, receipt]),
  )
  const observationsByPublication = new Map<string, MonitoringObservation[]>()
  for (const observation of monitoringObservations) {
    const observations = observationsByPublication.get(observation.publicationId) ?? []
    observations.push(observation)
    observationsByPublication.set(observation.publicationId, observations)
  }
  const rows = contents.map((content) => {
    const plan = plans.find(candidate => candidate.contentId === content.contentId)
    const receipt = plan === undefined ? undefined : receiptsByPublication.get(plan.publicationId)
    const latestObservation = plan === undefined
      ? undefined
      : [...(observationsByPublication.get(plan.publicationId) ?? [])]
          .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))[0]
    return publicationResult({ content, latestObservation, plan, receipt })
  })
  const linkedContentIds = new Set(
    rows.map(row => row.contentId).filter((id): id is string => id !== undefined),
  )
  const unlinkedPlans = plans
    .filter(plan => !linkedContentIds.has(plan.contentId))
    .map(plan => publicationResult({
      content: {
        channel: plan.channel,
        contentId: plan.contentId,
        format: '文章',
        locale: 'zh-CN',
        status: '已生成',
        title: '渠道成品待登记',
      },
      plan,
      receipt: receiptsByPublication.get(plan.publicationId),
    }))
  return [...rows, ...unlinkedPlans]
}

function publicationResult({
  content,
  latestObservation,
  plan,
  receipt,
}: {
  content: ChannelContentProjection
  latestObservation?: MonitoringObservation
  plan?: PublicationPlan
  receipt?: PublicationReceipt
}): ActivityPublicationProjection {
  return {
    channel: content.channel,
    ...(content.contentId === undefined ? {} : { contentId: content.contentId }),
    contentTitle: content.title,
    format: content.format,
    ...(latestObservation === undefined
      ? {}
      : {
          latestObservation: {
            collectedAt: latestObservation.collectedAt,
            metrics: observationMetrics(latestObservation.metrics),
            source: observationSourceLabel(latestObservation.source),
          },
        }),
    ...(receipt?.publicUrl === undefined ? {} : { publicUrl: receipt.publicUrl }),
    publicationId: plan?.publicationId ?? `pending-${content.contentId ?? content.title}`,
    status: receipt?.status === 'published'
      ? '已发布'
      : receipt?.status === 'failed'
        ? '发布失败'
        : plan === undefined
          ? '待建立安排'
          : '已安排',
  }
}

export interface ActivityBusinessProgressProjection {
  detail: string
  label: string
  status: 'active' | 'done' | 'pending'
}

export function activityBusinessProgressProjection({
  channels,
  contentGroups,
  publicationResults,
  tasks,
}: {
  channels: readonly ChannelId[]
  contentGroups: readonly ContentGroupProjection[]
  publicationResults: readonly ActivityPublicationProjection[]
  tasks: ReadonlyArray<{
    kind: ExecutionTask['kind'] | '制作' | '发布' | '监测'
    status: ExecutionTask['status']
  }>
}): ActivityBusinessProgressProjection[] {
  const productionTasks = tasks.filter(task => task.kind === 'production' || task.kind === '制作')
  const publicationTasks = tasks.filter(task => task.kind === 'publication' || task.kind === '发布')
  const monitoringTasks = tasks.filter(task => task.kind === 'monitoring' || task.kind === '监测')
  const publicationScheduled = publicationResults.some(result => result.status !== '待建立安排')
  const publicationCompleted = publicationResults.some(result => result.status === '已发布')
  const monitoringCompleted = publicationResults.some(result => result.latestObservation !== undefined)
  return [
    {
      detail: `${channels.length} 个渠道已选`,
      label: '主题与渠道',
      status: channels.length > 0 ? 'done' : 'active',
    },
    {
      detail: contentGroups.length > 0
        ? `${contentGroups.length} 个内容组，${contentGroups.reduce((total, group) => total + group.contents.length, 0)} 个渠道版本`
        : '等待 AI 或用户建立内容组',
      label: '内容组与渠道成品',
      status: contentGroups.length > 0 ? 'done' : 'active',
    },
    {
      detail: productionTasks.length > 0
        ? `${productionTasks.length} 个制作任务 · ${humanizeTaskStatus(productionTasks[0]!.status)}`
        : '尚未建立制作任务',
      label: '制作执行',
      status: productionTasks.length === 0
        ? 'pending'
        : productionTasks.every(task => task.status === 'completed') ? 'done' : 'active',
    },
    {
      detail: publicationScheduled
        ? `${publicationResults.filter(result => result.status !== '待建立安排').length} 个发布安排`
        : '尚未建立发布安排',
      label: '发布安排',
      status: publicationScheduled ? 'done' : 'pending',
    },
    {
      detail: publicationCompleted
        ? `${publicationResults.filter(result => result.status === '已发布').length} 个渠道已收到成功回执`
        : publicationTasks.length > 0 ? '等待渠道回执' : '发布任务尚未建立',
      label: '发布回执',
      status: publicationCompleted ? 'done' : publicationTasks.length > 0 ? 'active' : 'pending',
    },
    {
      detail: monitoringCompleted
        ? `${publicationResults.filter(result => result.latestObservation !== undefined).length} 个渠道已有监测数据`
        : monitoringTasks.length > 0 ? '等待第一次监测采集' : '监测任务尚未建立',
      label: '监测结果',
      status: monitoringCompleted ? 'done' : monitoringTasks.length > 0 ? 'active' : 'pending',
    },
  ]
}

function observationMetrics(metrics: Partial<Record<ObservationMetric, number | null>>): string {
  const labels: Record<ObservationMetric, string> = {
    clicks: '点击',
    comments: '评论',
    favorites: '收藏',
    likes: '点赞',
    reads: '阅读',
    replies: '回复',
    shares: '转发',
    views: '播放',
  }
  const entries = Object.entries(metrics)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${labels[key as ObservationMetric] ?? key} ${value!.toLocaleString('zh-CN')}`)
  return entries.length > 0 ? entries.join(' · ') : '暂无可用指标'
}

function observationSourceLabel(source: string): string {
  return {
    'authorized-adapter': '授权适配器',
    'owner-entered': '授权人录入',
    'public': '公开页面',
  }[source] ?? source
}

export interface ActivityProjectionInput {
  accountAliasForChannel: (channel: ChannelId) => string | undefined
  activity: PublishingActivity
  activityArtifacts?: readonly ActivityArtifact[]
  captureFlows?: readonly CaptureFlow[]
  channelContentReadiness?: Readonly<Record<string, ChannelContentReadiness>>
  channelContents?: readonly ChannelContent[]
  contentGroups?: readonly ContentGroup[]
  ownerHandoffs?: readonly OwnerHandoff[]
  productionTasks?: readonly ExecutionTask[]
  projectAssets?: readonly ProjectAsset[]
  recordingReceipts?: readonly RecordingAttemptRecord[]
}

export function activityToCampaign({
  accountAliasForChannel,
  activity,
  activityArtifacts = [],
  captureFlows = [],
  channelContentReadiness = {},
  channelContents = [],
  contentGroups = [],
  ownerHandoffs = [],
  productionTasks = [],
  projectAssets = [],
  recordingReceipts = [],
}: ActivityProjectionInput): CampaignProjection {
  const topic = activity.topic['zh-CN'] ?? activity.topic.en
  const groups = contentGroups
    .filter(group => group.activityId === activity.activityId)
    .map<ContentGroupProjection>(group => ({
      contentGroupId: group.contentGroupId,
      contents: channelContents
        .filter(content => content.contentGroupId === group.contentGroupId)
        .map<ChannelContentProjection>((content) => {
          const readiness = channelContentReadiness[content.contentId]
          return {
            accountAlias: accountAliasForChannel(content.channel),
            artifactIds: content.artifactIds,
            body: content.body,
            channel: content.channel,
            contentId: content.contentId,
            format: humanizeChannelContentFormat(content.format),
            locale: content.locale,
            ...(readiness === undefined
              ? {}
              : {
                  publicationReadiness: publicationReadinessLabel(readiness),
                  publicationReady: readiness.ready,
                }),
            status: '已生成',
            title: content.title,
            version: content.version,
          }
        }),
      coreMessage: group.coreMessage,
      title: group.title,
    }))
  const videoPlan = activity.video === undefined
    ? null
    : createVideoPlanProjection(activity, captureFlows)
  const videoTask = productionTasks.find(task =>
    task.activityId === activity.activityId
    && task.kind === 'production'
    && task.productionType === 'video',
  )
  const latestVideoReceipt = videoTask === undefined
    ? undefined
    : recordingReceipts
      .filter(receipt => receipt.jobId === videoTask.taskId)
      .sort((left, right) => right.attempt - left.attempt)[0]
  const videoJob = latestVideoReceipt === undefined
    ? null
    : recordingReceiptToVideoJob(latestVideoReceipt)
  const referencedAssetIds = new Set(
    channelContents
      .filter(content => content.activityId === activity.activityId)
      .flatMap(content => content.artifactIds)
      .filter(artifactId => projectAssets.some(asset =>
        asset.assetId === artifactId || asset.sourceArtifactId === artifactId,
      )),
  )
  const channelContentFormatEntries = activity.channels.flatMap(channel =>
    channel.contentFormats === undefined
      ? []
      : [[channel.id, [...channel.contentFormats]] as const],
  )
  return {
    activityArtifacts: activityArtifactProjections(
      activityArtifacts.filter(artifact => artifact.activityId === activity.activityId),
    ),
    activityStatus: activity.status === 'active'
      ? '进行中'
      : activity.status === 'planned'
        ? '已规划'
        : activity.status === 'completed'
          ? '已完成'
          : activity.status === 'archived'
            ? '已归档'
            : '草稿',
    assets: referencedAssetIds.size,
    campaignId: activity.activityId,
    ...(channelContentFormatEntries.length === 0
      ? {}
      : {
          channelContentFormats: Object.fromEntries(channelContentFormatEntries),
        }),
    channels: activity.channels.map(channel => channel.id),
    contentGroups: groups,
    executionStatus: videoTask?.status ?? 'queued',
    handoffs: ownerHandoffs
      .filter(handoff => handoff.activityId === activity.activityId)
      .map(handoff => ({
        accountAlias: accountAliasForChannel(handoff.channel) ?? '项目账号待绑定',
        checklist: handoff.checklist,
        channel: handoff.channel,
        expiresAt: handoff.expiresAt,
        handoffId: handoff.handoffId,
        officialTargetUrl: handoff.officialTargetUrl,
        reason: '等待渠道授权人完成登录、审核和最终点击',
        status: handoff.status === 'pending' ? 'waiting' : handoff.status,
      })),
    nextAction: videoJob?.outcome === '失败'
      ? '录制失败，请查看日志摘要后重试。'
      : groups.length > 0
        ? '渠道内容已保存，下一步进入制作任务。'
        : '等待 AI 生成内容和拍摄大纲。',
    referencedAssets: [...referencedAssetIds],
    projectId: activity.projectId,
    title: topic,
    topic,
    version: activity.version,
    videoPlan,
    videoJob,
  }
}

function publicationReadinessLabel(
  readiness: ChannelContentReadiness,
): string {
  const requirement = mediaRequirementSummary(readiness.requirement)
  return readiness.ready
    ? `发布资源已就绪 · ${requirement}`
    : `发布受阻 · ${requirement}，当前匹配 ${readiness.matchingArtifactIds.length} 个活动产物`
}

export interface TaskProjectionInput {
  accountAliasForChannel: (channel: ChannelId) => string | undefined
  campaigns: readonly CampaignProjection[]
  events?: readonly ExecutionTaskEvent[]
  task: ExecutionTask
}

export function taskToProjection({
  accountAliasForChannel,
  campaigns,
  events = [],
  task,
}: TaskProjectionInput): TaskProjection {
  const campaign = campaigns.find(candidate => candidate.campaignId === task.activityId)
  const channel = task.channel ?? campaign?.channels[0] ?? 'github'
  const account = accountAliasForChannel(channel) ?? '未绑定账号'
  const activityTitle = campaign?.title ?? task.activityId
  const contentTitle = campaign?.contentGroups
    .flatMap(group => group.contents)
    .find(content => content.contentId === task.contentId)
    ?.title
    ?? '等待 AI 生成内容'
  const lifecycle = taskLifecycleProjection(task, [...events])
  return {
    accountAlias: account,
    activityId: task.activityId,
    activityTitle,
    attempt: task.attempt,
    channel,
    ...(task.contentId === undefined ? {} : { contentId: task.contentId }),
    contentTitle,
    attempts: lifecycle.attempts,
    detail: lifecycle.detail,
    events: events.map(event => ({
      ...(event.artifact === undefined ? {} : { artifact: event.artifact }),
      attempt: event.attempt,
      kind: event.kind,
      message: event.message,
      sequence: event.sequence,
      ...(event.stage === undefined ? {} : { stage: event.stage }),
      summary: taskEventSummary(event),
      status: event.status,
    })),
    kind: task.kind === 'production'
      ? '制作'
      : task.kind === 'publication'
        ? '发布'
        : '监测',
    progress: lifecycle.progress,
    ...(task.productionType === undefined
      ? {}
      : { productionType: task.productionType === 'article' ? '文章' : '视频' }),
    status: task.status,
    steps: lifecycle.steps,
    taskId: task.taskId,
    title: task.kind === 'production' ? `制作：${activityTitle}` : `${task.kind}：${activityTitle}`,
    projectId: task.projectId,
  }
}

function createVideoPlanProjection(
  activity: PublishingActivity,
  captureFlows: readonly CaptureFlow[],
): VideoPlanProjection {
  const video = activity.video!
  const flowById = new Map(captureFlows.map(flow => [flow.id, flow]))
  const outlineByFlowId = new Map((video.outline ?? []).map(scene => [scene.flowId, scene]))
  return {
    format: video.format,
    planVersion: video.planVersion ?? activity.version,
    reviewStatus: activity.videoPlanReviewStatus === 'confirmed' ? '已确认' : '待确认',
    viewport: videoViewportForFormat(video),
    scenes: video.flowIds.map((flowId) => {
      const flow = flowById.get(flowId)
      const outline = outlineByFlowId.get(flowId)
      return {
        actions: (flow?.steps ?? []).map(captureStepProjection),
        flowId,
        objective: outline?.objective['zh-CN'] ?? outline?.objective.en ?? '按项目流程执行该场景。',
        startPath: flow?.startPath ?? '未登记路径',
        title: outline?.title['zh-CN'] ?? outline?.title.en ?? flow?.title['zh-CN'] ?? flow?.title.en ?? flowId,
      }
    }),
  }
}

function captureStepProjection(step: CaptureStep) {
  switch (step.kind) {
    case 'capture':
      return { kind: step.kind, label: `截取 ${step.label}` }
    case 'click':
      return { kind: step.kind, label: `点击${semanticLocatorLabel(step.locator)}` }
    case 'fill':
      return { kind: step.kind, label: `填写${semanticLocatorLabel(step.locator)}` }
    case 'press':
      return { kind: step.kind, label: `按键 ${step.key}` }
    case 'wait':
      return { kind: step.kind, label: `等待 ${step.durationMs} 毫秒` }
    case 'wait-for':
      return { kind: step.kind, label: `等待${semanticLocatorLabel(step.locator)}出现` }
  }
}

function semanticLocatorLabel(locator: SemanticLocator): string {
  const value = 'name' in locator && typeof locator.name === 'string'
    ? locator.name
    : locator.value
  const aliases: Record<string, string> = {
    Decline: '拒绝',
    Play: '播放',
  }
  const localizedValue = aliases[value] ?? value
  return locator.by === 'role' && locator.value === 'button'
    ? `${localizedValue}按钮`
    : localizedValue
}
