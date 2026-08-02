<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import StatusRail from './components/StatusRail.vue'
import VideoJobPanel from './components/VideoJobPanel.vue'
import type {
  AssetProjection,
  CampaignProjection,
  WorkbenchSnapshot,
} from './model'
import type {
  ChannelId,
  CreatePublishingActivityInput,
  ExecutionTask,
  ExecutionTaskEvent,
  PublishingActivity,
} from '@content-studio/core-types'
import {
  humanizeActivityStatus,
  humanizeStatus,
  snapshot as snapshotSeed,
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
    description: '管理全局渠道定义，并查看当前项目是否启用。',
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

const globalModules = moduleDefinitions.filter(module => module.group === 'global')
const projectModules = moduleDefinitions.filter(module => module.group === 'project')

const snapshot = reactive(snapshotSeed)
const activeModule = ref<ModuleId>('overview')
const projectPickerOpen = ref(false)
const selectedCampaignId = ref(snapshot.campaigns[0]!.campaignId)
const selectedTaskId = ref(snapshot.tasks[0]!.taskId)
const activeTaskScope = ref<'全部项目' | '当前项目'>('全部项目')
const selectedAssetId = ref(snapshot.projectAssets[0]!.assetId)
const assetFilter = ref<'全部' | AssetProjection['kind']>('全部')
const selectedChannelId = ref(snapshot.channels[0]!.channel)
const selectedChannelAccountId = ref(snapshot.channels[0]!.defaultAccountId)
const runtimeError = ref<string | null>(null)
const workbenchRuntime = createWorkbenchRuntime()
const currentSnapshotId = ref(`${snapshot.project.projectId}-snapshot-1`)
const activityComposerOpen = ref(false)
const activitySaving = ref(false)
const activitySaveError = ref<string | null>(null)
const runtimeTaskIds = ref<Set<string>>(new Set())
const taskActionError = ref<string | null>(null)
const taskActionPending = ref<'cancel' | 'retry' | null>(null)
const activityForm = reactive<{
  channel: ChannelId
  topic: string
}>({
  channel: 'github',
  topic: '',
})

const currentModule = computed(() =>
  moduleDefinitions.find(module => module.id === activeModule.value)
  ?? moduleDefinitions[0]!,
)

const selectedCampaign = computed(() =>
  snapshot.campaigns.find(
    campaign => campaign.campaignId === selectedCampaignId.value,
  ) ?? snapshot.campaigns[0]!,
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

const canRetrySelectedTask = computed(() =>
  selectedTaskIsRuntime.value
  && snapshot.runtimeConnected
  && ['cancelled', 'failed'].includes(selectedTask.value.status),
)

const selectedAsset = computed(() =>
  snapshot.projectAssets.find(asset => asset.assetId === selectedAssetId.value)
  ?? snapshot.projectAssets[0]!,
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

const selectedChannelAccount = computed(() =>
  selectedChannel.value.accounts.find(account => account.accountId === selectedChannelAccountId.value)
  ?? selectedChannel.value.accounts.find(account => account.isDefault)
  ?? selectedChannel.value.accounts[0]
  ?? null,
)

const projectAccounts = computed(() =>
  snapshot.channels.flatMap(channel => channel.accounts),
)

const selectedCampaignContentCounts = computed(() => {
  const contents = selectedCampaign.value.contentGroups.flatMap(group => group.contents)
  return {
    article: contents.filter(content => content.format === '文章').length,
    video: contents.filter(content => content.format === '视频').length,
  }
})

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

function selectModule(moduleId: ModuleId): void {
  activeModule.value = moduleId
  if (moduleId === 'tasks') {
    activeTaskScope.value = '全部项目'
  }
  if (moduleId === 'project-tasks') {
    activeTaskScope.value = '当前项目'
  }
}

function toggleProjectPicker(): void {
  projectPickerOpen.value = !projectPickerOpen.value
}

function selectCampaign(campaignId: string): void {
  selectedCampaignId.value = campaignId
  activeModule.value = 'activities'
}

function selectTask(taskId: string): void {
  selectedTaskId.value = taskId
  activeModule.value = 'tasks'
}

function selectAsset(assetId: string): void {
  selectedAssetId.value = assetId
}

function selectArtifact(activityId: string): void {
  selectCampaign(activityId)
}

function setTaskScope(scope: '全部项目' | '当前项目'): void {
  activeTaskScope.value = scope
}

async function cancelSelectedTask(): Promise<void> {
  await changeSelectedTask('cancel')
}

async function retrySelectedTask(): Promise<void> {
  await changeSelectedTask('retry')
}

async function changeSelectedTask(action: 'cancel' | 'retry'): Promise<void> {
  if (taskActionPending.value !== null || !selectedTaskIsRuntime.value)
    return
  taskActionPending.value = action
  taskActionError.value = null
  try {
    if (action === 'cancel')
      await workbenchRuntime.cancelTask(snapshot.project.projectId, selectedTask.value.taskId)
    else
      await workbenchRuntime.retryTask(snapshot.project.projectId, selectedTask.value.taskId)
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
  selectedChannelAccountId.value = snapshot.channels.find(channel => channel.channel === channelId)?.defaultAccountId ?? null
}

function selectChannelAccount(accountId: string): void {
  selectedChannelAccountId.value = accountId
}

function openActivityComposer(): void {
  activityForm.channel = enabledChannels.value[0]?.channel ?? 'github'
  activityForm.topic = ''
  activitySaveError.value = null
  activityComposerOpen.value = true
}

function closeActivityComposer(): void {
  if (!activitySaving.value)
    activityComposerOpen.value = false
}

async function saveActivity(): Promise<void> {
  if (!snapshot.runtimeConnected || activityForm.topic.trim() === '')
    return
  activitySaving.value = true
  activitySaveError.value = null
  const activityId = `activity-${Date.now()}`
  const input: CreatePublishingActivityInput = {
    activityId,
    campaignId: activityId,
    channels: [{ id: activityForm.channel, locale: 'zh-CN' }],
    goal: 'education',
    projectId: snapshot.project.projectId,
    projectSnapshotId: currentSnapshotId.value,
    status: 'draft',
    targetUrl: snapshot.project.canonicalUrl,
    topic: {
      'en': activityForm.topic,
      'zh-CN': activityForm.topic,
    },
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

function activityToCampaign(activity: PublishingActivity): CampaignProjection {
  const topic = activity.topic['zh-CN'] ?? activity.topic.en
  return {
    activityArtifacts: [],
    activityStatus: activity.status === 'active'
      ? '进行中'
      : activity.status === 'planned'
        ? '已规划'
        : activity.status === 'completed'
          ? '已完成'
          : activity.status === 'archived'
            ? '已归档'
            : '草稿',
    assets: 0,
    campaignId: activity.activityId,
    channels: activity.channels.map(channel => channel.id),
    contentGroups: [],
    executionStatus: 'queued',
    handoffs: [],
    nextAction: '等待 AI 生成内容和拍摄大纲。',
    referencedAssets: [],
    title: topic,
    topic,
    videoJob: null,
  }
}

function taskToProjection(
  task: ExecutionTask,
  events: ExecutionTaskEvent[] = [],
): WorkbenchSnapshot['tasks'][number] {
  const campaign = snapshot.campaigns.find(candidate => candidate.campaignId === task.activityId)
  const channel = campaign?.channels[0] ?? 'github'
  const account = snapshot.channels.find(candidate => candidate.channel === channel)?.alias
    ?? '未绑定账号'
  const activityTitle = campaign?.title ?? task.activityId
  const contentTitle = campaign?.contentGroups[0]?.contents[0]?.title ?? '等待 AI 生成内容'
  const statusLabel = humanizeStatus(task.status)
  return {
    accountAlias: account,
    activityId: task.activityId,
    activityTitle,
    attempt: task.attempt,
    channel,
    contentTitle,
    detail: task.status === 'queued'
      ? '任务已创建，等待 AI 生成内容和拍摄大纲。'
      : `当前阶段：${statusLabel}`,
    events: events.map(event => ({
      kind: event.kind,
      message: event.message,
      sequence: event.sequence,
    })),
    kind: task.kind === 'production'
      ? '制作'
      : task.kind === 'publication'
        ? '发布'
        : '监测',
    status: task.status,
    steps: [
      {
        detail: task.status === 'queued' ? '尚未开始' : '已进入执行记录',
        label: '准备活动内容',
        status: task.status === 'queued' ? 'active' : 'done',
      },
      {
        detail: task.status === 'queued' ? '等待前一步完成' : '等待后续应用服务接入',
        label: '执行制作阶段',
        status: task.status === 'queued' ? 'pending' : 'active',
      },
    ],
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
    const enabledChannels = new Set(
      projectView.projectChannelBindings
        .filter(binding => binding.enabled)
        .map(binding => binding.channel),
    )
    snapshot.channels.forEach((channel) => {
      channel.enabled = enabledChannels.has(channel.channel)
    })
    const runtimeCampaigns = projectView.activities.map(activityToCampaign)
    snapshot.campaigns = [
      ...runtimeCampaigns,
      ...snapshot.campaigns.filter(campaign =>
        !runtimeCampaigns.some(runtimeCampaign =>
          runtimeCampaign.campaignId === campaign.campaignId,
        ),
      ),
    ]
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
}

async function refreshProjectView(): Promise<void> {
  applyProjectView(await workbenchRuntime.project(snapshot.project.projectId))
}
</script>

<template>
  <div
    class="workbench-shell"
    data-testid="workbench-shell"
  >
    <aside class="sidebar">
      <a
        class="brand"
        href="#overview"
        aria-label="Content Studio 首页"
        @click="selectModule('overview')"
      >
        <span class="brand-mark">CS</span>
        <span>
          Content Studio
          <small>内容生产控制面</small>
        </span>
      </a>

      <nav
        data-testid="module-nav"
        aria-label="全局控制台"
      >
        <p>全局控制台</p>
        <button
          v-for="(module, index) in globalModules"
          :key="module.id"
          type="button"
          :data-module="module.id"
          :class="{ active: module.id === activeModule }"
          @click="selectModule(module.id)"
        >
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          {{ module.id === 'tasks' ? '任务面板' : module.label.replace('项目', '') }}
        </button>
      </nav>

      <nav
        class="project-nav"
        aria-label="当前项目"
      >
        <p>当前项目</p>
        <button
          v-for="(module, index) in projectModules"
          :key="`${module.id}-project`"
          type="button"
          :data-module="module.id"
          :class="{ active: module.id === activeModule }"
          @click="selectModule(module.id)"
        >
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          {{ module.label }}
        </button>
      </nav>

      <div class="boundary-note">
        <p class="eyebrow">
          安全边界
        </p>
        <strong>本地负责生产，<br>发布交给授权流程。</strong>
        <p>
          真实渠道写入仍需要独立的
          <code>marketing-ops</code> 授权回执。
        </p>
      </div>
    </aside>

    <main id="overview">
      <header class="topbar">
        <div>
          <span class="live-dot" />
          本地控制面 · {{ snapshot.runtimeConnected ? '实时数据' : '演示数据' }}
        </div>
        <div class="project-control">
          <button
            type="button"
            class="project-switcher"
            aria-label="切换项目"
            aria-haspopup="listbox"
            :aria-expanded="projectPickerOpen"
            @click="toggleProjectPicker"
          >
            <span class="project-switcher-label">当前项目</span>
            <strong>{{ snapshot.project.name }}</strong>
            <span class="project-switcher-chevron" aria-hidden="true">⌄</span>
          </button>
          <div
            v-if="projectPickerOpen"
            class="project-menu"
            data-testid="project-menu"
            role="listbox"
            aria-label="项目列表"
          >
            <p class="project-menu-label">切换项目</p>
            <button
              type="button"
              class="project-option active"
              role="option"
              aria-selected="true"
              disabled
            >
              <span>
                <strong>{{ snapshot.project.name }}</strong>
                <small>{{ snapshot.project.projectId }}</small>
              </span>
              <em>当前</em>
            </button>
            <p class="project-menu-empty">暂无其他已注册项目</p>
          </div>
        </div>
      </header>

      <p v-if="runtimeError" class="runtime-connection-note">
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
        <section class="overview-stats" aria-label="项目概览">
          <div class="overview-stat overview-stat-primary">
            <span>待处理任务</span>
            <strong>{{ pendingTaskCount }}</strong>
            <small>制作、发布、监测</small>
          </div>
          <div class="overview-stat">
            <span>等待人工</span>
            <strong>{{ ownerHandoffs.length }}</strong>
            <small>需要项目负责人确认</small>
          </div>
          <div class="overview-stat">
            <span>项目渠道</span>
            <strong>{{ enabledChannels.length }}</strong>
            <small>全局渠道中已启用</small>
          </div>
          <div class="overview-stat">
            <span>素材占用</span>
            <strong>{{ snapshot.storage.projectSize }}</strong>
            <small>临时产物可回收</small>
          </div>
        </section>

        <section class="overview-grid">
          <article class="module-card">
            <div class="module-card-heading">
              <div>
                <p class="eyebrow">发布活动</p>
                <h2>最近活动</h2>
              </div>
              <button type="button" @click="selectModule('activities')">查看全部</button>
            </div>
            <div class="module-list">
              <button
                v-for="campaign in snapshot.campaigns"
                :key="campaign.campaignId"
                type="button"
                :data-campaign-id="campaign.campaignId"
                @click="selectCampaign(campaign.campaignId)"
              >
                <span class="list-status">{{ humanizeActivityStatus(campaign.activityStatus) }} · {{ humanizeStatus(campaign.executionStatus) }}</span>
                <strong>{{ campaign.title }}</strong>
                <small>{{ campaign.channels.length }} 个渠道 · {{ campaign.activityArtifacts.length }} 个活动产物</small>
              </button>
            </div>
          </article>

          <article class="module-card">
            <div class="module-card-heading">
              <div>
                <p class="eyebrow">执行层投影</p>
                <h2>待处理任务</h2>
              </div>
              <button type="button" @click="selectModule('tasks')">打开面板</button>
            </div>
            <div class="module-list">
              <button
                v-for="task in snapshot.tasks"
                :key="task.taskId"
                type="button"
                @click="selectTask(task.taskId)"
              >
                <span class="list-status">{{ task.kind }} · {{ humanizeStatus(task.status) }}</span>
                <strong>{{ task.title }}</strong>
                <small>{{ task.activityTitle }} · {{ task.contentTitle }} · {{ task.channel }} · {{ task.accountAlias }}<br>{{ task.detail }}</small>
              </button>
            </div>
          </article>
        </section>

        <section class="overview-grid">
          <article class="module-card project-context-card">
            <div class="module-card-heading">
              <div>
                <p class="eyebrow">项目空间</p>
                <h2>{{ snapshot.project.name }}</h2>
              </div>
              <code>{{ snapshot.project.projectId }}</code>
            </div>
            <dl class="context-list">
              <div>
                <dt>项目事实</dt>
                <dd>{{ snapshot.project.version }}</dd>
              </div>
              <div>
                <dt>已启用渠道</dt>
                <dd>{{ enabledChannels.length }} 个</dd>
              </div>
              <div>
                <dt>预览环境</dt>
                <dd class="ready">{{ snapshot.project.previewReady ? '可用' : '不可用' }}</dd>
              </div>
              <div>
                <dt>项目语言</dt>
                <dd>{{ snapshot.project.locales.join(' / ') }}</dd>
              </div>
            </dl>
          </article>

          <article class="module-card">
            <div class="module-card-heading">
              <div>
                <p class="eyebrow">本地运行时</p>
                <h2>{{ snapshot.runtimeConnected ? '已连接' : '未连接' }}</h2>
              </div>
              <span class="status-chip" :data-connected="snapshot.runtimeConnected">
                {{ snapshot.runtimeConnected ? '可执行' : '只读' }}
              </span>
            </div>
            <ul class="runtime-checks">
              <li><span>项目数据与任务</span><strong>已加载</strong></li>
              <li><span>Playwright 录制器</span><strong>已安装</strong></li>
              <li><span>发布运行时</span><strong>等待授权</strong></li>
            </ul>
          </article>
        </section>
      </template>

      <template v-else-if="activeModule === 'project'">
        <section id="project" class="module-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">项目空间 / 当前项目</p>
              <h2>{{ snapshot.project.name }}</h2>
            </div>
            <span><code>{{ snapshot.project.projectId }}</code> · {{ snapshot.project.version }}</span>
          </div>
          <p class="section-intro">项目是事实、渠道开关、制作方式、项目素材和发布活动的归属边界。全局渠道只提供能力定义，活动只能选择这里已经启用的渠道。</p>

          <div class="project-overview-grid">
            <article class="module-card project-profile-card">
              <div class="module-card-heading">
                <div><p class="eyebrow">接入方式</p><h3>{{ snapshot.project.integrationMode }}</h3></div>
                <span class="status-chip" data-connected="true">{{ snapshot.project.recordingMode }}</span>
              </div>
              <dl class="context-list">
                <div><dt>项目事实</dt><dd>{{ snapshot.project.version }}</dd></div>
                <div><dt>预览环境</dt><dd class="ready">{{ snapshot.project.previewReady ? '可用' : '不可用' }}</dd></div>
                <div><dt>项目语言</dt><dd>{{ snapshot.project.locales.join(' / ') }}</dd></div>
                <div><dt>运行时</dt><dd>{{ snapshot.runtimeConnected ? '已连接' : '未连接（只读演示）' }}</dd></div>
              </dl>
            </article>
            <article class="module-card">
              <div class="module-card-heading"><div><p class="eyebrow">项目事实摘要</p><h3>录制前先确认这些信息</h3></div><span>只读</span></div>
              <ul class="fact-list"><li v-for="fact in snapshot.project.facts" :key="fact">{{ fact }}</li></ul>
            </article>
          </div>

          <div class="project-overview-grid project-overview-grid-lower">
            <article class="module-card">
              <div class="module-card-heading"><div><p class="eyebrow">项目配置投影</p><h3>渠道和素材</h3></div><button type="button" @click="selectModule('channels')">查看渠道</button></div>
              <div class="project-summary-lines">
                <div><span>已启用渠道</span><strong>{{ enabledChannels.length }} / {{ snapshot.channelBlueprintCount }}</strong></div>
                <div><span>账号绑定</span><strong>{{ projectAccounts.length }} 个</strong></div>
                <div><span>项目素材</span><strong>{{ snapshot.projectAssets.length }} 个</strong></div>
                <div><span>活动产物</span><strong>{{ snapshot.activityArtifacts.length }} 个</strong></div>
                <div><span>保留策略</span><strong>{{ snapshot.storage.retention }}</strong></div>
              </div>
              <div class="project-account-chip-list">
                <span v-for="account in projectAccounts" :key="account.accountId"><strong>{{ account.alias }}</strong><small>{{ account.channel }}{{ account.isDefault ? ' · 默认' : '' }}</small></span>
              </div>
            </article>
            <article class="module-card">
              <div class="module-card-heading"><div><p class="eyebrow">发布活动</p><h3>{{ snapshot.campaigns.length }} 个主题</h3></div><button type="button" @click="selectModule('activities')">进入活动</button></div>
              <div class="module-list compact-list">
                <button v-for="campaign in snapshot.campaigns" :key="campaign.campaignId" type="button" @click="selectCampaign(campaign.campaignId)">
                  <span class="list-status">{{ humanizeActivityStatus(campaign.activityStatus) }} · {{ humanizeStatus(campaign.executionStatus) }}</span>
                  <strong>{{ campaign.title }}</strong>
                  <small>{{ campaign.topic }}</small>
                </button>
              </div>
            </article>
          </div>
        </section>
      </template>

      <template v-else-if="activeModule === 'activities'">
        <section id="activities" class="module-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">项目业务对象</p>
              <h2>发布活动</h2>
            </div>
            <span>{{ snapshot.campaigns.length }} 个活动</span>
          </div>
          <p class="section-intro">活动围绕一次主题组织内容组、渠道内容、活动产物和发布安排，执行任务会从这里投影出去。</p>

          <form v-if="activityComposerOpen" class="activity-composer" @submit.prevent="saveActivity">
            <div class="section-heading">
              <div><p class="eyebrow">本地应用服务</p><h3>新建发布活动</h3></div>
              <span>先保存业务对象，AI 内容生成随后接入</span>
            </div>
            <div class="activity-composer-grid">
              <label>
                活动主题
                <input v-model="activityForm.topic" required placeholder="例如：用动画理解快速排序的分区过程" />
              </label>
              <label>
                首个目标渠道
                <select v-model="activityForm.channel">
                  <option v-for="channel in enabledChannels" :key="channel.channel" :value="channel.channel">
                    {{ channel.channel }}
                  </option>
                </select>
              </label>
            </div>
            <p v-if="activitySaveError" class="form-error">{{ activitySaveError }}</p>
            <div class="form-actions">
              <button type="button" @click="closeActivityComposer">取消</button>
              <button type="submit" class="primary-button" :disabled="activitySaving">
                {{ activitySaving ? '保存中…' : '保存发布活动' }}
              </button>
            </div>
          </form>

          <div class="campaign-board">
            <div class="campaign-list" role="list" aria-label="发布活动">
              <button
                v-for="campaign in snapshot.campaigns"
                :key="campaign.campaignId"
                type="button"
                :data-campaign-id="campaign.campaignId"
                :class="{ selected: campaign.campaignId === selectedCampaign.campaignId }"
                @click="selectedCampaignId = campaign.campaignId"
              >
                <span class="campaign-status" :data-status="campaign.executionStatus">{{ humanizeActivityStatus(campaign.activityStatus) }}</span>
                <strong>{{ campaign.title }}</strong>
                <small>{{ campaign.channels.length }} 个渠道 · {{ campaign.activityArtifacts.length }} 个活动产物</small>
                <span class="arrow">↗</span>
              </button>
            </div>

            <article class="campaign-detail">
              <div class="detail-heading">
                <div>
                  <p class="eyebrow">当前活动</p>
                  <h2 data-testid="selected-campaign-title">{{ selectedCampaign.title }}</h2>
                </div>
                <span class="asset-count">{{ selectedCampaign.activityArtifacts.length }} 个活动产物</span>
              </div>
              <div class="activity-status-line">
                <span class="task-status">{{ humanizeActivityStatus(selectedCampaign.activityStatus) }}</span>
                <span class="activity-topic">{{ selectedCampaign.topic }}</span>
              </div>
              <StatusRail :status="selectedCampaign.executionStatus" />
              <div class="content-type-grid">
                <div><span>文章内容</span><strong>{{ selectedCampaignContentCounts.article }}</strong><small>按渠道分别生成</small></div>
                <div><span>视频内容</span><strong>{{ selectedCampaignContentCounts.video }}</strong><small>资源变体待制作</small></div>
                <div><span>渠道</span><strong>{{ selectedCampaign.channels.length }}</strong><small>项目已启用范围内</small></div>
              </div>
              <div class="detail-footer">
                <div><span>下一步</span><p>{{ selectedCampaign.nextAction }}</p></div>
                <ul aria-label="活动渠道">
                  <li v-for="channel in selectedCampaign.channels" :key="channel">{{ channel }}</li>
                </ul>
              </div>
              <div class="activity-detail-grid">
                <div>
                  <p class="eyebrow">内容组与渠道内容</p>
                  <div class="content-group-list">
                    <article v-for="group in selectedCampaign.contentGroups" :key="group.contentGroupId" class="content-group-card">
                      <strong>{{ group.title }}</strong>
                      <small>{{ group.coreMessage }}</small>
                      <ul>
                        <li v-for="content in group.contents" :key="content.contentId">
                          <span>{{ content.format }} · {{ content.channel }} · {{ content.accountAlias ?? '待绑定账号' }}</span>
                          <strong>{{ content.title }}</strong>
                          <small>{{ content.locale }} · {{ content.status }}</small>
                        </li>
                      </ul>
                    </article>
                  </div>
                </div>
                <div>
                  <p class="eyebrow">关联执行任务</p>
                  <div class="related-task-list">
                    <button v-for="task in selectedCampaignTasks" :key="task.taskId" type="button" @click="selectTask(task.taskId)">
                      <span>{{ task.kind }} · {{ humanizeStatus(task.status) }}</span>
                      <strong>{{ task.title }}</strong>
                      <small>{{ task.contentTitle }} · {{ task.channel }} · {{ task.accountAlias }}</small>
                    </button>
                  </div>
                </div>
              </div>
              <div class="activity-artifacts-row">
                <div>
                  <p class="eyebrow">引用的项目素材</p>
                  <div class="chip-list">
                    <span v-for="assetId in selectedCampaign.referencedAssets" :key="assetId">{{ snapshot.projectAssets.find(asset => asset.assetId === assetId)?.name ?? assetId }}</span>
                  </div>
                </div>
                <div>
                  <p class="eyebrow">活动产物</p>
                  <div class="chip-list">
                    <span v-for="artifact in selectedCampaign.activityArtifacts" :key="artifact.artifactId">{{ artifact.name }} · {{ artifact.status }}</span>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </template>

      <template v-else-if="activeModule === 'tasks' || activeModule === 'project-tasks'">
        <section id="tasks" class="module-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">执行层投影</p>
              <h2>{{ activeTaskScope === '全部项目' ? '全局任务面板' : '项目任务面板' }}</h2>
            </div>
            <span>全局与项目共用同一份执行记录</span>
          </div>
          <p class="section-intro">制作、发布、监测是执行任务，不是发布活动里的业务对象。取消和重试最终由本地运行时执行。</p>
          <div class="task-scope-switch" role="tablist" aria-label="任务范围">
            <button type="button" :class="{ active: activeTaskScope === '全部项目' }" @click="setTaskScope('全部项目')">全部项目</button>
            <button type="button" :class="{ active: activeTaskScope === '当前项目' }" @click="setTaskScope('当前项目')">当前项目 · {{ snapshot.project.name }}</button>
          </div>
          <div class="task-summary">
            <div v-for="(count, kind) in taskCounts" :key="kind" class="task-summary-card">
              <span>{{ kind }}任务</span><strong>{{ count }}</strong>
            </div>
          </div>
          <div class="task-board">
            <div class="task-list" role="list" aria-label="执行任务">
              <button
                v-for="task in visibleTasks"
                :key="task.taskId"
                type="button"
                :data-task-id="task.taskId"
                :class="{ selected: task.taskId === selectedTask.taskId }"
                @click="selectedTaskId = task.taskId"
              >
                <span class="task-kind">{{ task.kind }}</span>
                <strong>{{ task.title }}</strong>
                <small>{{ task.activityTitle }} · {{ task.contentTitle }}</small>
                <small>{{ task.channel }} · {{ task.accountAlias }} · {{ humanizeStatus(task.status) }} · 第 {{ task.attempt }} 次尝试</small>
              </button>
            </div>
            <article class="task-detail">
              <div class="detail-heading">
                <div><p class="eyebrow">选中任务 · {{ selectedTask.kind }}</p><h3>{{ selectedTask.title }}</h3></div>
                <span class="task-status" :data-status="selectedTask.status">{{ humanizeStatus(selectedTask.status) }}</span>
              </div>
              <p class="task-detail-context">{{ selectedTask.activityTitle }} → {{ selectedTask.contentTitle }} → {{ selectedTask.channel }} → {{ selectedTask.accountAlias }}</p>
              <p class="task-detail-copy">{{ selectedTask.detail }}</p>
              <div v-if="selectedTask.progress !== undefined" class="progress-track"><span :style="{ width: `${selectedTask.progress}%` }" /></div>
              <ol class="task-step-list" aria-label="任务步骤">
                <li v-for="step in selectedTask.steps" :key="step.label" :data-step-status="step.status">
                  <span class="step-marker" />
                  <div><strong>{{ step.label }}</strong><small>{{ step.detail }}</small></div>
                </li>
              </ol>
              <div class="task-detail-meta">
                <span>任务编号 <code>{{ selectedTask.taskId }}</code></span>
                <span>所属活动 <code>{{ selectedTask.activityId }}</code></span>
              </div>
              <div v-if="selectedTask.events.length > 0" class="task-events">
                <p class="eyebrow">运行事件</p>
                <ol>
                  <li v-for="event in selectedTask.events" :key="`${selectedTask.taskId}-${event.sequence}`">
                    <span>第 {{ event.sequence }} 条 · {{ event.kind }}</span>
                    <small>{{ event.message }}</small>
                  </li>
                </ol>
              </div>
              <div v-if="selectedTask.status === 'awaiting-owner'" class="task-handoff-inline">
                <div><p class="eyebrow">需要人工介入</p><strong>{{ selectedTaskCampaign.handoffs[0]?.reason ?? '请完成官方页面确认' }}</strong></div>
                <span>不会保存凭据</span>
              </div>
              <div class="job-actions">
                <p class="runtime-status">
                  <span v-if="taskActionError" class="task-action-error">{{ taskActionError }}</span>
                  <span v-else-if="!selectedTaskIsRuntime">演示任务不可操作</span>
                  <span v-else>操作会写入本地任务事件，不会触发渠道发布</span>
                </p>
                <div>
                  <button
                    type="button"
                    :disabled="!canCancelSelectedTask || taskActionPending !== null"
                    @click="cancelSelectedTask"
                  >
                    {{ taskActionPending === 'cancel' ? '取消中…' : '取消当前尝试' }}
                  </button>
                  <button
                    type="button"
                    class="primary-button"
                    :disabled="!canRetrySelectedTask || taskActionPending !== null"
                    @click="retrySelectedTask"
                  >
                    {{ taskActionPending === 'retry' ? '重试中…' : '新建重试尝试' }}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </section>
        <VideoJobPanel
          v-if="selectedTaskCampaign.videoJob !== null"
          id="video"
          :job="selectedTaskCampaign.videoJob"
          :runtime-connected="snapshot.runtimeConnected"
        />
      </template>

      <template v-else-if="activeModule === 'channels'">
        <section id="channels" class="module-section">
          <div class="section-heading">
            <div><p class="eyebrow">全局控制台 / 发布助手状态</p><h2>渠道管理</h2></div>
            <span>{{ snapshot.channelBlueprintCount }} 个全局规格 · {{ channelSnapshotCount }} 个状态快照</span>
          </div>
          <p class="section-intro">全局目录定义平台能力；项目选择是否启用并绑定具体账号。右侧状态来自 marketing-ops 的只读渠道检查，健康不等于拥有发布权限。</p>
          <div class="channel-overview-grid">
            <div class="channel-overview-card"><span>全局规格</span><strong>{{ snapshot.channelBlueprintCount }}</strong><small>文章、短帖和视频信息</small></div>
            <div class="channel-overview-card"><span>项目已启用</span><strong>{{ enabledChannels.length }}</strong><small>活动只能选择这些渠道</small></div>
            <div class="channel-overview-card"><span>可自动候选</span><strong>{{ snapshot.channels.filter(channel => channel.adapterReady).length }}</strong><small>仍需匹配授权和策略</small></div>
            <div class="channel-overview-card"><span>需要处理</span><strong>{{ snapshot.channels.filter(channel => channel.health !== '已就绪').length }}</strong><small>重新授权、阻塞或尚未查询</small></div>
          </div>
          <div class="channel-table" role="table" aria-label="渠道目录">
            <div class="channel-row channel-row-heading" role="row"><span>渠道</span><span>项目状态</span><span>项目账号</span><span>交付和格式</span><span>发布助手状态</span><span>规格</span></div>
            <button v-for="channel in snapshot.channels" :key="channel.channel" type="button" class="channel-row" :data-channel-id="channel.channel" :class="{ selected: channel.channel === selectedChannel.channel }" role="row" @click="selectChannel(channel.channel)">
              <strong>{{ channel.channel }}</strong>
              <span :class="channel.enabled ? 'ready' : 'muted-value'">{{ channel.enabled ? '项目已启用' : '项目未启用' }}</span>
              <span>{{ channel.accounts.length > 0 ? channel.accounts.map(account => account.alias).join('、') : '未绑定账号' }}</span>
              <span>{{ channel.delivery }} · {{ channel.format }}</span>
              <span class="channel-health" :data-health="channel.health">{{ channel.health }}</span>
              <small>{{ channel.titleLimit }} 字标题 · {{ channel.bodyLimit }} 字正文</small>
            </button>
          </div>
          <article class="channel-detail-card">
            <div class="detail-heading">
              <div><p class="eyebrow">选中渠道 · {{ selectedChannel.channel }}</p><h3>{{ selectedChannelAccount?.alias ?? selectedChannel.alias ?? '未配置账号别名' }}</h3></div>
              <span class="channel-health" :data-health="selectedChannelAccount?.health ?? selectedChannel.health">{{ selectedChannelAccount?.health ?? selectedChannel.health }}</span>
            </div>
            <div class="channel-account-panel">
              <div class="channel-account-panel-heading"><div><p class="eyebrow">项目账号</p><strong>{{ selectedChannel.accounts.length }} 个账号绑定</strong></div><small>活动只能使用这里的账号</small></div>
              <div v-if="selectedChannel.accounts.length > 0" class="channel-account-list">
                <button v-for="account in selectedChannel.accounts" :key="account.accountId" type="button" :data-channel-account-id="account.accountId" :class="{ selected: account.accountId === selectedChannelAccount?.accountId }" @click="selectChannelAccount(account.accountId)">
                  <strong>{{ account.alias }}</strong>
                  <span>{{ account.isDefault ? '项目默认账号' : '项目可选账号' }} · {{ account.health }}</span>
                </button>
              </div>
              <p v-else class="empty-channel-accounts">当前项目还没有绑定账号。</p>
              <div v-if="selectedChannelAccount" class="channel-account-detail">
                <span>账号状态来源</span><strong>{{ selectedChannelAccount.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '项目配置（尚未查询）' }}</strong>
                <span>适配器</span><strong>{{ selectedChannelAccount.adapterReady ? '已就绪' : '未就绪' }}</strong>
                <span>下一步</span><strong>{{ selectedChannelAccount.nextAction ?? '保持状态快照' }}</strong>
              </div>
            </div>
            <div class="channel-detail-grid">
              <div><span>项目策略</span><strong>{{ selectedChannel.enabled ? '允许作为活动目标' : '未启用' }}</strong></div>
              <div><span>可监测指标</span><strong>{{ selectedChannel.metrics.join('、') }}</strong></div>
              <div><span>下一步</span><strong>{{ selectedChannelAccount?.nextAction ?? selectedChannel.nextAction ?? '保持渠道状态快照' }}</strong></div>
            </div>
            <p class="channel-boundary-note">状态来源：{{ selectedChannelAccount?.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '项目配置（尚未读取渠道快照）' }}。这里只展示能力和状态，不保存凭据，也不会因为“已就绪”自动获得发布权限。</p>
          </article>
        </section>
      </template>

      <template v-else-if="activeModule === 'assets'">
        <section id="assets" class="module-section">
          <div class="section-heading">
            <div><p class="eyebrow">项目空间 / 可复用素材</p><h2>项目素材库</h2></div>
            <span>{{ snapshot.projectAssets.length }} 个项目素材 · {{ snapshot.activityArtifacts.length }} 个活动产物</span>
          </div>
          <p class="section-intro">这里管理真正属于项目的文件。活动只引用这些素材；活动生成的文章、图片、预览帧和视频默认留在活动产物中。</p>
          <div class="storage-grid">
            <div class="storage-card storage-card-highlight"><span>项目素材</span><strong>{{ snapshot.projectAssets.length }} 个</strong><small>Logo、模板、字体和品牌素材</small></div>
            <div class="storage-card"><span>活动产物</span><strong>{{ snapshot.activityArtifacts.length }} 个</strong><small>文章、预览帧、片段和资源变体</small></div>
            <div class="storage-card"><span>占用空间</span><strong>{{ snapshot.storage.projectSize }}</strong><small>其中缓存 {{ snapshot.storage.cacheSize }}</small></div>
          </div>
          <div class="asset-filter-bar" role="tablist" aria-label="素材类型">
            <button type="button" :class="{ active: assetFilter === '全部' }" @click="assetFilter = '全部'">全部</button>
            <button type="button" :class="{ active: assetFilter === 'logo' }" @click="assetFilter = 'logo'">Logo</button>
            <button type="button" :class="{ active: assetFilter === 'font' }" @click="assetFilter = 'font'">字体</button>
            <button type="button" data-asset-filter="template" :class="{ active: assetFilter === 'template' }" @click="assetFilter = 'template'">模板</button>
            <button type="button" :class="{ active: assetFilter === 'image' }" @click="assetFilter = 'image'">图片</button>
          </div>
          <div class="asset-library-layout">
            <div class="asset-list" role="list" aria-label="项目素材列表">
              <button v-for="asset in filteredAssets" :key="asset.assetId" type="button" :data-asset-id="asset.assetId" :class="{ selected: asset.assetId === selectedAsset.assetId }" @click="selectAsset(asset.assetId)">
                <span class="asset-kind">{{ asset.kind }}</span>
                <strong>{{ asset.name }}</strong>
                <small>{{ asset.version }} · {{ asset.size }} · {{ asset.source }}</small>
              </button>
            </div>
            <article class="asset-detail-card">
              <div class="detail-heading"><div><p class="eyebrow">选中项目素材</p><h3>{{ selectedAsset.name }}</h3></div><span class="asset-count">{{ selectedAsset.version }}</span></div>
              <dl class="asset-detail-list">
                <div><dt>类型</dt><dd>{{ selectedAsset.kind }}</dd></div>
                <div><dt>大小</dt><dd>{{ selectedAsset.size }}</dd></div>
                <div><dt>来源</dt><dd>{{ selectedAsset.source }}</dd></div>
                <div><dt>保留策略</dt><dd>{{ selectedAsset.retention }}</dd></div>
              </dl>
              <p class="eyebrow">被这些活动引用</p>
              <div class="chip-list"><span v-for="activity in selectedAsset.referencedBy" :key="activity">{{ activity }}</span></div>
              <button type="button" disabled>编辑素材（等待应用服务）</button>
            </article>
          </div>
          <div class="activity-artifact-panel">
            <div class="section-heading"><div><p class="eyebrow">活动产物</p><h3>本次活动生成的文件</h3></div><span>需要用户明确保存才会进入项目素材库</span></div>
            <div class="artifact-list"><button v-for="artifact in snapshot.activityArtifacts" :key="artifact.artifactId" type="button" @click="selectArtifact(artifact.activityId)"><strong>{{ artifact.name }}</strong><span>{{ artifact.kind }} · {{ artifact.size }} · {{ artifact.status }}</span></button></div>
          </div>
          <div class="retention-note"><span>当前保留规则</span><strong>{{ snapshot.storage.retention }}</strong><button type="button" disabled>查看清理预览</button></div>
        </section>
      </template>

      <template v-else-if="activeModule === 'owner'">
        <section id="owner-inbox" class="module-section">
          <div class="section-heading">
            <div><p class="eyebrow">执行中的人工介入</p><h2>待人工处理</h2></div>
            <span>{{ ownerHandoffs.length }} 个待处理</span>
          </div>
          <p class="section-intro">这不是独立的业务对象，而是任务进入“等待人工”后的处理清单。系统只准备审查包，不保存登录信息。</p>
          <div v-if="ownerHandoffs.length > 0" class="handoff-card">
            <span class="channel-badge">{{ ownerHandoffs[0]!.channel }}</span>
            <div>
              <p class="eyebrow">{{ ownerHandoffs[0]!.campaignTitle }} · {{ ownerHandoffs[0]!.channel }} · {{ ownerHandoffs[0]!.accountAlias }} · 发布任务</p>
              <h3>{{ ownerHandoffs[0]!.reason }}</h3>
              <ul class="handoff-checklist"><li v-for="item in ownerHandoffs[0]!.checklist" :key="item">{{ item }}</li></ul>
              <p>官方地址：<code>{{ ownerHandoffs[0]!.officialTargetUrl }}</code> · 失效时间：{{ ownerHandoffs[0]!.expiresAt }}</p>
            </div>
            <button type="button" disabled>运行时未连接</button>
          </div>
          <div v-else class="empty-handoff">当前没有需要人工接管的内容。</div>
        </section>
      </template>

      <template v-else-if="activeModule === 'reports'">
        <section id="reports" class="module-section">
          <div class="section-heading"><div><p class="eyebrow">项目空间 / 发布后监测</p><h2>项目报告</h2></div><span>按活动和渠道查看</span></div>
          <p class="section-intro">报告不是活动里的另一个任务，而是发布回执和后续监测的结果投影。下面先用演示数据说明闭环；正式数据必须来自匹配的 marketing-ops 回执。</p>
          <div class="report-list">
            <article v-for="report in snapshot.reports" :key="`${report.activityId}-${report.channel}`" class="report-card">
              <div class="detail-heading"><div><p class="eyebrow">{{ report.activityTitle }} · {{ report.contentType }} · {{ report.accountAlias }}</p><h3>{{ report.channel }}</h3></div><span class="task-status" :data-status="report.status">{{ report.status }}</span></div>
              <div class="report-metrics"><div v-for="metric in report.metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div></div>
              <p class="report-note">{{ report.note }}</p>
              <small class="report-last-checked">{{ report.lastChecked }}</small>
              <button type="button" class="report-link" @click="selectCampaign(report.activityId)">查看所属活动 →</button>
            </article>
          </div>
        </section>
      </template>

      <footer>
        <span>Content Studio · 本地优先控制面</span>
        <span>不保存凭据 · 不推断发布权限</span>
      </footer>
    </main>
  </div>
</template>
