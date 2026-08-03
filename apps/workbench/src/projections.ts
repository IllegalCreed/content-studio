import type {
  ActivityArtifact,
  CaptureFlow,
  ChannelContent,
  ChannelId,
  ContentGroup,
  ContentStudioProjectView,
  ExecutionTask,
  ExecutionTaskEvent,
  ObservationMetric,
  OwnerHandoff,
  ProjectAsset,
  PublishingActivity,
  RecordingAttemptRecord,
} from '@content-studio/core-types'
import type {
  CampaignProjection,
  ChannelContentProjection,
  ContentGroupProjection,
  ReportProjection,
  TaskProjection,
  VideoPlanProjection,
} from './model'
import {
  activityArtifactProjections,
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

export interface ActivityProjectionInput {
  accountAliasForChannel: (channel: ChannelId) => string | undefined
  activity: PublishingActivity
  activityArtifacts?: readonly ActivityArtifact[]
  captureFlows?: readonly CaptureFlow[]
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
        .map<ChannelContentProjection>(content => ({
          accountAlias: accountAliasForChannel(content.channel),
          artifactIds: content.artifactIds,
          body: content.body,
          channel: content.channel,
          contentId: content.contentId,
          format: content.format === 'article' ? '文章' : '视频',
          locale: content.locale,
          status: '已生成',
          title: content.title,
        })),
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
        status: handoff.status === 'pending' ? 'waiting' : 'ready',
      })),
    nextAction: videoJob?.outcome === '失败'
      ? '录制失败，请查看日志摘要后重试。'
      : groups.length > 0
        ? '渠道内容已保存，下一步进入制作任务。'
        : '等待 AI 生成内容和拍摄大纲。',
    referencedAssets: [...referencedAssetIds],
    title: topic,
    topic,
    version: activity.version,
    videoPlan,
    videoJob,
  }
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
    status: task.status,
    steps: lifecycle.steps,
    taskId: task.taskId,
    title: task.kind === 'production' ? `制作：${activityTitle}` : `${task.kind}：${activityTitle}`,
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
        flowId,
        objective: outline?.objective['zh-CN'] ?? outline?.objective.en ?? '按项目流程执行该场景。',
        startPath: flow?.startPath ?? '未登记路径',
        title: outline?.title['zh-CN'] ?? outline?.title.en ?? flow?.title['zh-CN'] ?? flow?.title.en ?? flowId,
      }
    }),
  }
}
