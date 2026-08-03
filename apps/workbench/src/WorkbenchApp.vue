<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ActivityListPage from './components/ActivityListPage.vue'
import AssetLibraryPage from './components/AssetLibraryPage.vue'
import ChannelManagementPage from './components/ChannelManagementPage.vue'
import OwnerInboxPage from './components/OwnerInboxPage.vue'
import OverviewPage from './components/OverviewPage.vue'
import ProjectOverviewPage from './components/ProjectOverviewPage.vue'
import ProjectReportsPage from './components/ProjectReportsPage.vue'
import StatusRail from './components/StatusRail.vue'
import SelectMenu from './components/SelectMenu.vue'
import TaskBoardPage from './components/TaskBoardPage.vue'
import WorkbenchShell from './components/WorkbenchShell.vue'
import VideoJobPanel from './components/VideoJobPanel.vue'
import AssetPreview from './components/AssetPreview.vue'
import type {
  AssetProjection,
  ActivityArtifactProjection,
  CampaignProjection,
  ChannelContentProjection,
  ChannelProjection,
  ContentGroupProjection,
  VideoPlanProjection,
  WorkbenchSnapshot,
} from './model'
import type {
  CaptureFlow,
  ChannelContent,
  ChannelId,
  ContentGroup,
  CreatePublishingActivityInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ActivityArtifact,
  OwnerHandoff,
  ProjectAsset,
  ProjectChannelBinding,
  PublicationPlan,
  PublishingActivity,
  RecordingAttemptRecord,
  StorageCleanupPreview,
  VideoFormat,
} from '@content-studio/core-types'
import {
  activityArtifactProjections,
  humanizeActivityStatus,
  humanizeTaskEventKind,
  humanizeStatus,
  runtimeActivityArtifacts,
  runtimeProjectAssets,
  runtimeReports,
  recordingReceiptToVideoJob,
  taskEventSummary,
  snapshot as snapshotSeed,
  taskLifecycleProjection,
  videoViewportForFormat,
} from './model'
import { createWorkbenchRuntime } from './runtime'

type ModuleId =
  | 'overview'
  | 'project'
  | 'activities'
  | 'tasks'
  | 'project-tasks'
  | 'channels'
  | 'assets'
  | 'owner'
  | 'reports'

interface ModuleDefinition {
  description: string
  group: 'global' | 'project'
  id: ModuleId
  label: string
  scope: string
}

const moduleDefinitions: ModuleDefinition[] = [
  {
    description: '从一个页面查看项目状态、活动进度和需要处理的事项。',
    group: 'global',
    id: 'overview',
    label: '总览',
    scope: '全局控制台 / 项目空间',
  },
  {
    description: '跨项目查看制作、发布和监测执行记录。',
    group: 'global',
    id: 'tasks',
    label: '全局任务面板',
    scope: '全局控制台',
  },
  {
    description: '管理全局渠道和账号目录，并查看当前项目是否启用。',
    group: 'global',
    id: 'channels',
    label: '渠道管理',
    scope: '全局控制台',
  },
  {
    description: '查看当前项目事实、接入方式、启用渠道和存储范围。',
    group: 'project',
    id: 'project',
    label: '项目概览',
    scope: '项目空间 / Algorithm Visualizer',
  },
  {
    description: '围绕一次主题管理内容组、渠道内容和发布安排。',
    group: 'project',
    id: 'activities',
    label: '发布活动',
    scope: '项目空间 / Algorithm Visualizer',
  },
  {
    description: '只查看当前项目的制作、发布和监测执行记录。',
    group: 'project',
    id: 'project-tasks',
    label: '项目任务面板',
    scope: '项目空间 / Algorithm Visualizer',
  },
  {
    description: '管理这个项目的品牌素材、活动产物和存储保留规则。',
    group: 'project',
    id: 'assets',
    label: '项目素材库',
    scope: '项目空间 / Algorithm Visualizer',
  },
  {
    description: '集中处理必须由渠道授权人在官方页面完成的步骤。',
    group: 'project',
    id: 'owner',
    label: '待人工处理',
    scope: '项目空间 / Algorithm Visualizer',
  },
  {
    description: '汇总发布回执和发布后的播放量、阅读量与互动数据。',
    group: 'project',
    id: 'reports',
    label: '项目报告',
    scope: '项目空间 / Algorithm Visualizer',
  },
]

const snapshot = reactive(snapshotSeed)
const route = useRoute()
const router = useRouter()
const activeModule = ref<ModuleId>(moduleForPath(route.path))
const selectedCampaignId = ref(snapshot.campaigns[0]!.campaignId)
const selectedTaskId = ref(snapshot.tasks[0]!.taskId)
const activeTaskScope = ref<'全部项目' | '当前项目'>('全部项目')
const selectedAssetId = ref(snapshot.projectAssets[0]!.assetId)
const assetFilter = ref<'全部' | AssetProjection['kind']>('全部')
const selectedChannelId = ref(snapshot.channels[0]!.channel)
const selectedChannelAccountId = ref(snapshot.channels[0]!.projectAccountId)
const runtimeError = ref<string | null>(null)
const workbenchRuntime = createWorkbenchRuntime()
const currentSnapshotId = ref(`${snapshot.project.projectId}-snapshot-1`)
const activityComposerOpen = ref(false)
const activitySaving = ref(false)
const activitySaveError = ref<string | null>(null)
const contentComposerOpen = ref(false)
const contentSaving = ref(false)
const contentSaveError = ref<string | null>(null)
const publicationPlanActionError = ref<string | null>(null)
const publicationPlanActionPending = ref<string | null>(null)
const assetPromotionError = ref<string | null>(null)
const assetPromotionPending = ref<string | null>(null)
const storagePreviewOpen = ref(false)
const storagePreviewLoading = ref(false)
const storagePreviewError = ref<string | null>(null)
const storagePreview = ref<StorageCleanupPreview | null>(null)
const channelBindingSaving = ref(false)
const channelBindingSaveError = ref<string | null>(null)
const runtimeTaskIds = ref<Set<string>>(new Set())
const runtimeActivityIds = ref<Set<string>>(new Set())
const projectCaptureFlowIds = ref<string[]>([])
const taskActionError = ref<string | null>(null)
const taskActionPending = ref<'cancel' | 'record' | 'retry' | 'start' | null>(null)
const videoPlanActionError = ref<string | null>(null)
const videoPlanActionPending = ref(false)
const videoPlanRevisionError = ref<string | null>(null)
const videoPlanRevisionPending = ref(false)
const videoPlanViewportDraft = reactive({
  height: 1080,
  width: 1920,
})
const activityForm = reactive<{
  channels: ChannelId[]
  topic: string
  videoEnabled: boolean
  videoFormat: VideoFormat
  videoHeight: number
  videoWidth: number
}>({
  channels: ['github'],
  topic: '',
  videoEnabled: false,
  videoFormat: 'landscape',
  videoHeight: 1080,
  videoWidth: 1920,
})
const contentForm = reactive<{
  body: string
  channel: ChannelId
  coreMessage: string
  format: 'article' | 'video'
  locale: 'en' | 'zh-CN'
  title: string
}>({
  body: '',
  channel: 'github',
  coreMessage: '',
  format: 'article',
  locale: 'zh-CN',
  title: '',
})
const channelBindingForm = reactive<{
  accountRef: string
  delivery: ProjectChannelBinding['delivery']
}>({
  accountRef: snapshot.channels[0]?.projectAccountId ?? '',
  delivery: 'owner-assisted',
})

const deliveryOptions: Array<{
  label: ChannelProjection['delivery']
  value: ProjectChannelBinding['delivery']
}> = [
  { label: '全自动候选', value: 'automatic-candidate' },
  { label: '人工辅助', value: 'owner-assisted' },
  { label: '仅生成内容', value: 'content-only' },
]

const contentFormatOptions = [
  { label: '文章', value: 'article' },
  { label: '视频', value: 'video' },
]

const contentLocaleOptions = [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
]

const videoFormatOptions: Array<{ label: string, value: VideoFormat }> = [
  { label: '横屏', value: 'landscape' },
  { label: '竖屏', value: 'portrait' },
  { label: '方形', value: 'square' },
]

const currentModule = computed(() =>
  moduleDefinitions.find(module => module.id === activeModule.value)
  ?? moduleDefinitions[0]!,
)

const selectedCampaign = computed(() =>
  snapshot.campaigns.find(
    campaign => campaign.campaignId === selectedCampaignId.value,
  ) ?? snapshot.campaigns[0]!,
)

const selectedCampaignIsRuntime = computed(() =>
  runtimeActivityIds.value.has(selectedCampaign.value.campaignId),
)

const canConfirmSelectedVideoPlan = computed(() =>
  snapshot.runtimeConnected
  && selectedCampaignIsRuntime.value
  && selectedCampaign.value.videoPlan?.reviewStatus === '待确认'
  && !videoPlanActionPending.value,
)

const canReviseSelectedVideoPlan = computed(() =>
  snapshot.runtimeConnected
  && selectedCampaignIsRuntime.value
  && selectedCampaign.value.videoPlan !== null
  && !videoPlanRevisionPending.value
  && videoPlanViewportDraft.width > 0
  && videoPlanViewportDraft.height > 0,
)

const selectedTask = computed(() =>
  snapshot.tasks.find(task => task.taskId === selectedTaskId.value)
  ?? snapshot.tasks[0]!,
)

const selectedTaskIsRuntime = computed(() =>
  runtimeTaskIds.value.has(selectedTask.value.taskId),
)

const canCancelSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && snapshot.runtimeConnected
  && ['awaiting-owner', 'composing', 'generating', 'queued', 'recording'].includes(selectedTask.value.status),
)

const canStartSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && snapshot.runtimeConnected
  && selectedTask.value.kind === '制作'
  && selectedTask.value.status === 'queued',
)

const canRecordSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && snapshot.runtimeConnected
  && selectedTask.value.kind === '制作'
  && selectedTask.value.status === 'generating',
)

const canRetrySelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && snapshot.runtimeConnected
  && ['cancelled', 'failed'].includes(selectedTask.value.status),
)

const emptyAsset: AssetProjection = {
  assetId: 'no-project-asset',
  kind: 'image',
  name: '暂无项目素材',
  referencedBy: [],
  retention: '可回收',
  size: '未记录',
  source: '暂无登记',
  version: '—',
}

const selectedAsset = computed(() =>
  snapshot.projectAssets.find(asset => asset.assetId === selectedAssetId.value)
  ?? snapshot.projectAssets[0]
  ?? emptyAsset,
)

const visibleTasks = computed(() =>
  activeTaskScope.value === '当前项目'
    ? snapshot.tasks.filter(task => task.activityId.length > 0)
    : snapshot.tasks,
)

const filteredAssets = computed(() =>
  assetFilter.value === '全部'
    ? snapshot.projectAssets
    : snapshot.projectAssets.filter(asset => asset.kind === assetFilter.value),
)

const selectedCampaignTasks = computed(() =>
  snapshot.tasks.filter(task => task.activityId === selectedCampaign.value.campaignId),
)

const selectedTaskCampaign = computed(() =>
  snapshot.campaigns.find(campaign => campaign.campaignId === selectedTask.value.activityId)
  ?? snapshot.campaigns[0]!,
)

const selectedChannel = computed(() =>
  snapshot.channels.find(channel => channel.channel === selectedChannelId.value)
  ?? snapshot.channels[0]!,
)

function projectAccountFor(channel: ChannelProjection): ChannelProjection['accounts'][number] | null {
  if (channel.projectAccountId === null)
    return null
  return channel.accounts.find(account => account.accountId === channel.projectAccountId) ?? null
}

function projectAccountAlias(channel: ChannelProjection): string | undefined {
  return projectAccountFor(channel)?.alias
}

function projectAccountAliasForChannel(channelId: ChannelId): string | undefined {
  const channel = snapshot.channels.find(candidate => candidate.channel === channelId)
  return channel === undefined ? undefined : projectAccountAlias(channel)
}

function accountReferenceCount(channel: ChannelProjection): number {
  return channel.accounts.reduce((total, account) => total + account.assignedProjects.length, 0)
}

const selectedChannelAccount = computed(() =>
  selectedChannel.value.accounts.find(account => account.accountId === selectedChannelAccountId.value)
  ?? selectedChannel.value.accounts.find(account => account.isDefault)
  ?? selectedChannel.value.accounts[0]
  ?? null,
)

const projectAccounts = computed(() =>
  snapshot.channels.flatMap((channel) => {
    const account = projectAccountFor(channel)
    return channel.enabled && account !== null ? [account] : []
  }),
)

const projectAccountOptions = computed(() => [
  { label: '不使用该渠道', value: '' },
  ...selectedChannel.value.accounts.map(account => ({
    label: `${account.alias} · 已被 ${account.assignedProjects.length} 个项目引用`,
    value: account.accountId,
  })),
])

const selectedCampaignChannelOptions = computed(() =>
  selectedCampaign.value.channels.map(channel => ({ label: channel, value: channel })),
)

const selectedCampaignContentCounts = computed(() => {
  const contents = selectedCampaign.value.contentGroups.flatMap(group => group.contents)
  return {
    article: contents.filter(content => content.format === '文章').length,
    artifacts: contents.reduce((total, content) => total + (content.artifactIds?.length ?? 0), 0),
    video: contents.filter(content => content.format === '视频').length,
  }
})

const selectedCampaignTaskCounts = computed(() => ({
  production: selectedCampaignTasks.value.filter(task => task.kind === '制作').length,
  publication: selectedCampaignTasks.value.filter(task => task.kind === '发布').length,
  monitoring: selectedCampaignTasks.value.filter(task => task.kind === '监测').length,
}))

const ownerHandoffs = computed(() =>
  snapshot.campaigns.flatMap(campaign =>
    campaign.handoffs.map(handoff => ({
      ...handoff,
      campaignTitle: campaign.title,
    })),
  ),
)

const enabledChannels = computed(() =>
  snapshot.channels.filter(channel => channel.enabled),
)

const channelSnapshotCount = computed(() =>
  snapshot.channels.filter(channel => channel.statusSource === 'marketing-ops').length,
)

const taskCounts = computed(() => ({
  '制作': snapshot.tasks.filter(task => task.kind === '制作').length,
  '发布': snapshot.tasks.filter(task => task.kind === '发布').length,
  '监测': snapshot.tasks.filter(task => task.kind === '监测').length,
}))

const pendingTaskCount = computed(() =>
  snapshot.tasks.filter(task => task.status !== 'published').length,
)

function activityTaskSummary(activityId: string): string {
  const tasks = snapshot.tasks.filter(task => task.activityId === activityId)
  if (tasks.length === 0)
    return '尚未生成任务'
  const counts = {
    制作: tasks.filter(task => task.kind === '制作').length,
    发布: tasks.filter(task => task.kind === '发布').length,
    监测: tasks.filter(task => task.kind === '监测').length,
  }
  return `${counts.制作} 制作 · ${counts.发布} 发布 · ${counts.监测} 监测`
}

function selectModule(moduleId: ModuleId): void {
  activeModule.value = moduleId
  void router.push(pathForModule(moduleId))
  if (moduleId === 'tasks') {
    activeTaskScope.value = '全部项目'
  }
  if (moduleId === 'project-tasks') {
    activeTaskScope.value = '当前项目'
  }
}

function moduleForPath(path: string): ModuleId {
  if (path === '/overview' || path === '/')
    return 'overview'
  if (path === '/tasks')
    return 'tasks'
  if (path === '/channels')
    return 'channels'
  if (path === '/project')
    return 'project'
  if (path === '/project/tasks')
    return 'project-tasks'
  if (path === '/project/assets')
    return 'assets'
  if (path === '/project/owner')
    return 'owner'
  if (path === '/project/reports')
    return 'reports'
  return 'activities'
}

function pathForModule(moduleId: ModuleId): string {
  const paths: Record<ModuleId, string> = {
    'activities': '/project/activities',
    'assets': '/project/assets',
    'channels': '/channels',
    'overview': '/overview',
    'owner': '/project/owner',
    'project': '/project',
    'project-tasks': '/project/tasks',
    'reports': '/project/reports',
    'tasks': '/tasks',
  }
  return paths[moduleId]
}

watch(() => route.path, (path) => {
  const module = moduleForPath(path)
  activeModule.value = module
  if (module === 'tasks')
    activeTaskScope.value = '全部项目'
  if (module === 'project-tasks')
    activeTaskScope.value = '当前项目'
})

function openActivityDetail(campaignId: string): void {
  selectedCampaignId.value = campaignId
  void router.push(`/project/activities/${encodeURIComponent(campaignId)}`)
}

function selectTask(taskId: string): void {
  selectedTaskId.value = taskId
  activeModule.value = 'tasks'
}

function selectAsset(assetId: string): void {
  selectedAssetId.value = assetId
}

function selectArtifact(activityId: string): void {
  openActivityDetail(activityId)
}

function setTaskScope(scope: '全部项目' | '当前项目'): void {
  activeTaskScope.value = scope
}

async function cancelSelectedTask(): Promise<void> {
  await changeSelectedTask('cancel')
}

async function startSelectedTask(): Promise<void> {
  await changeSelectedTask('start')
}

async function recordSelectedTask(): Promise<void> {
  await changeSelectedTask('record')
}

async function retrySelectedTask(): Promise<void> {
  await changeSelectedTask('retry')
}

async function confirmSelectedVideoPlan(): Promise<void> {
  if (!canConfirmSelectedVideoPlan.value || selectedCampaign.value.videoPlan === null)
    return
  videoPlanActionPending.value = true
  videoPlanActionError.value = null
  try {
    await workbenchRuntime.confirmActivityVideoPlan(
      snapshot.project.projectId,
      selectedCampaign.value.campaignId,
      selectedCampaign.value.version,
    )
    await refreshProjectView()
  }
  catch (error: unknown) {
    videoPlanActionError.value = error instanceof Error
      ? error.message
      : '拍摄大纲确认失败'
  }
  finally {
    videoPlanActionPending.value = false
  }
}

function defaultVideoViewport(format: VideoFormat): { height: number, width: number } {
  if (format === 'portrait')
    return { height: 1920, width: 1080 }
  if (format === 'square')
    return { height: 1080, width: 1080 }
  return { height: 1080, width: 1920 }
}

function applyActivityVideoFormat(format: string): void {
  if (!['landscape', 'portrait', 'square'].includes(format))
    return
  activityForm.videoFormat = format as VideoFormat
  const viewport = defaultVideoViewport(activityForm.videoFormat)
  activityForm.videoHeight = viewport.height
  activityForm.videoWidth = viewport.width
}

function syncVideoPlanViewportDraft(): void {
  const videoPlan = selectedCampaign.value.videoPlan
  if (videoPlan === null)
    return
  const viewport = videoPlan.viewport ?? defaultVideoViewport(videoPlan.format)
  videoPlanViewportDraft.height = viewport.height
  videoPlanViewportDraft.width = viewport.width
  videoPlanRevisionError.value = null
}

async function reviseSelectedVideoPlan(): Promise<void> {
  if (!canReviseSelectedVideoPlan.value)
    return
  videoPlanRevisionPending.value = true
  videoPlanRevisionError.value = null
  try {
    const projectView = await workbenchRuntime.project(snapshot.project.projectId)
    const activity = projectView.activities.find(candidate =>
      candidate.activityId === selectedCampaign.value.campaignId,
    )
    if (activity?.video === undefined)
      throw new Error('当前活动没有视频制作计划')
    await workbenchRuntime.reviseActivity({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: activity.projectId,
      topic: activity.topic,
      video: {
        ...activity.video,
        viewport: {
          height: videoPlanViewportDraft.height,
          width: videoPlanViewportDraft.width,
        },
      },
    })
    await refreshProjectView()
  }
  catch (error: unknown) {
    videoPlanRevisionError.value = error instanceof Error
      ? error.message
      : '拍摄计划修订失败'
  }
  finally {
    videoPlanRevisionPending.value = false
  }
}

async function changeSelectedTask(action: 'cancel' | 'record' | 'retry' | 'start'): Promise<void> {
  if (taskActionPending.value !== null || !selectedTaskIsRuntime.value)
    return
  taskActionPending.value = action
  taskActionError.value = null
  try {
    if (action === 'cancel')
      await workbenchRuntime.cancelTask(snapshot.project.projectId, selectedTask.value.taskId)
    else if (action === 'retry')
      await workbenchRuntime.retryTask(snapshot.project.projectId, selectedTask.value.taskId)
    else if (action === 'record')
      await workbenchRuntime.recordTask(
        snapshot.project.projectId,
        selectedTask.value.taskId,
        {
          baseUrl: snapshot.project.canonicalUrl,
          projectOrigin: snapshot.project.canonicalUrl,
        },
      )
    else
      await workbenchRuntime.startTask(snapshot.project.projectId, selectedTask.value.taskId)
    await refreshProjectView()
  }
  catch (error: unknown) {
    taskActionError.value = error instanceof Error ? error.message : '任务操作失败'
  }
  finally {
    taskActionPending.value = null
  }
}

function selectChannel(channelId: ChannelId): void {
  selectedChannelId.value = channelId
  selectedChannelAccountId.value = snapshot.channels.find(channel => channel.channel === channelId)?.projectAccountId ?? null
  syncChannelBindingForm()
}

function selectChannelAccount(accountId: string): void {
  selectedChannelAccountId.value = accountId
}

function syncChannelBindingForm(): void {
  const channel = selectedChannel.value
  channelBindingForm.accountRef = channel.projectAccountId ?? ''
  channelBindingForm.delivery = channel.delivery === '全自动候选'
    ? 'automatic-candidate'
    : channel.delivery === '仅生成内容'
      ? 'content-only'
      : 'owner-assisted'
}

async function saveChannelBinding(): Promise<void> {
  if (!snapshot.runtimeConnected || channelBindingSaving.value)
    return
  channelBindingSaving.value = true
  channelBindingSaveError.value = null
  const selectedAccount = channelBindingForm.accountRef === ''
    ? null
    : selectedChannel.value.accounts.find(account => account.accountId === channelBindingForm.accountRef) ?? null
  const input: ProjectChannelBinding = {
    channel: selectedChannel.value.channel,
    delivery: channelBindingForm.delivery,
    enabled: channelBindingForm.accountRef !== '',
    projectId: snapshot.project.projectId,
    ...(selectedAccount === null
      ? {}
      : { accountAlias: selectedAccount.alias }),
    ...(channelBindingForm.accountRef.trim() === ''
      ? {}
      : { accountRef: channelBindingForm.accountRef.trim() }),
  }
  try {
    await workbenchRuntime.saveProjectChannelBinding(input)
    await refreshProjectView()
    syncChannelBindingForm()
  }
  catch (error: unknown) {
    channelBindingSaveError.value = error instanceof Error
      ? error.message
      : '项目渠道配置保存失败'
  }
  finally {
    channelBindingSaving.value = false
  }
}

function openActivityComposer(): void {
  activityForm.channels = enabledChannels.value.slice(0, 1).map(channel => channel.channel)
  activityForm.topic = ''
  activityForm.videoEnabled = false
  activityForm.videoFormat = 'landscape'
  activityForm.videoHeight = 1080
  activityForm.videoWidth = 1920
  activitySaveError.value = null
  activityComposerOpen.value = true
}

function closeActivityComposer(): void {
  if (!activitySaving.value)
    activityComposerOpen.value = false
}

function openContentComposer(): void {
  contentForm.body = ''
  contentForm.channel = selectedCampaign.value.channels[0] ?? enabledChannels.value[0]?.channel ?? 'github'
  contentForm.coreMessage = selectedCampaign.value.topic
  contentForm.format = 'article'
  contentForm.locale = 'zh-CN'
  contentForm.title = ''
  contentSaveError.value = null
  publicationPlanActionError.value = null
  contentComposerOpen.value = true
}

function closeContentComposer(): void {
  if (!contentSaving.value)
    contentComposerOpen.value = false
}

async function saveChannelContent(): Promise<void> {
  if (!snapshot.runtimeConnected || contentForm.title.trim() === '' || contentForm.body.trim() === '')
    return
  contentSaving.value = true
  contentSaveError.value = null
  const suffix = Date.now()
  const groupInput: CreateContentGroupInput = {
    activityId: selectedCampaign.value.campaignId,
    contentGroupId: `group-${suffix}`,
    coreMessage: contentForm.coreMessage,
    projectId: snapshot.project.projectId,
    title: `${contentForm.title} · 内容组`,
  }
  const contentInput: CreateChannelContentInput = {
    activityId: selectedCampaign.value.campaignId,
    artifactIds: [],
    body: contentForm.body,
    channel: contentForm.channel,
    contentGroupId: groupInput.contentGroupId,
    contentId: `content-${suffix}`,
    format: contentForm.format,
    locale: contentForm.locale,
    projectId: snapshot.project.projectId,
    title: contentForm.title,
  }
  try {
    await workbenchRuntime.createContentGroup(groupInput)
    await workbenchRuntime.createChannelContent(contentInput)
    await refreshProjectView()
    contentComposerOpen.value = false
  }
  catch (error: unknown) {
    contentSaveError.value = error instanceof Error ? error.message : '渠道内容保存失败'
  }
  finally {
    contentSaving.value = false
  }
}

function hasPublicationTask(contentId: string): boolean {
  return selectedCampaignTasks.value.some(task =>
    task.kind === '发布' && task.contentId === contentId,
  )
}

async function createPublicationPlanForContent(content: ChannelContentProjection): Promise<void> {
  if (!snapshot.runtimeConnected || !selectedCampaignIsRuntime.value || hasPublicationTask(content.contentId))
    return
  publicationPlanActionPending.value = content.contentId
  publicationPlanActionError.value = null
  const input: PublicationPlan = {
    activityId: selectedCampaign.value.campaignId,
    channel: content.channel,
    contentId: content.contentId,
    projectId: snapshot.project.projectId,
    publicationId: `publication-${content.contentId}`,
  }
  try {
    await workbenchRuntime.createPublicationPlan(input)
    await refreshProjectView()
  }
  catch (error: unknown) {
    publicationPlanActionError.value = error instanceof Error
      ? error.message
      : '发布安排创建失败'
  }
  finally {
    publicationPlanActionPending.value = null
  }
}

function projectAssetKindForArtifact(
  artifact: ActivityArtifactProjection,
): ProjectAsset['kind'] | null {
  return artifact.kind === '视频'
    || artifact.kind === '视频片段'
    ? 'video'
    : artifact.kind === '图片'
      ? 'image'
      : artifact.kind === '音频'
        ? 'audio'
        : null
}

function isArtifactPromoted(artifact: ActivityArtifactProjection): boolean {
  return snapshot.projectAssets.some(asset => asset.assetId === `asset-${artifact.artifactId}`)
}

async function promoteActivityArtifact(artifact: ActivityArtifactProjection): Promise<void> {
  const kind = projectAssetKindForArtifact(artifact)
  if (
    kind === null
    || !snapshot.runtimeConnected
    || assetPromotionPending.value !== null
    || isArtifactPromoted(artifact)
  ) {
    return
  }
  assetPromotionPending.value = artifact.artifactId
  assetPromotionError.value = null
  try {
    await workbenchRuntime.promoteActivityArtifact({
      artifactId: artifact.artifactId,
      assetId: `asset-${artifact.artifactId}`,
      kind,
      projectId: snapshot.project.projectId,
    })
    await refreshProjectView()
  }
  catch (error: unknown) {
    assetPromotionError.value = error instanceof Error
      ? error.message
      : '活动产物晋升失败'
  }
  finally {
    assetPromotionPending.value = null
  }
}

async function toggleStorageCleanupPreview(): Promise<void> {
  if (!snapshot.runtimeConnected)
    return
  storagePreviewOpen.value = !storagePreviewOpen.value
  if (!storagePreviewOpen.value || storagePreviewLoading.value)
    return
  storagePreviewLoading.value = true
  storagePreviewError.value = null
  try {
    storagePreview.value = await workbenchRuntime.storageCleanupPreview(
      snapshot.project.projectId,
    )
  }
  catch (error: unknown) {
    storagePreviewError.value = error instanceof Error
      ? error.message
      : '清理预览读取失败'
  }
  finally {
    storagePreviewLoading.value = false
  }
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

async function saveActivity(): Promise<void> {
  if (!snapshot.runtimeConnected || activityForm.topic.trim() === '' || activityForm.channels.length === 0) {
    if (activityForm.channels.length === 0)
      activitySaveError.value = '至少选择一个项目渠道'
    return
  }
  if (activityForm.videoEnabled && projectCaptureFlowIds.value.length === 0) {
    activitySaveError.value = '当前项目没有登记可录制流程，暂时不能创建视频制作计划'
    return
  }
  activitySaving.value = true
  activitySaveError.value = null
  const activityId = `activity-${Date.now()}`
  const input: CreatePublishingActivityInput = {
    activityId,
    campaignId: activityId,
    channels: activityForm.channels.map(channel => ({ id: channel, locale: 'zh-CN' })),
    goal: 'education',
    projectId: snapshot.project.projectId,
    projectSnapshotId: currentSnapshotId.value,
    status: 'draft',
    targetUrl: snapshot.project.canonicalUrl,
    topic: {
      'en': activityForm.topic,
      'zh-CN': activityForm.topic,
    },
    ...(activityForm.videoEnabled
      ? {
          video: {
            flowIds: projectCaptureFlowIds.value,
            format: activityForm.videoFormat,
            viewport: {
              height: activityForm.videoHeight,
              width: activityForm.videoWidth,
            },
          },
        }
      : {}),
  }
  try {
    const activity = await workbenchRuntime.createActivity(input)
    snapshot.campaigns = [activityToCampaign(activity), ...snapshot.campaigns]
    const projectView = await workbenchRuntime.project(snapshot.project.projectId)
    applyProjectView(projectView)
    selectedCampaignId.value = activity.activityId
    activityComposerOpen.value = false
    activeModule.value = 'activities'
  }
  catch (error: unknown) {
    activitySaveError.value = error instanceof Error
      ? error.message
      : '发布活动创建失败'
  }
  finally {
    activitySaving.value = false
  }
}

function activityToCampaign(
  activity: PublishingActivity,
  contentGroups: ContentGroup[] = [],
  channelContents: ChannelContent[] = [],
  captureFlows: CaptureFlow[] = [],
  ownerHandoffs: OwnerHandoff[] = [],
  activityArtifacts: ActivityArtifact[] = [],
  projectAssets: ProjectAsset[] = [],
  productionTasks: ExecutionTask[] = [],
  recordingReceipts: RecordingAttemptRecord[] = [],
): CampaignProjection {
  const topic = activity.topic['zh-CN'] ?? activity.topic.en
  const groups = contentGroups
    .filter(group => group.activityId === activity.activityId)
    .map<ContentGroupProjection>(group => ({
      contentGroupId: group.contentGroupId,
      contents: channelContents
        .filter(content => content.contentGroupId === group.contentGroupId)
        .map<ChannelContentProjection>(content => ({
          accountAlias: projectAccountAliasForChannel(content.channel),
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
        accountAlias: projectAccountAliasForChannel(handoff.channel)
          ?? '项目账号待绑定',
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

function createVideoPlanProjection(
  activity: PublishingActivity,
  captureFlows: CaptureFlow[],
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

function taskToProjection(
  task: ExecutionTask,
  events: ExecutionTaskEvent[] = [],
): WorkbenchSnapshot['tasks'][number] {
  const campaign = snapshot.campaigns.find(candidate => candidate.campaignId === task.activityId)
  const channel = task.channel ?? campaign?.channels[0] ?? 'github'
  const account = projectAccountAliasForChannel(channel) ?? '未绑定账号'
  const activityTitle = campaign?.title ?? task.activityId
  const contentTitle = campaign?.contentGroups
    .flatMap(group => group.contents)
    .find(content => content.contentId === task.contentId)?.title
    ?? '等待 AI 生成内容'
  const lifecycle = taskLifecycleProjection(task, events)
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

onMounted(() => {
  if (import.meta.env.MODE !== 'test')
    void connectLocalRuntime()
})

async function connectLocalRuntime(): Promise<void> {
  try {
    const health = await workbenchRuntime.health()
    const projectView = await workbenchRuntime.project(snapshot.project.projectId)
    snapshot.runtimeConnected = health.status === 'ready'
    applyProjectView(projectView)
  }
  catch (error: unknown) {
    snapshot.runtimeConnected = false
    runtimeError.value = error instanceof Error
      ? error.message
      : '本地运行时暂时不可用'
  }
}

function applyProjectView(projectView: Awaited<ReturnType<typeof workbenchRuntime.project>>): void {
    currentSnapshotId.value = projectView.snapshot.snapshotId
    projectCaptureFlowIds.value = projectView.snapshot.manifest.captureFlows.map(flow => flow.id)
    snapshot.project = {
      ...snapshot.project,
      facts: projectView.snapshot.manifest.facts.map(fact =>
        fact.text['zh-CN'] ?? fact.text.en,
      ),
      integrationMode: projectView.project.sourceAccess === 'source-owned'
        ? '有源项目'
        : '无源项目',
      locales: projectView.snapshot.manifest.locales,
      name: projectView.project.name,
      previewReady: projectView.snapshot.manifest.captureFlows.length > 0,
      projectId: projectView.project.projectId,
      recordingMode: projectView.project.captureMode === 'deterministic'
        ? '项目适配器'
        : '浏览器辅助',
      version: `v${projectView.snapshot.version}`,
      canonicalUrl: projectView.snapshot.manifest.canonicalUrl,
    }
    const bindingByChannel = new Map(
      projectView.projectChannelBindings.map(binding => [binding.channel, binding]),
    )
    const enabledChannels = new Set(
      projectView.projectChannelBindings
        .filter(binding => binding.enabled)
        .map(binding => binding.channel),
    )
    snapshot.channels.forEach((channel) => {
      channel.enabled = enabledChannels.has(channel.channel)
      const binding = bindingByChannel.get(channel.channel)
      channel.projectAccountId = binding?.accountRef ?? null
    })
    const runtimeCampaigns = projectView.activities.map(activity =>
      activityToCampaign(
        activity,
        projectView.contentGroups,
        projectView.channelContents,
        projectView.snapshot.manifest.captureFlows,
        projectView.ownerHandoffs,
        projectView.activityArtifacts,
        projectView.projectAssets,
        projectView.tasks,
        projectView.recordingReceipts,
      ),
    )
    snapshot.projectAssets = runtimeProjectAssets(projectView)
    snapshot.activityArtifacts = runtimeActivityArtifacts(projectView)
    snapshot.storage = {
      ...snapshot.storage,
      activityArtifacts: snapshot.activityArtifacts.length,
      cacheSize: '未统计',
      projectAssets: snapshot.projectAssets.length,
      projectSize: '未统计',
      retention: '按项目配置',
    }
    snapshot.campaigns = [
      ...runtimeCampaigns,
      ...snapshot.campaigns.filter(campaign =>
        !runtimeCampaigns.some(runtimeCampaign =>
          runtimeCampaign.campaignId === campaign.campaignId,
        ),
      ),
    ]
    runtimeActivityIds.value = new Set(projectView.activities.map(activity => activity.activityId))
    runtimeTaskIds.value = new Set(projectView.tasks.map(task => task.taskId))
    const runtimeTasks = projectView.tasks.map(task =>
      taskToProjection(task, projectView.taskEvents[task.taskId] ?? []),
    )
    snapshot.tasks = [
      ...runtimeTasks,
      ...snapshot.tasks.filter(task =>
        !runtimeTasks.some(runtimeTask => runtimeTask.taskId === task.taskId),
      ),
    ]
    snapshot.reports = runtimeReports(projectView)
    syncChannelBindingForm()
    syncVideoPlanViewportDraft()
}

async function refreshProjectView(): Promise<void> {
  applyProjectView(await workbenchRuntime.project(snapshot.project.projectId))
}
</script>

<template>
  <WorkbenchShell
    :project-id="snapshot.project.projectId"
    :project-name="snapshot.project.name"
    :runtime-connected="snapshot.runtimeConnected"
    @navigate="selectModule"
  >

      <p v-if="runtimeError" class="runtime-connection-note" aria-live="polite">
        本地运行时未连接，当前保留只读演示：{{ runtimeError }}
      </p>

      <section
        class="workspace-header"
        data-testid="workbench-dashboard"
      >
        <div>
          <p class="eyebrow">
            {{ currentModule.scope }}
          </p>
          <h1>{{ currentModule.label }}</h1>
          <p class="workspace-copy">
            {{ currentModule.description }}
          </p>
        </div>
        <div class="workspace-actions">
          <span class="connection-pill">{{ snapshot.runtimeConnected ? '运行时已连接' : '只读演示' }}</span>
          <button
            type="button"
            :disabled="activeModule !== 'activities' || !snapshot.runtimeConnected"
            @click="openActivityComposer"
          >
            {{ activeModule === 'activities' ? (snapshot.runtimeConnected ? '新建发布活动' : '等待运行时') : '操作暂不可用' }}
          </button>
        </div>
      </section>

      <template v-if="activeModule === 'overview'">
        <OverviewPage
          :activity-task-summary="activityTaskSummary"
          :enabled-channel-count="enabledChannels.length"
          :owner-handoff-count="ownerHandoffs.length"
          :pending-task-count="pendingTaskCount"
          :snapshot="snapshot"
          @go-activities="selectModule('activities')"
          @go-tasks="selectModule('tasks')"
          @open-activity="openActivityDetail"
          @select-task="selectTask"
        />
      </template>
      <template v-else-if="activeModule === 'project'">
        <ProjectOverviewPage
          :activity-task-summary="activityTaskSummary"
          :channel-binding-form="channelBindingForm"
          :channel-binding-save-error="channelBindingSaveError"
          :channel-binding-saving="channelBindingSaving"
          :delivery-options="deliveryOptions"
          :enabled-channels="enabledChannels"
          :project-account-alias="projectAccountAlias"
          :project-account-options="projectAccountOptions"
          :project-accounts="projectAccounts"
          :runtime-connected="snapshot.runtimeConnected"
          :selected-channel="selectedChannel"
          :snapshot="snapshot"
          @go-activities="selectModule('activities')"
          @go-channels="selectModule('channels')"
          @save-channel-binding="saveChannelBinding"
          @select-activity="openActivityDetail"
          @select-channel="selectChannel"
        />
      </template>
      <template v-else-if="activeModule === 'activities'">
        <ActivityListPage
        :activity-composer-open="activityComposerOpen"
        :activity-form="activityForm"
        :activity-save-error="activitySaveError"
        :activity-saving="activitySaving"
        :can-confirm-selected-video-plan="canConfirmSelectedVideoPlan"
        :can-revise-selected-video-plan="canReviseSelectedVideoPlan"
        :content-composer-open="contentComposerOpen"
        :content-format-options="contentFormatOptions"
        :content-form="contentForm"
        :content-locale-options="contentLocaleOptions"
        :content-save-error="contentSaveError"
        :content-saving="contentSaving"
        :enabled-channels="enabledChannels"
        :has-publication-task="hasPublicationTask"
        :project-account-alias="projectAccountAlias"
        :publication-plan-action-error="publicationPlanActionError"
        :publication-plan-action-pending="publicationPlanActionPending"
        :selected-campaign="selectedCampaign"
        :selected-campaign-channel-options="selectedCampaignChannelOptions"
        :selected-campaign-content-counts="selectedCampaignContentCounts"
        :selected-campaign-is-runtime="selectedCampaignIsRuntime"
        :selected-campaign-task-counts="selectedCampaignTaskCounts"
        :selected-campaign-tasks="selectedCampaignTasks"
        :snapshot="snapshot"
        :video-format-options="videoFormatOptions"
        :video-plan-action-error="videoPlanActionError"
        :video-plan-action-pending="videoPlanActionPending"
        :video-plan-revision-error="videoPlanRevisionError"
        :video-plan-revision-pending="videoPlanRevisionPending"
        :video-plan-viewport-draft="videoPlanViewportDraft"
        @apply-activity-video-format="applyActivityVideoFormat"
        @close-activity-composer="closeActivityComposer"
        @close-content-composer="closeContentComposer"
        @confirm-video-plan="confirmSelectedVideoPlan"
        @create-publication-plan="createPublicationPlanForContent"
        @open-activity-detail="openActivityDetail"
        @open-content-composer="openContentComposer"
        @revise-video-plan="reviseSelectedVideoPlan"
        @save-activity="saveActivity"
        @save-channel-content="saveChannelContent"
        @select-task="selectTask"
        />
      </template>
      <template v-else-if="activeModule === 'tasks' || activeModule === 'project-tasks'">
        <TaskBoardPage
          :active-task-scope="activeTaskScope"
          :can-cancel-selected-task="canCancelSelectedTask"
          :can-record-selected-task="canRecordSelectedTask"
          :can-retry-selected-task="canRetrySelectedTask"
          :can-start-selected-task="canStartSelectedTask"
          :project-name="snapshot.project.name"
          :runtime-connected="snapshot.runtimeConnected"
          :selected-task="selectedTask"
          :selected-task-campaign="selectedTaskCampaign"
          :task-action-error="taskActionError"
          :task-action-pending="taskActionPending"
          :task-counts="taskCounts"
          :visible-tasks="visibleTasks"
          @change-task="changeSelectedTask"
          @select-task="selectTask"
          @set-scope="setTaskScope"
        />
      </template>
      <template v-else-if="activeModule === 'channels'">
        <ChannelManagementPage
          :account-reference-count="accountReferenceCount"
          :channel-snapshot-count="channelSnapshotCount"
          :enabled-channels="enabledChannels"
          :project-account-for="projectAccountFor"
          :runtime-connected="snapshot.runtimeConnected"
          :selected-channel="selectedChannel"
          :selected-channel-account="selectedChannelAccount"
          :snapshot="snapshot"
          @go-project="selectModule('project')"
          @select-channel="selectChannel"
          @select-channel-account="selectChannelAccount"
        />
      </template>
      <template v-else-if="activeModule === 'assets'">
        <AssetLibraryPage
          :asset-filter="assetFilter"
          :asset-promotion-error="assetPromotionError"
          :asset-promotion-pending="assetPromotionPending"
          :filtered-assets="filteredAssets"
          :format-storage-bytes="formatStorageBytes"
          :is-artifact-promoted="isArtifactPromoted"
          :project-asset-kind-for-artifact="projectAssetKindForArtifact"
          :runtime-connected="snapshot.runtimeConnected"
          :selected-asset="selectedAsset"
          :snapshot="snapshot"
          :storage-preview="storagePreview"
          :storage-preview-error="storagePreviewError"
          :storage-preview-loading="storagePreviewLoading"
          :storage-preview-open="storagePreviewOpen"
          @promote-artifact="promoteActivityArtifact"
          @select-asset="selectAsset"
          @select-artifact="selectArtifact"
          @set-filter="assetFilter = $event"
          @toggle-cleanup-preview="toggleStorageCleanupPreview"
        />
      </template>
      <template v-else-if="activeModule === 'owner'">
        <OwnerInboxPage :owner-handoffs="ownerHandoffs" />
      </template>

      <template v-else-if="activeModule === 'reports'">
        <ProjectReportsPage :snapshot="snapshot" @open-activity="openActivityDetail" />
      </template>

      <footer>
        <span>Content Studio · 本地优先控制面</span>
        <span>不保存凭据 · 不推断发布权限</span>
      </footer>
  </WorkbenchShell>
</template>
