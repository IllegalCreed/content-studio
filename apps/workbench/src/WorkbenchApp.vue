<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import ActivityListPage from './components/ActivityListPage.vue'
import AssetLibraryPage from './components/AssetLibraryPage.vue'
import ChannelManagementPage from './components/ChannelManagementPage.vue'
import OwnerInboxPage from './components/OwnerInboxPage.vue'
import OverviewPage from './components/OverviewPage.vue'
import ProjectOverviewPage from './components/ProjectOverviewPage.vue'
import ProjectReportsPage from './components/ProjectReportsPage.vue'
import SelectMenu from './components/SelectMenu.vue'
import TaskBoardPage from './components/TaskBoardPage.vue'
import WorkbenchShell from './components/WorkbenchShell.vue'
import {
  activityToCampaign,
  preferRuntimeData,
  projectChannels,
  projectMarketingOpsAccountCandidate,
  projectMarketingOpsChannels,
  runtimeActivityArtifacts,
  runtimeProjectAssets,
  runtimeReports,
  projectIndexProjections,
  taskToProjection,
} from './projections'
import VideoJobPanel from './components/VideoJobPanel.vue'
import AssetPreview from './components/AssetPreview.vue'
import type {
  AssetProjection,
  ActivityArtifactProjection,
  CampaignProjection,
  ChannelContentProjection,
  ChannelProjection,
  ProjectIndexProjection,
  WorkbenchSnapshot,
} from './model'
import type {
  ChannelId,
  ChannelContentFormat,
  ChannelContentMediaRevisionMode,
  CreatePublishingActivityInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  ContentFormat,
  ActivityArtifact,
  ContentStudioGlobalProjectView,
  ContentStudioGlobalView,
  ProjectAsset,
  ProjectChannelBinding,
  MarketingOpsChannelsStatusSnapshot,
  PublicationPlan,
  StorageCleanupResult,
  StorageCleanupPreview,
  StorageRecycleEntry,
  VideoFormat,
} from '@content-studio/core-types'
import {
  humanizeActivityStatus,
  humanizeContentFormat,
  humanizeTaskEventKind,
  humanizeStatus,
  isPublishingAssistantChannel,
  videoViewportForFormat,
} from './model'
import { createWorkbenchRuntime } from './runtime'
import {
  useWorkbenchUiStore,
  type AssetFilter,
  type TaskScope,
  type WorkbenchModuleId,
} from './stores/workbench-ui'
import {
  buildWorkbenchUiQuery,
  parseWorkbenchUiQuery,
  type WorkbenchUiRouteState,
} from './stores/workbench-ui-route'
import { useWorkbenchStore } from './stores/workbench'
import { MARKETING_OPS_STATUS_REFRESH_INTERVAL_MS } from '../../../src/constants'

type ModuleId = WorkbenchModuleId

const CONTENT_ONLY_PROJECT_BINDING = '__content-only-project-binding__'

interface ModuleDefinition {
  description: string
  group: 'global' | 'project'
  id: ModuleId
  label: string
  scope: string
}

const moduleDefinitions: ModuleDefinition[] = [
  {
    description: '跨项目查看活动、执行任务和待人工事项。',
    group: 'global',
    id: 'overview',
    label: '总览',
    scope: '全局控制台 / 跨项目汇总',
  },
  {
    description: '跨项目查看制作、发布和监测执行记录。',
    group: 'global',
    id: 'tasks',
    label: '全局任务面板',
    scope: '全局控制台',
  },
  {
    description: '管理跨项目渠道规格和全局账号，查看发布助手状态。',
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

const route = useRoute()
const router = useRouter()
const uiStore = useWorkbenchUiStore()
const runtimeStore = useWorkbenchStore()
const snapshot = runtimeStore.snapshot
const {
  activeModule,
  activeTaskScope,
  assetFilter,
  selectedAssetId,
  selectedCampaignId,
  selectedChannelAccountId,
  selectedChannelId,
  selectedTaskId,
} = storeToRefs(uiStore)
const selectedTaskProjectId = ref<string | null>(null)
const {
  loading: runtimeLoading,
  marketingOpsStatus,
  marketingOpsStatusError,
  marketingOpsStatusLoading,
  runtimeConnected,
  runtimeError,
} = storeToRefs(runtimeStore)
const initialModule = moduleForPath(route.path)
uiStore.setActiveModule(initialModule)
syncTaskScopeForModule(initialModule)
applyRouteUiState(route.query)
// 子页面暂时仍从快照读取这个兼容字段；连接状态的唯一来源已经是 runtimeStore。
watch(runtimeConnected, (value) => {
  snapshot.runtimeConnected = value
  if (!value)
    snapshot.channels = projectMarketingOpsChannels(snapshot.channels, null)
}, { immediate: true })
const workbenchRuntime = createWorkbenchRuntime()
const projectIndex = ref<ProjectIndexProjection[]>([])
const globalProjectViews = ref<ContentStudioGlobalProjectView[]>([])
const globalViewLoaded = ref(false)
const projectIndexForView = computed<ProjectIndexProjection[]>(() =>
  projectIndex.value.length > 0
    ? projectIndex.value
    : [{
        activityCount: snapshot.campaigns.length,
        enabledChannels: snapshot.channels
          .filter(channel => channel.enabled)
          .map(channel => ({
            ...(channel.alias === null ? {} : { accountAlias: channel.alias }),
            channel: channel.channel,
            delivery: channel.delivery === '全自动候选'
              ? 'automatic-candidate' as const
              : channel.delivery === '人工辅助'
                ? 'owner-assisted' as const
                : 'content-only' as const,
          })),
        name: snapshot.project.name,
        previewReady: snapshot.project.previewReady,
        projectId: snapshot.project.projectId,
        snapshotVersion: Number.parseInt(snapshot.project.version.replace(/\D+/u, '') || '0', 10),
        taskCount: snapshot.tasks.length,
        taskCounts: {
          monitoring: snapshot.tasks.filter(task => task.kind === '监测').length,
          production: snapshot.tasks.filter(task => task.kind === '制作').length,
          publication: snapshot.tasks.filter(task => task.kind === '发布').length,
        },
      }],
)
const projectOptions = computed(() => projectIndexForView.value.map(project => ({
  name: project.name,
  projectId: project.projectId,
})))
const currentSnapshotId = ref(`${snapshot.project.projectId}-snapshot-1`)
const activityComposerOpen = ref(false)
const activitySaving = ref(false)
const activitySaveError = ref<string | null>(null)
const contentComposerOpen = ref(false)
const contentSaving = ref(false)
const contentSaveError = ref<string | null>(null)
const publicationPlanActionError = ref<string | null>(null)
const publicationPlanActionPending = ref<string | null>(null)
const mediaRevisionArtifactIds = ref<string[]>([])
const mediaRevisionContent = ref<ChannelContentProjection | null>(null)
const mediaRevisionError = ref<string | null>(null)
const mediaRevisionMode = ref<ChannelContentMediaRevisionMode>('append')
const mediaRevisionPending = ref(false)
const assetPromotionError = ref<string | null>(null)
const assetPromotionPending = ref<string | null>(null)
const storagePreviewOpen = ref(false)
const storagePreviewLoading = ref(false)
const storagePreviewError = ref<string | null>(null)
const storagePreview = ref<StorageCleanupPreview | null>(null)
const storageCleanupArmed = ref(false)
const storageCleanupPending = ref(false)
const storageCleanupError = ref<string | null>(null)
const storageCleanupResult = ref<StorageCleanupResult | null>(null)
const storageRecycleEntries = ref<StorageRecycleEntry[]>([])
const storageRestorePending = ref<string | null>(null)
const storageRestoreError = ref<string | null>(null)
const channelBindingSaving = ref(false)
const channelBindingSaveError = ref<string | null>(null)
const runtimeTaskKeys = ref<Set<string>>(new Set())
const runtimeActivityIds = ref<Set<string>>(new Set())
const projectCaptureFlowIds = ref<string[]>([])
const taskActionError = ref<string | null>(null)
const taskActionPending = ref<'cancel' | 'confirm-owner' | 'record' | 'retry' | 'start' | null>(null)
const ownerHandoffActionError = ref<string | null>(null)
const ownerHandoffActionPending = ref<
  'cancel' | 'complete' | 'managed-abandon' | 'managed-confirm' | 'managed-resume' | null
>(null)
const videoPlanActionError = ref<string | null>(null)
const videoPlanActionPending = ref(false)
const videoPlanRevisionError = ref<string | null>(null)
const videoPlanRevisionPending = ref(false)
let runtimeRefreshTimer: ReturnType<typeof setInterval> | undefined
let marketingOpsRefreshTimer: ReturnType<typeof setInterval> | undefined
const videoPlanViewportDraft = reactive({
  height: 1080,
  width: 1920,
})

const emptyCampaign: CampaignProjection = {
  activityArtifacts: [],
  activityStatus: '草稿',
  assets: 0,
  campaignId: '__empty__',
  channels: [],
  contentGroups: [],
  executionStatus: 'queued',
  handoffs: [],
  nextAction: '当前项目还没有发布活动，可以从右上角新建一个。',
  referencedAssets: [],
  title: '尚未创建发布活动',
  topic: '当前项目还没有可展示的活动。',
  version: 0,
  videoJob: null,
  videoPlan: null,
}

const emptyTask: WorkbenchSnapshot['tasks'][number] = {
  accountAlias: '未绑定账号',
  activityId: '',
  activityTitle: '尚未创建发布活动',
  attempt: 0,
  attempts: [],
  channel: 'github',
  contentTitle: '暂无渠道内容',
  detail: '当前项目还没有制作、发布或监测任务。',
  events: [],
  kind: '制作',
  progress: 0,
  status: 'queued',
  steps: [],
  taskId: '__empty__',
  title: '尚未创建执行任务',
}
const activityForm = reactive<{
  channels: ChannelId[]
  contentFormats: Partial<Record<ChannelId, ContentFormat[]>>
  topic: string
  videoEnabled: boolean
  videoFormat: VideoFormat
  videoHeight: number
  videoWidth: number
}>({
  channels: ['github'],
  contentFormats: { github: ['article'] },
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
  format: ChannelContentFormat
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
}>({
  accountRef: snapshot.channels[0]?.projectAccountId ?? '',
})

const contentLocaleOptions = [
  { label: '中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
]

const videoFormatOptions: Array<{ label: string, value: VideoFormat }> = [
  { label: '横屏', value: 'landscape' },
  { label: '竖屏', value: 'portrait' },
  { label: '方形', value: 'square' },
]

const activityTargetsBilibiliVideo = computed(() =>
  activityForm.channels.includes('bilibili')
  && activityForm.contentFormats.bilibili?.includes('video-metadata') === true,
)

const activityVideoFormatOptions = computed(() =>
  activityTargetsBilibiliVideo.value
    ? videoFormatOptions.filter(option => option.value !== 'square')
    : videoFormatOptions,
)

watch(activityTargetsBilibiliVideo, (targetsBilibiliVideo) => {
  if (targetsBilibiliVideo && activityForm.videoFormat === 'square')
    applyActivityVideoFormat('landscape')
})

const currentModule = computed(() => {
  const module = moduleDefinitions.find(candidate => candidate.id === activeModule.value)
    ?? moduleDefinitions[0]!
  return module.group === 'project'
    ? { ...module, scope: `项目空间 / ${snapshot.project.name}` }
    : module
})

function projectViewAccountAliasForChannel(
  projectView: ContentStudioGlobalProjectView,
  channel: ChannelId,
): string | undefined {
  return projectView.projectChannelBindings.find(binding =>
    binding.channel === channel && binding.enabled,
  )?.accountAlias
}

function projectViewCampaigns(
  projectView: ContentStudioGlobalProjectView,
): CampaignProjection[] {
  return projectView.activities.map(activity => ({
    ...activityToCampaign({
      accountAliasForChannel: channel => projectViewAccountAliasForChannel(projectView, channel),
      activity,
      activityArtifacts: projectView.activityArtifacts,
      captureFlows: projectView.snapshot.manifest.captureFlows,
      channelContentReadiness: projectView.channelContentReadiness,
      channelContents: projectView.channelContents,
      contentGroups: projectView.contentGroups,
      ownerHandoffs: projectView.ownerHandoffs,
      productionTasks: projectView.tasks,
      projectAssets: projectView.projectAssets,
      recordingReceipts: projectView.recordingReceipts,
    }),
    projectName: projectView.project.name,
  }))
}

function projectViewTasks(
  projectView: ContentStudioGlobalProjectView,
  campaigns: readonly CampaignProjection[],
): WorkbenchSnapshot['tasks'] {
  return projectView.tasks.map(task => ({
    ...taskToProjection({
      accountAliasForChannel: channel => projectViewAccountAliasForChannel(projectView, channel),
      campaigns,
      events: projectView.taskEvents[task.taskId] ?? [],
      task,
    }),
    projectName: projectView.project.name,
  }))
}

const globalCampaignProjections = computed<CampaignProjection[]>(() => {
  if (!runtimeConnected.value || !globalViewLoaded.value)
    return snapshot.campaigns
  return globalProjectViews.value.flatMap(projectView => projectViewCampaigns(projectView))
})

const globalTaskProjections = computed<WorkbenchSnapshot['tasks']>(() => {
  if (!runtimeConnected.value || !globalViewLoaded.value)
    return snapshot.tasks
  return globalProjectViews.value.flatMap((projectView) => {
    const campaigns = projectViewCampaigns(projectView)
    return projectViewTasks(projectView, campaigns)
  })
})

const selectedCampaign = computed(() =>
  snapshot.campaigns.find(
    campaign => campaign.campaignId === selectedCampaignId.value,
  ) ?? snapshot.campaigns[0] ?? emptyCampaign,
)

function channelContentFormat(format: ContentFormat): ChannelContentFormat {
  return format === 'video-metadata' ? 'video' : format
}

function availableCampaignContentFormats(channelId: ChannelId): ContentFormat[] {
  const selected = selectedCampaign.value.channelContentFormats?.[channelId]
  if (selected !== undefined)
    return selected
  return snapshot.channels
    .find(channel => channel.channel === channelId)
    ?.contentForms
    ?.map(form => form.format) ?? []
}

const contentFormatOptions = computed(() =>
  availableCampaignContentFormats(contentForm.channel).map(format => ({
    label: humanizeContentFormat(format),
    value: channelContentFormat(format),
  })),
)

watch(contentFormatOptions, (options) => {
  if (options.some(option => option.value === contentForm.format))
    return
  contentForm.format = options[0]?.value ?? 'article'
}, { immediate: true })

const selectedCampaignIsRuntime = computed(() =>
  runtimeActivityIds.value.has(selectedCampaign.value.campaignId),
)

const canConfirmSelectedVideoPlan = computed(() =>
  runtimeConnected.value
  && selectedCampaignIsRuntime.value
  && selectedCampaign.value.videoPlan?.reviewStatus === '待确认'
  && !videoPlanActionPending.value,
)

const canReviseSelectedVideoPlan = computed(() =>
  runtimeConnected.value
  && selectedCampaignIsRuntime.value
  && selectedCampaign.value.videoPlan !== null
  && !videoPlanRevisionPending.value
  && videoPlanViewportDraft.width > 0
  && videoPlanViewportDraft.height > 0,
)

const selectedTask = computed(() => {
  const tasks = activeTaskScope.value === '全部项目'
    ? globalTaskProjections.value
    : snapshot.tasks
  return tasks.find(task =>
    task.taskId === selectedTaskId.value
    && (selectedTaskProjectId.value === null || task.projectId === selectedTaskProjectId.value),
  ) ?? tasks[0] ?? emptyTask
})

const selectedTaskIsRuntime = computed(() =>
  runtimeTaskKeys.value.has(`${selectedTask.value.projectId ?? snapshot.project.projectId}:${selectedTask.value.taskId}`),
)

const canCancelSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && runtimeConnected.value
  && ['awaiting-owner', 'composing', 'generating', 'queued', 'recording'].includes(selectedTask.value.status),
)

const canStartSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && runtimeConnected.value
  && selectedTask.value.kind === '制作'
  && selectedTask.value.status === 'queued',
)

const canRecordSelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && runtimeConnected.value
  && selectedTask.value.kind === '制作'
  && selectedTask.value.productionType === '视频'
  && selectedTask.value.status === 'generating',
)

const canConfirmSelectedOwnerTakeover = computed(() =>
  selectedTaskIsRuntime.value
  && runtimeConnected.value
  && selectedTask.value.kind === '制作'
  && selectedTask.value.status === 'awaiting-owner',
)

const canRetrySelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && runtimeConnected.value
  && ['cancelled', 'failed'].includes(selectedTask.value.status),
)

const hasActiveRuntimeTask = computed(() =>
  runtimeConnected.value
  && (activeTaskScope.value === '全部项目' ? globalTaskProjections.value : snapshot.tasks).some(task =>
    runtimeTaskKeys.value.has(`${task.projectId ?? snapshot.project.projectId}:${task.taskId}`)
    && ['awaiting-owner', 'generating', 'recording'].includes(task.status),
  ),
)

watch(
  [runtimeConnected, hasActiveRuntimeTask],
  ([connected, active]) => {
    if (runtimeRefreshTimer !== undefined) {
      clearInterval(runtimeRefreshTimer)
      runtimeRefreshTimer = undefined
    }
    if (import.meta.env.MODE === 'test' || !connected || !active)
      return
    runtimeRefreshTimer = setInterval(() => {
      void refreshProjectView().catch(error => {
        runtimeStore.markRuntimeUnavailable(error)
      })
    }, 1000)
  },
  { immediate: true },
)

watch(runtimeConnected, (connected) => {
  if (marketingOpsRefreshTimer !== undefined) {
    clearInterval(marketingOpsRefreshTimer)
    marketingOpsRefreshTimer = undefined
  }
  if (import.meta.env.MODE === 'test' || !connected)
    return
  marketingOpsRefreshTimer = setInterval(() => {
    void refreshMarketingOpsStatusSnapshot()
  }, MARKETING_OPS_STATUS_REFRESH_INTERVAL_MS)
}, { immediate: true })

onBeforeUnmount(() => {
  if (runtimeRefreshTimer !== undefined)
    clearInterval(runtimeRefreshTimer)
  if (marketingOpsRefreshTimer !== undefined)
    clearInterval(marketingOpsRefreshTimer)
})

async function refreshMarketingOpsStatusSnapshot(): Promise<void> {
  const status = await runtimeStore.refreshMarketingOpsStatus(
    snapshot.project.projectId,
  )
  snapshot.channels = projectMarketingOpsChannels(snapshot.channels, status)
}

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
    : globalTaskProjections.value,
)

const filteredAssets = computed(() =>
  assetFilter.value === '全部'
    ? snapshot.projectAssets
    : snapshot.projectAssets.filter(asset => asset.kind === assetFilter.value),
)

const selectedCampaignTasks = computed(() =>
  snapshot.tasks.filter(task => task.activityId === selectedCampaign.value.campaignId),
)

const selectedTaskCampaign = computed(() => {
  const campaigns = activeTaskScope.value === '全部项目'
    ? globalCampaignProjections.value
    : snapshot.campaigns
  return campaigns.find(campaign =>
    campaign.campaignId === selectedTask.value.activityId
    && (selectedTaskProjectId.value === null
      || campaign.projectId === undefined
      || campaign.projectId === selectedTaskProjectId.value),
  ) ?? campaigns[0] ?? emptyCampaign
})

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

const selectedMarketingOpsAccountCandidate = computed(() =>
  projectMarketingOpsAccountCandidate(
    selectedChannel.value,
    marketingOpsStatus.value,
  ),
)

const projectAccountOptions = computed(() => {
  const channel = selectedChannel.value
  const candidate = selectedMarketingOpsAccountCandidate.value
  const hasCandidateAccount = candidate !== null
    && channel.accounts.some(account => account.accountId === candidate.accountRef)
  return [
    { label: '不使用该渠道', value: '' },
    ...(channel.delivery === '仅生成内容'
      ? [{ label: '启用内容生成 · 无需发布账号', value: CONTENT_ONLY_PROJECT_BINDING }]
      : [
          ...(!hasCandidateAccount && candidate !== null
            ? [{
                label: `${candidate.accountAlias ?? '已解析账号'} · marketing-ops 当前检测到的账号`,
                value: candidate.accountRef,
              }]
            : []),
          ...channel.accounts.map(account => ({
            label: `${account.alias} · 已被 ${account.assignedProjects.length} 个项目引用`,
            value: account.accountId,
          })),
        ]),
  ]
})

const selectedCampaignChannelOptions = computed(() =>
  selectedCampaign.value.channels.map(channel => ({ label: channel, value: channel })),
)

const selectedCampaignContentCounts = computed(() => {
  const contents = selectedCampaign.value.contentGroups.flatMap(group => group.contents)
  return {
    article: contents.filter(content => content.format === '文章').length,
    artifacts: contents.reduce((total, content) => total + (content.artifactIds?.length ?? 0), 0),
    imageText: contents.filter(content => content.format === '图文').length,
    shortPost: contents.filter(content => content.format === '动态').length,
    video: contents.filter(content => content.format === '视频').length,
  }
})

const selectedCampaignTaskCounts = computed(() => ({
  production: selectedCampaignTasks.value.filter(task => task.kind === '制作').length,
  publication: selectedCampaignTasks.value.filter(task => task.kind === '发布').length,
  monitoring: selectedCampaignTasks.value.filter(task => task.kind === '监测').length,
}))

function ownerHandoffsFor(
  campaigns: readonly CampaignProjection[],
  tasks: readonly WorkbenchSnapshot['tasks'][number][],
) {
  return campaigns.flatMap(campaign =>
    campaign.handoffs.map((handoff) => {
      const task = tasks.find(candidate =>
        (campaign.projectId === undefined || candidate.projectId === campaign.projectId)
        && candidate.activityId === campaign.campaignId
        && candidate.kind === '发布'
        && candidate.channel === handoff.channel,
      )
      return {
        ...handoff,
        campaignTitle: campaign.title,
        ...(task === undefined ? {} : { taskId: task.taskId }),
      }
    }),
  )
}

const ownerHandoffs = computed(() => ownerHandoffsFor(snapshot.campaigns, snapshot.tasks))

const pendingOwnerHandoffs = computed(() =>
  ownerHandoffs.value.filter(handoff => handoff.status === 'ready' || handoff.status === 'waiting'),
)

const globalOwnerHandoffs = computed(() =>
  ownerHandoffsFor(globalCampaignProjections.value, globalTaskProjections.value),
)

const globalPendingOwnerHandoffs = computed(() =>
  globalOwnerHandoffs.value.filter(handoff => handoff.status === 'ready' || handoff.status === 'waiting'),
)

const enabledChannels = computed(() =>
  snapshot.channels.filter(channel => channel.enabled),
)

const channelSnapshotCount = computed(() =>
  !runtimeConnected.value || marketingOpsStatus.value === null
    ? 0
    : marketingOpsStatus.value.channels.filter(status =>
        snapshot.channels.some(channel =>
          channel.channel === status.channel
          && isPublishingAssistantChannel(channel),
        ),
      ).length,
)

const taskCounts = computed(() => ({
  '制作': snapshot.tasks.filter(task => task.kind === '制作').length,
  '发布': snapshot.tasks.filter(task => task.kind === '发布').length,
  '监测': snapshot.tasks.filter(task => task.kind === '监测').length,
}))

const globalTaskCounts = computed(() => ({
  '制作': globalTaskProjections.value.filter(task => task.kind === '制作').length,
  '发布': globalTaskProjections.value.filter(task => task.kind === '发布').length,
  '监测': globalTaskProjections.value.filter(task => task.kind === '监测').length,
}))

const globalPendingTaskCount = computed(() =>
  globalTaskProjections.value.filter(task =>
    task.status !== 'cancelled'
    && task.status !== 'completed'
    && task.status !== 'published').length,
)

function activityTaskSummary(activityId: string, projectId?: string): string {
  const tasks = (projectId === undefined ? snapshot.tasks : globalTaskProjections.value).filter(task =>
    task.activityId === activityId
    && (projectId === undefined || task.projectId === projectId),
  )
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
  uiStore.setActiveModule(moduleId)
  syncTaskScopeForModule(moduleId)
  void router.push({
    path: pathForModule(moduleId),
    query: routeQueryForModule(moduleId),
  })
}

function syncTaskScopeForModule(moduleId: ModuleId): void {
  if (moduleId === 'tasks')
    uiStore.setTaskScope('全部项目')
  else if (moduleId === 'project-tasks') {
    uiStore.setTaskScope('当前项目')
    selectedTaskProjectId.value = snapshot.project.projectId
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
  uiStore.setActiveModule(module)
  syncTaskScopeForModule(module)
  const query = routeQueryForModule(module)
  if (!sameRouteQuery(route.query, query))
    void router.replace({ query })
})

watch(() => route.query, query => applyRouteUiState(query), { deep: true })
watch(
  [selectedCampaignId, selectedTaskId, selectedTaskProjectId, selectedAssetId, assetFilter, selectedChannelId, selectedChannelAccountId],
  () => {
    const query = routeQueryForModule(activeModule.value)
    if (sameRouteQuery(route.query, query))
      return
    void router.replace({ query })
  },
  { flush: 'post' },
)

function applyRouteUiState(query: Parameters<typeof parseWorkbenchUiQuery>[0]): void {
  const state = parseWorkbenchUiQuery(query)
  if (state.selectedCampaignId !== undefined)
    uiStore.selectCampaign(state.selectedCampaignId)
  if (state.selectedTaskId !== undefined) {
    uiStore.selectTask(state.selectedTaskId)
    selectedTaskProjectId.value = state.selectedTaskProjectId ?? null
  }
  if (state.selectedAssetId !== undefined)
    uiStore.selectAsset(state.selectedAssetId)
  if (state.assetFilter !== undefined)
    uiStore.setAssetFilter(state.assetFilter)
  if (state.selectedChannelId !== undefined)
    uiStore.selectChannel(state.selectedChannelId)
  if (state.selectedChannelAccountId !== undefined)
    uiStore.selectChannelAccount(state.selectedChannelAccountId)
}

function currentRouteUiState(): WorkbenchUiRouteState {
  return {
    assetFilter: assetFilter.value,
    selectedAssetId: selectedAssetId.value,
    selectedCampaignId: selectedCampaignId.value,
    selectedChannelAccountId: selectedChannelAccountId.value ?? undefined,
    selectedChannelId: selectedChannelId.value,
    selectedTaskProjectId: selectedTaskProjectId.value ?? undefined,
    selectedTaskId: selectedTaskId.value,
  }
}

function routeQueryForModule(moduleId: ModuleId) {
  return buildWorkbenchUiQuery(moduleId, currentRouteUiState())
}

function sameRouteQuery(
  current: Parameters<typeof parseWorkbenchUiQuery>[0],
  next: ReturnType<typeof buildWorkbenchUiQuery>,
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)])
  return [...keys].every((key) => {
    const currentValue = queryValues(current[key])
    const nextValue = queryValues(next[key])
    return currentValue.length === nextValue.length
      && currentValue.every((value, index) => value === nextValue[index])
  })
}

function queryValues(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

async function openActivityDetail(campaignId: string, projectId = snapshot.project.projectId): Promise<void> {
  closeChannelContentMediaRevision()
  await router.push(`/project/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(campaignId)}`)
  uiStore.selectCampaign(campaignId)
}

function openGlobalActivity(projectId: string, activityId: string): void {
  if (projectId === snapshot.project.projectId) {
    openActivityDetail(activityId, projectId)
    return
  }
  void switchProject(projectId).then(() => openActivityDetail(activityId, projectId))
}

function selectTask(projectIdOrTaskId: string, taskIdFromEvent?: string): void {
  const taskId = taskIdFromEvent ?? projectIdOrTaskId
  selectedTaskProjectId.value = taskIdFromEvent === undefined
    ? globalTaskProjections.value.find(task => task.taskId === taskId)?.projectId ?? snapshot.project.projectId
    : projectIdOrTaskId
  uiStore.selectTask(taskId)
  uiStore.setActiveModule('tasks')
}

function selectGlobalTask(projectId: string, taskId: string): void {
  selectedTaskProjectId.value = projectId
  uiStore.selectTask(taskId)
  uiStore.setActiveModule('tasks')
}

function openOwnerTask(taskId: string): void {
  selectedTaskProjectId.value = snapshot.project.projectId
  uiStore.selectTask(taskId)
  uiStore.setTaskScope('当前项目')
  void router.push({
    path: '/project/tasks',
    query: routeQueryForModule('project-tasks'),
  })
}

async function updateOwnerHandoff(
  handoffId: string,
  action: 'cancel' | 'complete',
): Promise<void> {
  if (!runtimeConnected.value || ownerHandoffActionPending.value !== null)
    return
  if (action === 'cancel' && !window.confirm('确认取消这次人工交接吗？取消后发布任务会停止，之后需要重新建立交接。'))
    return
  ownerHandoffActionPending.value = action
  ownerHandoffActionError.value = null
  try {
    if (action === 'complete')
      await workbenchRuntime.completeOwnerHandoff(snapshot.project.projectId, handoffId)
    else
      await workbenchRuntime.cancelOwnerHandoff(snapshot.project.projectId, handoffId)
    await refreshProjectView()
  }
  catch (error: unknown) {
    ownerHandoffActionError.value = error instanceof Error ? error.message : '人工交接状态保存失败'
  }
  finally {
    ownerHandoffActionPending.value = null
  }
}

async function updateManagedPublicationHandoff(
  handoffId: string,
  action: 'abandon' | 'confirm' | 'resume',
): Promise<void> {
  if (!runtimeConnected.value || ownerHandoffActionPending.value !== null)
    return
  if (
    action === 'confirm'
    && !window.confirm('确认将运行时观察到的严格公开地址写入发布回执吗？')
  ) {
    return
  }
  if (
    action === 'abandon'
    && !window.confirm('确认放弃这次受管发布交接吗？这不会删除任何已发布内容。')
  ) {
    return
  }
  ownerHandoffActionPending.value = `managed-${action}`
  ownerHandoffActionError.value = null
  try {
    if (action === 'resume') {
      await workbenchRuntime.resumeManagedPublicationHandoff(
        snapshot.project.projectId,
        handoffId,
      )
    }
    else if (action === 'confirm') {
      await workbenchRuntime.confirmManagedPublicationHandoff(
        snapshot.project.projectId,
        handoffId,
      )
    }
    else {
      await workbenchRuntime.abandonManagedPublicationHandoff(
        snapshot.project.projectId,
        handoffId,
      )
    }
    await refreshProjectView()
  }
  catch (error: unknown) {
    ownerHandoffActionError.value = error instanceof Error
      ? error.message
      : '受管发布交接处理失败'
  }
  finally {
    ownerHandoffActionPending.value = null
  }
}

function selectAsset(assetId: string): void {
  uiStore.selectAsset(assetId)
}

function selectArtifact(activityId: string): void {
  openActivityDetail(activityId)
}

function setTaskScope(scope: '全部项目' | '当前项目'): void {
  uiStore.setTaskScope(scope)
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
        recordingProfile: {
          ...activity.video.recordingProfile,
          defaults: {
            ...activity.video.recordingProfile?.defaults,
            viewport: {
              height: videoPlanViewportDraft.height,
              width: videoPlanViewportDraft.width,
            },
          },
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

async function changeSelectedTask(
  action: 'cancel' | 'confirm-owner' | 'record' | 'retry' | 'start',
): Promise<void> {
  if (taskActionPending.value !== null || !selectedTaskIsRuntime.value)
    return
  const projectId = selectedTask.value.projectId ?? snapshot.project.projectId
  const projectView = globalProjectViews.value.find(view => view.project.projectId === projectId)
  taskActionPending.value = action
  taskActionError.value = null
  try {
    if (action === 'cancel')
      await workbenchRuntime.cancelTask(projectId, selectedTask.value.taskId)
    else if (action === 'confirm-owner')
      await workbenchRuntime.confirmOwnerTakeover(projectId, selectedTask.value.taskId)
    else if (action === 'retry')
      await workbenchRuntime.retryTask(projectId, selectedTask.value.taskId)
    else if (action === 'record')
      await workbenchRuntime.recordTask(
        projectId,
        selectedTask.value.taskId,
        {
          baseUrl: projectView?.snapshot.manifest.canonicalUrl ?? snapshot.project.canonicalUrl,
          projectOrigin: projectView?.snapshot.manifest.canonicalUrl ?? snapshot.project.canonicalUrl,
        },
      )
    else
      await workbenchRuntime.startTask(projectId, selectedTask.value.taskId)
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
  uiStore.selectChannel(
    channelId,
    snapshot.channels.find(channel => channel.channel === channelId)?.projectAccountId ?? null,
  )
  syncChannelBindingForm()
}

function selectChannelAccount(accountId: string): void {
  uiStore.selectChannelAccount(accountId)
}

function syncChannelBindingForm(): void {
  const channel = selectedChannel.value
  channelBindingForm.accountRef = channel.delivery === '仅生成内容' && channel.enabled
    ? CONTENT_ONLY_PROJECT_BINDING
    : channel.projectAccountId ?? ''
}

function deliveryModeForChannel(channel: ChannelProjection): ProjectChannelBinding['delivery'] {
  return channel.delivery === '全自动候选'
    ? 'automatic-candidate'
    : channel.delivery === '仅生成内容'
      ? 'content-only'
      : 'owner-assisted'
}

async function saveChannelBinding(): Promise<void> {
  if (!runtimeConnected.value || channelBindingSaving.value)
    return
  channelBindingSaving.value = true
  channelBindingSaveError.value = null
  const selectedAccount = channelBindingForm.accountRef === '' || channelBindingForm.accountRef === CONTENT_ONLY_PROJECT_BINDING
    ? null
    : selectedChannel.value.accounts.find(account => account.accountId === channelBindingForm.accountRef) ?? null
  const selectedMarketingOpsAccount = selectedMarketingOpsAccountCandidate.value?.accountRef
    === channelBindingForm.accountRef
    ? selectedMarketingOpsAccountCandidate.value
    : null
  const accountAlias = selectedAccount?.alias ?? selectedMarketingOpsAccount?.accountAlias
  const input: ProjectChannelBinding = {
    channel: selectedChannel.value.channel,
    delivery: deliveryModeForChannel(selectedChannel.value),
    enabled: channelBindingForm.accountRef !== '',
    projectId: snapshot.project.projectId,
    ...(accountAlias === undefined
      ? {}
      : { accountAlias }),
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

function defaultActivityContentFormats(channel: ChannelProjection): ContentFormat[] {
  const defaultFormats = channel.contentForms
    ?.filter(form => form.isDefault)
    .map(form => form.format) ?? []
  return defaultFormats.length > 0
    ? defaultFormats
    : channel.contentForms?.slice(0, 1).map(form => form.format) ?? []
}

function openActivityComposer(): void {
  activityForm.channels = enabledChannels.value.slice(0, 1).map(channel => channel.channel)
  activityForm.contentFormats = Object.fromEntries(
    enabledChannels.value.map(channel => [
      channel.channel,
      defaultActivityContentFormats(channel),
    ]),
  )
  activityForm.topic = ''
  activityForm.videoEnabled = false
  activityForm.videoFormat = 'landscape'
  activityForm.videoHeight = 1080
  activityForm.videoWidth = 1920
  activitySaveError.value = null
  activityComposerOpen.value = true
}

function toggleActivityChannelFormat(
  channelId: ChannelId,
  format: ContentFormat,
): void {
  const selected = activityForm.contentFormats[channelId] ?? []
  if (selected.includes(format)) {
    if (selected.length === 1)
      return
    activityForm.contentFormats[channelId] = selected.filter(candidate => candidate !== format)
    return
  }
  activityForm.contentFormats[channelId] = [...selected, format]
}

function closeActivityComposer(): void {
  if (!activitySaving.value)
    activityComposerOpen.value = false
}

function openContentComposer(): void {
  contentForm.body = ''
  contentForm.channel = selectedCampaign.value.channels[0] ?? enabledChannels.value[0]?.channel ?? 'github'
  contentForm.coreMessage = selectedCampaign.value.topic
  contentForm.format = contentFormatOptions.value[0]?.value ?? 'article'
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

function openChannelContentMediaRevision(content: ChannelContentProjection): void {
  if (!runtimeConnected.value || !selectedCampaignIsRuntime.value || content.version === undefined)
    return
  mediaRevisionArtifactIds.value = []
  mediaRevisionContent.value = content
  mediaRevisionError.value = null
  mediaRevisionMode.value = 'append'
}

function closeChannelContentMediaRevision(): void {
  if (mediaRevisionPending.value)
    return
  mediaRevisionArtifactIds.value = []
  mediaRevisionContent.value = null
  mediaRevisionError.value = null
  mediaRevisionMode.value = 'append'
}

function currentChannelContentMediaIds(content: ChannelContentProjection): string[] {
  const finalMediaIds = new Set(
    selectedCampaign.value.activityArtifacts
      .filter(artifact => artifact.kind === '图片' || artifact.kind === '视频')
      .map(artifact => artifact.artifactId),
  )
  return (content.artifactIds ?? []).filter(artifactId => finalMediaIds.has(artifactId))
}

function setChannelContentMediaRevisionMode(
  mode: ChannelContentMediaRevisionMode,
): void {
  mediaRevisionMode.value = mode
  mediaRevisionArtifactIds.value = mode === 'replace' && mediaRevisionContent.value !== null
    ? currentChannelContentMediaIds(mediaRevisionContent.value)
    : []
}

function toggleChannelContentMediaRevisionArtifact(artifactId: string): void {
  const selected = new Set(mediaRevisionArtifactIds.value)
  if (selected.has(artifactId))
    selected.delete(artifactId)
  else
    selected.add(artifactId)
  mediaRevisionArtifactIds.value = [...selected]
}

async function saveChannelContentMediaRevision(): Promise<void> {
  const content = mediaRevisionContent.value
  if (
    !runtimeConnected.value
    || !selectedCampaignIsRuntime.value
    || content?.version === undefined
    || (mediaRevisionMode.value === 'append' && mediaRevisionArtifactIds.value.length === 0)
  ) {
    return
  }
  mediaRevisionPending.value = true
  mediaRevisionError.value = null
  try {
    await workbenchRuntime.reviseChannelContentMedia({
      artifactIds: [...mediaRevisionArtifactIds.value],
      baseVersion: content.version,
      contentId: content.contentId,
      mode: mediaRevisionMode.value,
      projectId: snapshot.project.projectId,
    })
    await refreshProjectView()
    mediaRevisionArtifactIds.value = []
    mediaRevisionContent.value = null
    mediaRevisionMode.value = 'append'
  }
  catch (error: unknown) {
    mediaRevisionError.value = error instanceof Error
      ? error.message
      : '渠道内容媒体修订失败'
  }
  finally {
    mediaRevisionPending.value = false
  }
}

async function saveChannelContent(): Promise<void> {
  if (!runtimeConnected.value || contentForm.title.trim() === '' || contentForm.body.trim() === '')
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

function canPublishContent(channelId: ChannelId): boolean {
  const channel = snapshot.channels.find(candidate => candidate.channel === channelId)
  return channel !== undefined && isPublishingAssistantChannel(channel)
}

async function createPublicationPlanForContent(content: ChannelContentProjection): Promise<void> {
  if (!runtimeConnected.value || !selectedCampaignIsRuntime.value || !canPublishContent(content.channel) || content.publicationReady === false || hasPublicationTask(content.contentId))
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
    || !runtimeConnected.value
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
  if (!runtimeConnected.value)
    return
  storagePreviewOpen.value = !storagePreviewOpen.value
  storageCleanupArmed.value = false
  storageCleanupError.value = null
  storageRestoreError.value = null
  if (!storagePreviewOpen.value || storagePreviewLoading.value)
    return
  storagePreviewLoading.value = true
  storagePreviewError.value = null
  try {
    const [preview, recycle] = await Promise.all([
      workbenchRuntime.storageCleanupPreview(snapshot.project.projectId),
      workbenchRuntime.storageRecycle(snapshot.project.projectId),
    ])
    storagePreview.value = preview
    storageRecycleEntries.value = recycle.entries
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

async function confirmStorageCleanup(): Promise<void> {
  const preview = storagePreview.value
  if (
    !runtimeConnected.value
    || preview === null
    || preview.totals.reviewFiles === 0
    || storageCleanupPending.value
  ) {
    return
  }
  if (!storageCleanupArmed.value) {
    storageCleanupArmed.value = true
    return
  }
  storageCleanupPending.value = true
  storageCleanupError.value = null
  try {
    storageCleanupResult.value = await workbenchRuntime.confirmStorageCleanup({
      itemIds: preview.items
        .filter(item => item.status === 'review')
        .map(item => item.id),
      previewId: preview.previewId,
      projectId: snapshot.project.projectId,
    })
    storageCleanupArmed.value = false
    const [nextPreview, recycle] = await Promise.all([
      workbenchRuntime.storageCleanupPreview(snapshot.project.projectId),
      workbenchRuntime.storageRecycle(snapshot.project.projectId),
    ])
    storagePreview.value = nextPreview
    storageRecycleEntries.value = recycle.entries
  }
  catch (error: unknown) {
    storageCleanupError.value = error instanceof Error
      ? error.message
      : '移入回收区失败，请重新读取预览'
    storageCleanupArmed.value = false
  }
  finally {
    storageCleanupPending.value = false
  }
}

async function restoreStorageRecycleEntry(recycleId: string): Promise<void> {
  if (!runtimeConnected.value || storageRestorePending.value !== null)
    return
  storageRestorePending.value = recycleId
  storageRestoreError.value = null
  try {
    await workbenchRuntime.restoreStorageRecycleEntry(
      snapshot.project.projectId,
      recycleId,
    )
    const [preview, recycle] = await Promise.all([
      workbenchRuntime.storageCleanupPreview(snapshot.project.projectId),
      workbenchRuntime.storageRecycle(snapshot.project.projectId),
    ])
    storagePreview.value = preview
    storageRecycleEntries.value = recycle.entries
  }
  catch (error: unknown) {
    storageRestoreError.value = error instanceof Error
      ? error.message
      : '恢复回收文件失败，请重新读取回收区'
  }
  finally {
    storageRestorePending.value = null
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
  if (!runtimeConnected.value || activityForm.topic.trim() === '' || activityForm.channels.length === 0) {
    if (activityForm.channels.length === 0)
      activitySaveError.value = '至少选择一个项目渠道'
    return
  }
  const channelWithoutContentFormat = activityForm.channels.find(channel =>
    (activityForm.contentFormats[channel]?.length ?? 0) === 0,
  )
  if (channelWithoutContentFormat !== undefined) {
    activitySaveError.value = `${channelWithoutContentFormat} 至少选择一种内容形态`
    return
  }
  if (activityTargetsBilibiliVideo.value && !activityForm.videoEnabled) {
    activitySaveError.value = 'Bilibili 视频内容需要同时启用视频制作计划'
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
    channels: activityForm.channels.map(channel => ({
      contentFormats: [...activityForm.contentFormats[channel]!],
      id: channel,
      locale: 'zh-CN',
    })),
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
            recordingProfile: {
              defaults: {
                viewport: {
                  height: activityForm.videoHeight,
                  width: activityForm.videoWidth,
                },
              },
            },
          },
        }
      : {}),
  }
  try {
    const activity = await workbenchRuntime.createActivity(input)
    snapshot.campaigns = [activityToCampaign({
      accountAliasForChannel: projectAccountAliasForChannel,
      activity,
    }), ...snapshot.campaigns]
    const projectView = await workbenchRuntime.project(snapshot.project.projectId)
    applyProjectView(projectView)
    uiStore.selectCampaign(activity.activityId)
    activityComposerOpen.value = false
    uiStore.setActiveModule('activities')
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

onMounted(() => {
  if (import.meta.env.MODE !== 'test')
    void connectLocalRuntime()
})

async function connectLocalRuntime(): Promise<void> {
  runtimeStore.beginRuntimeLoad()
  try {
    const health = await workbenchRuntime.health()
    const [index, globalView, projectView, status] = await Promise.all([
      workbenchRuntime.projects(),
      workbenchRuntime.global(),
      workbenchRuntime.project(snapshot.project.projectId),
      runtimeStore.refreshMarketingOpsStatus(snapshot.project.projectId),
    ])
    if (health.status === 'ready')
      runtimeStore.markRuntimeReady()
    projectIndex.value = projectIndexProjections(index)
    applyGlobalView(globalView)
    applyProjectView(projectView, status)
  }
  catch (error: unknown) {
    runtimeStore.markRuntimeUnavailable(error)
  }
}

function applyProjectView(
  projectView: Awaited<ReturnType<typeof workbenchRuntime.project>>,
  status: MarketingOpsChannelsStatusSnapshot | null = marketingOpsStatus.value,
): void {
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
    snapshot.channels = projectMarketingOpsChannels(projectChannels({
      bindings: projectView.projectChannelBindings,
      channels: snapshot.channels,
    }), status)
    const runtimeCampaigns = projectView.activities.map(activity => activityToCampaign({
      accountAliasForChannel: projectAccountAliasForChannel,
      activity,
      activityArtifacts: projectView.activityArtifacts,
      captureFlows: projectView.snapshot.manifest.captureFlows,
      channelContentReadiness: projectView.channelContentReadiness,
      channelContents: projectView.channelContents,
      contentGroups: projectView.contentGroups,
      ownerHandoffs: projectView.ownerHandoffs,
      productionTasks: projectView.tasks,
      projectAssets: projectView.projectAssets,
      recordingReceipts: projectView.recordingReceipts,
    }))
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
    snapshot.campaigns = preferRuntimeData(
      runtimeCampaigns,
      snapshot.campaigns,
      runtimeConnected.value,
    )
    runtimeActivityIds.value = new Set(projectView.activities.map(activity => activity.activityId))
    const runtimeTasks = projectView.tasks.map(task => taskToProjection({
      accountAliasForChannel: projectAccountAliasForChannel,
      campaigns: runtimeCampaigns,
      events: projectView.taskEvents[task.taskId] ?? [],
      task,
    }))
    snapshot.tasks = preferRuntimeData(
      runtimeTasks,
      snapshot.tasks,
      runtimeConnected.value,
    )
    snapshot.reports = runtimeReports(projectView)
    syncChannelBindingForm()
    syncVideoPlanViewportDraft()
}

function applyGlobalView(globalView: ContentStudioGlobalView): void {
  globalProjectViews.value = globalView.projectViews
  globalViewLoaded.value = true
  runtimeTaskKeys.value = new Set(globalView.projectViews.flatMap(projectView =>
    projectView.tasks.map(task => `${projectView.project.projectId}:${task.taskId}`),
  ))
}

async function refreshProjectView(): Promise<void> {
  const [index, globalView, projectView, status] = await Promise.all([
    workbenchRuntime.projects(),
    workbenchRuntime.global(),
    workbenchRuntime.project(snapshot.project.projectId),
    runtimeStore.refreshMarketingOpsStatus(snapshot.project.projectId),
  ])
  projectIndex.value = projectIndexProjections(index)
  applyGlobalView(globalView)
  applyProjectView(projectView, status)
}

async function switchProject(projectId: string): Promise<void> {
  if (!runtimeConnected.value || projectId === snapshot.project.projectId)
    return
  try {
    const [projectView, status] = await Promise.all([
      workbenchRuntime.project(projectId),
      runtimeStore.refreshMarketingOpsStatus(projectId),
    ])
    applyProjectView(projectView, status)
    selectedTaskProjectId.value = projectId
    uiStore.selectCampaign(snapshot.campaigns[0]?.campaignId ?? '')
    uiStore.selectTask(snapshot.tasks[0]?.taskId ?? '')
  }
  catch (error: unknown) {
    runtimeStore.markRuntimeUnavailable(error)
  }
}

async function openProjectSpace(projectId: string): Promise<void> {
  await switchProject(projectId)
  selectModule('project')
}
</script>

<template>
  <WorkbenchShell
    :project-id="snapshot.project.projectId"
    :project-name="snapshot.project.name"
    :project-options="projectOptions"
    :route-query-for="routeQueryForModule"
    :runtime-connected="runtimeConnected"
    :runtime-loading="runtimeLoading"
    @navigate="selectModule"
    @switch-project="switchProject"
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
          <span class="connection-pill">{{ runtimeLoading ? '正在连接运行时' : runtimeConnected ? '运行时已连接' : '只读演示' }}</span>
          <button
            v-if="activeModule === 'activities' && runtimeConnected"
            type="button"
            @click="openActivityComposer"
          >
            新建发布活动
          </button>
          <span v-else-if="activeModule === 'activities'" class="workspace-action-status">
            {{ runtimeLoading ? '正在连接运行时' : '运行时未连接，暂不能新建活动' }}
          </span>
        </div>
      </section>

      <template v-if="activeModule === 'overview'">
        <OverviewPage
          :activity-task-summary="activityTaskSummary"
          :campaigns="globalCampaignProjections"
          :owner-handoff-count="globalPendingOwnerHandoffs.length"
          :pending-task-count="globalPendingTaskCount"
          :project-count="projectIndexForView.length"
          :project-index="projectIndexForView"
          :snapshot="snapshot"
          :tasks="globalTaskProjections"
          @go-activities="selectModule('activities')"
          @go-project="selectModule('project')"
          @go-tasks="selectModule('tasks')"
          @open-activity="openGlobalActivity"
          @open-project="openProjectSpace"
          @select-task="selectGlobalTask"
        />
      </template>
      <template v-else-if="activeModule === 'project'">
        <ProjectOverviewPage
          :activity-task-summary="activityTaskSummary"
          :channel-binding-form="channelBindingForm"
          :channel-binding-save-error="channelBindingSaveError"
          :channel-binding-saving="channelBindingSaving"
          :enabled-channels="enabledChannels"
          :project-account-alias="projectAccountAlias"
          :project-account-options="projectAccountOptions"
          :project-accounts="projectAccounts"
          :runtime-connected="runtimeConnected"
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
        :can-publish-content="canPublishContent"
        :enabled-channels="enabledChannels"
        :has-publication-task="hasPublicationTask"
        :media-revision-artifact-ids="mediaRevisionArtifactIds"
        :media-revision-content="mediaRevisionContent"
        :media-revision-error="mediaRevisionError"
        :media-revision-mode="mediaRevisionMode"
        :media-revision-pending="mediaRevisionPending"
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
        :runtime-connected="runtimeConnected"
        :runtime-loading="runtimeLoading"
        :video-format-options="activityVideoFormatOptions"
        :video-plan-action-error="videoPlanActionError"
        :video-plan-action-pending="videoPlanActionPending"
        :video-plan-revision-error="videoPlanRevisionError"
        :video-plan-revision-pending="videoPlanRevisionPending"
        :video-plan-viewport-draft="videoPlanViewportDraft"
        @apply-activity-video-format="applyActivityVideoFormat"
        @close-activity-composer="closeActivityComposer"
        @close-content-composer="closeContentComposer"
        @close-media-revision="closeChannelContentMediaRevision"
        @confirm-video-plan="confirmSelectedVideoPlan"
        @create-publication-plan="createPublicationPlanForContent"
        @open-activity-detail="openActivityDetail"
        @open-content-composer="openContentComposer"
        @open-media-revision="openChannelContentMediaRevision"
        @revise-video-plan="reviseSelectedVideoPlan"
        @save-activity="saveActivity"
        @save-channel-content="saveChannelContent"
        @save-media-revision="saveChannelContentMediaRevision"
        @set-media-revision-mode="setChannelContentMediaRevisionMode"
        @select-task="selectTask"
        @toggle-media-revision-artifact="toggleChannelContentMediaRevisionArtifact"
        @toggle-activity-channel-format="toggleActivityChannelFormat"
        />
      </template>
      <template v-else-if="activeModule === 'tasks' || activeModule === 'project-tasks'">
        <TaskBoardPage
          :active-task-scope="activeTaskScope"
          :can-cancel-selected-task="canCancelSelectedTask"
          :can-confirm-owner-takeover="canConfirmSelectedOwnerTakeover"
          :can-record-selected-task="canRecordSelectedTask"
          :can-retry-selected-task="canRetrySelectedTask"
          :can-start-selected-task="canStartSelectedTask"
          :owner-handoffs="activeTaskScope === '全部项目' ? globalPendingOwnerHandoffs : pendingOwnerHandoffs"
          :project-count="projectIndexForView.length"
          :project-name="snapshot.project.name"
          :runtime-connected="runtimeConnected"
          :runtime-loading="runtimeLoading"
          :selected-task="selectedTask"
          :selected-task-campaign="selectedTaskCampaign"
          :task-action-error="taskActionError"
          :task-action-pending="taskActionPending"
          :task-counts="activeTaskScope === '全部项目' ? globalTaskCounts : taskCounts"
          :visible-tasks="visibleTasks"
          @change-task="changeSelectedTask"
          @go-activities="selectModule('activities')"
          @go-owner="selectModule('owner')"
          @select-task="selectTask"
        />
      </template>
      <template v-else-if="activeModule === 'channels'">
        <ChannelManagementPage
          :account-reference-count="accountReferenceCount"
          :channel-snapshot-count="channelSnapshotCount"
          :marketing-ops-status="marketingOpsStatus"
          :marketing-ops-status-error="marketingOpsStatusError"
          :marketing-ops-status-loading="marketingOpsStatusLoading"
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
          :runtime-connected="runtimeConnected"
          :selected-asset="selectedAsset"
          :snapshot="snapshot"
          :storage-cleanup-armed="storageCleanupArmed"
          :storage-cleanup-error="storageCleanupError"
          :storage-cleanup-pending="storageCleanupPending"
          :storage-cleanup-result="storageCleanupResult"
          :storage-preview="storagePreview"
          :storage-preview-error="storagePreviewError"
          :storage-preview-loading="storagePreviewLoading"
          :storage-preview-open="storagePreviewOpen"
          :storage-recycle-entries="storageRecycleEntries"
          :storage-restore-error="storageRestoreError"
          :storage-restore-pending="storageRestorePending"
          @promote-artifact="promoteActivityArtifact"
          @select-asset="selectAsset"
          @select-artifact="selectArtifact"
          @set-filter="uiStore.setAssetFilter($event)"
          @confirm-cleanup="confirmStorageCleanup"
          @restore-recycle="restoreStorageRecycleEntry"
          @toggle-cleanup-preview="toggleStorageCleanupPreview"
        />
      </template>
      <template v-else-if="activeModule === 'owner'">
        <OwnerInboxPage
          :action-error="ownerHandoffActionError"
          :action-pending="ownerHandoffActionPending"
          :owner-handoffs="ownerHandoffs"
          @abandon-managed-handoff="updateManagedPublicationHandoff($event, 'abandon')"
          @cancel-handoff="updateOwnerHandoff($event, 'cancel')"
          @confirm-managed-handoff="updateManagedPublicationHandoff($event, 'confirm')"
          @complete-handoff="updateOwnerHandoff($event, 'complete')"
          @open-task="openOwnerTask"
          @resume-managed-handoff="updateManagedPublicationHandoff($event, 'resume')"
        />
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
