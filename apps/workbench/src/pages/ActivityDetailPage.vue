<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  CampaignJobStatus,
  CampaignVideo,
  ChannelId,
  ObservationMetric,
  PublishingActivity,
  VideoViewport,
} from '@content-studio/core-types'
import WorkbenchShell from '../components/WorkbenchShell.vue'
import { videoViewportForFormat } from '../model'
import { useWorkbenchStore } from '../stores/workbench'

const route = useRoute()
const router = useRouter()
const store = useWorkbenchStore()
const actionError = ref<string | null>(null)
const actionPending = ref<'confirm' | 'revise' | null>(null)
const viewportDraft = reactive<VideoViewport>({
  height: 1080,
  width: 1920,
})

const activityId = computed(() => String(route.params.activityId ?? ''))
const runtimeActivity = computed(() => store.activities.find(activity =>
  activity.activityId === activityId.value,
))
const staticActivity = computed(() => store.snapshot.campaigns.find(campaign =>
  campaign.campaignId === activityId.value,
))
const title = computed(() => runtimeActivity.value?.topic['zh-CN']
  ?? runtimeActivity.value?.topic.en
  ?? staticActivity.value?.title
  ?? '活动不存在')
const topic = computed(() => runtimeActivity.value?.topic['zh-CN']
  ?? runtimeActivity.value?.topic.en
  ?? staticActivity.value?.topic
  ?? '请返回活动列表选择一个活动。')
const channels = computed(() => runtimeActivity.value?.channels.map(channel => channel.id)
  ?? staticActivity.value?.channels
  ?? [])
const status = computed(() => runtimeActivity.value === undefined
  ? staticActivity.value?.activityStatus ?? '未知'
  : activityStatusLabel(runtimeActivity.value.status))
const video = computed<CampaignVideo | null>(() => runtimeActivity.value?.video
  ?? null)
const videoPlan = computed(() => {
  if (runtimeActivity.value?.video !== undefined) {
    const currentVideo = runtimeActivity.value.video
    const flows = new Map(
      (store.projectView?.snapshot.manifest.captureFlows ?? []).map(flow => [flow.id, flow]),
    )
    return {
      format: currentVideo.format,
      planVersion: currentVideo.planVersion ?? runtimeActivity.value.version,
      reviewStatus: runtimeActivity.value.videoPlanReviewStatus === 'confirmed' ? '已确认' : '待确认',
      scenes: currentVideo.flowIds.map(flowId => ({
        flowId,
        startPath: flows.get(flowId)?.startPath ?? '未登记路径',
        title: flows.get(flowId)?.title['zh-CN'] ?? flows.get(flowId)?.title.en ?? flowId,
      })),
      viewport: videoViewportForFormat(currentVideo),
    }
  }
  return staticActivity.value?.videoPlan ?? null
})
const tasks = computed(() => {
  if (store.projectView !== null)
    return store.projectView.tasks.filter(task => task.activityId === activityId.value)
  return store.snapshot.tasks.filter(task => task.activityId === activityId.value)
})
const contentGroups = computed(() => {
  if (store.projectView === null)
    return staticActivity.value?.contentGroups ?? []
  return store.projectView.contentGroups
    .filter(group => group.activityId === activityId.value)
    .map(group => ({
      ...group,
      contents: store.projectView!.channelContents.filter(content => content.contentGroupId === group.contentGroupId),
    }))
})
type ActivityArtifactView = {
  activityId: string
  artifactId: string
  kind: string
  name: string
  size: string
}

const artifacts = computed<ActivityArtifactView[]>(() => {
  if (store.projectView === null)
    return staticActivity.value?.activityArtifacts ?? []
  return store.projectView.activityArtifacts
    .filter(artifact => artifact.activityId === activityId.value)
    .map(artifact => ({
      activityId: artifact.activityId,
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      name: artifact.relativePath.split(/[\\/]/u).at(-1) ?? artifact.relativePath,
      size: '已登记',
    }))
})
type PublicationResult = {
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

const publicationResults = computed<PublicationResult[]>(() => {
  if (store.projectView === null) {
    return contentGroups.value.flatMap(group => group.contents.map(content => ({
      channel: content.channel,
      contentId: content.contentId,
      contentTitle: content.title,
      format: content.format,
      publicationId: `demo-${content.contentId}`,
      status: '待建立安排' as const,
    })))
  }

  const view = store.projectView
  const contentById = new Map(view.channelContents.map(content => [content.contentId, content]))
  const planByContentId = new Map(
    view.publicationPlans
      .filter(plan => plan.activityId === activityId.value)
      .map(plan => [plan.contentId, plan]),
  )
  const receiptByPublicationId = new Map(
    view.publicationReceipts.map(receipt => [receipt.publicationId, receipt]),
  )
  const observationsByPublicationId = new Map<string, typeof view.monitoringObservations>()
  for (const observation of view.monitoringObservations) {
    const observations = observationsByPublicationId.get(observation.publicationId) ?? []
    observations.push(observation)
    observationsByPublicationId.set(observation.publicationId, observations)
  }
  const rows = view.channelContents
    .filter(content => content.activityId === activityId.value)
    .map(content => {
      const plan = planByContentId.get(content.contentId)
      const receipt = plan === undefined ? undefined : receiptByPublicationId.get(plan.publicationId)
      const latestObservation = plan === undefined
        ? undefined
        : [...(observationsByPublicationId.get(plan.publicationId) ?? [])]
          .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))[0]
      return {
        channel: content.channel,
        contentId: content.contentId,
        contentTitle: content.title,
        format: content.format === 'video' ? '视频' : '文章',
        ...(latestObservation === undefined ? {} : {
          latestObservation: {
            collectedAt: latestObservation.collectedAt,
            metrics: observationMetrics(latestObservation.metrics),
            source: observationSourceLabel(latestObservation.source),
          },
        }),
        ...(receipt?.publicUrl === undefined ? {} : { publicUrl: receipt.publicUrl }),
        publicationId: plan?.publicationId ?? `pending-${content.contentId}`,
        status: receipt?.status === 'published'
          ? '已发布' as const
          : receipt?.status === 'failed'
            ? '发布失败' as const
            : plan === undefined
              ? '待建立安排' as const
              : '已安排' as const,
      }
    })
  const plannedContentIds = new Set(rows.map(row => row.contentId))
  const unlinkedPlans = view.publicationPlans
    .filter(plan => plan.activityId === activityId.value && !plannedContentIds.has(plan.contentId))
    .map(plan => ({
      channel: plan.channel,
      contentId: plan.contentId,
      contentTitle: contentById.get(plan.contentId)?.title ?? '渠道成品待登记',
      format: contentById.get(plan.contentId)?.format === 'video' ? '视频' : '文章',
      publicationId: plan.publicationId,
      status: '已安排' as const,
    }))
  return [...rows, ...unlinkedPlans]
})

type ActivityProgressStage = {
  detail: string
  label: string
  status: 'active' | 'done' | 'pending'
}

const activityBusinessProgress = computed<ActivityProgressStage[]>(() => {
  const productionTasks = tasks.value.filter(task => task.kind === 'production')
  const publicationTasks = tasks.value.filter(task => task.kind === 'publication')
  const monitoringTasks = tasks.value.filter(task => task.kind === 'monitoring')
  const publicationScheduled = publicationResults.value.some(result => result.status !== '待建立安排')
  const publicationCompleted = publicationResults.value.some(result => result.status === '已发布')
  const monitoringCompleted = publicationResults.value.some(result => result.latestObservation !== undefined)
  return [
    {
      detail: `${channels.value.length} 个渠道已选` ,
      label: '主题与渠道',
      status: channels.value.length > 0 ? 'done' : 'active',
    },
    {
      detail: contentGroups.value.length > 0
        ? `${contentGroups.value.length} 个内容组，${contentGroups.value.reduce((total, group) => total + group.contents.length, 0)} 个渠道版本`
        : '等待 AI 或用户建立内容组',
      label: '内容组与渠道成品',
      status: contentGroups.value.length > 0 ? 'done' : 'active',
    },
    {
      detail: productionTasks.length > 0
        ? `${productionTasks.length} 个制作任务 · ${taskStatus(productionTasks[0]!.status)}`
        : '尚未建立制作任务',
      label: '制作执行',
      status: productionTasks.length === 0 ? 'pending' : productionTasks.every(task => task.status === 'composing') ? 'done' : 'active',
    },
    {
      detail: publicationScheduled
        ? `${publicationResults.value.filter(result => result.status !== '待建立安排').length} 个发布安排`
        : '尚未建立发布安排',
      label: '发布安排',
      status: publicationScheduled ? 'done' : 'pending',
    },
    {
      detail: publicationCompleted
        ? `${publicationResults.value.filter(result => result.status === '已发布').length} 个渠道已收到成功回执`
        : publicationTasks.length > 0 ? '等待渠道回执' : '发布任务尚未建立',
      label: '发布回执',
      status: publicationCompleted ? 'done' : publicationTasks.length > 0 ? 'active' : 'pending',
    },
    {
      detail: monitoringCompleted
        ? `${publicationResults.value.filter(result => result.latestObservation !== undefined).length} 个渠道已有监测数据`
        : monitoringTasks.length > 0 ? '等待第一次监测采集' : '监测任务尚未建立',
      label: '监测结果',
      status: monitoringCompleted ? 'done' : monitoringTasks.length > 0 ? 'active' : 'pending',
    },
  ]
})
const isRuntimeActivity = computed(() => runtimeActivity.value !== undefined)
const canConfirm = computed(() => isRuntimeActivity.value
  && runtimeActivity.value?.video !== undefined
  && runtimeActivity.value.videoPlanReviewStatus !== 'confirmed'
  && actionPending.value === null)
const canRevise = computed(() => isRuntimeActivity.value
  && video.value !== null
  && actionPending.value === null
  && viewportDraft.width > 0
  && viewportDraft.height > 0)

function syncViewportDraft(): void {
  const current = videoPlan.value?.viewport
  if (current === undefined)
    return
  viewportDraft.height = current.height
  viewportDraft.width = current.width
}

async function confirmPlan(): Promise<void> {
  if (!canConfirm.value || runtimeActivity.value === undefined)
    return
  actionPending.value = 'confirm'
  actionError.value = null
  try {
    await store.confirmActivityVideoPlan(
      runtimeActivity.value.activityId,
      runtimeActivity.value.version,
    )
  }
  catch (error: unknown) {
    actionError.value = error instanceof Error ? error.message : '拍摄计划确认失败'
  }
  finally {
    actionPending.value = null
  }
}

async function revisePlan(): Promise<void> {
  if (!canRevise.value || runtimeActivity.value === undefined)
    return
  actionPending.value = 'revise'
  actionError.value = null
  try {
    await store.reviseActivityViewport(runtimeActivity.value, {
      height: viewportDraft.height,
      width: viewportDraft.width,
    })
  }
  catch (error: unknown) {
    actionError.value = error instanceof Error ? error.message : '拍摄计划修订失败'
  }
  finally {
    actionPending.value = null
  }
}

function taskStatus(status: CampaignJobStatus): string {
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

function activityStatusLabel(status: PublishingActivity['status']): string {
  const labels: Record<PublishingActivity['status'], string> = {
    active: '进行中',
    archived: '已归档',
    completed: '已完成',
    draft: '草稿',
    planned: '已规划',
  }
  return labels[status]
}

function observationMetrics(metrics: Partial<Record<ObservationMetric, number | null>>): string {
  const labels: Record<string, string> = {
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
    .map(([key, value]) => `${labels[key] ?? key} ${value!.toLocaleString('zh-CN')}`)
  return entries.length > 0 ? entries.join(' · ') : '暂无可用指标'
}

function observationSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    'authorized-adapter': '授权适配器',
    'owner-entered': '授权人录入',
    public: '公开页面',
  }
  return labels[source] ?? source
}

onMounted(() => {
  if (store.projectView === null)
    void store.refresh()
})
watch(videoPlan, syncViewportDraft, { immediate: true })
</script>

<template>
  <WorkbenchShell
    :project-id="store.snapshot.project.projectId"
    :project-name="store.snapshot.project.name"
    :runtime-connected="store.runtimeConnected"
  >
    <section class="detail-page" data-testid="activity-detail-page">
    <div class="detail-page-topbar">
      <button type="button" class="back-link" @click="router.push('/project/activities')">← 返回活动列表</button>
      <span class="connection-pill">{{ store.runtimeConnected ? '运行时已连接' : '演示数据' }}</span>
    </div>

    <header class="detail-page-header">
      <div>
        <p class="eyebrow">项目空间 / 发布活动 / 活动详情</p>
        <h1>{{ title }}</h1>
        <p class="detail-page-topic">{{ topic }}</p>
      </div>
      <span class="task-status">{{ status }}</span>
    </header>

    <p v-if="store.loading" class="runtime-connection-note" aria-live="polite">正在读取活动数据…</p>
    <p v-if="store.runtimeError" class="runtime-connection-note" aria-live="polite">本地运行时未连接，当前显示演示数据：{{ store.runtimeError }}</p>
    <p v-if="actionError" class="form-error" aria-live="polite">{{ actionError }}</p>

    <section class="detail-summary-grid" aria-label="活动概要">
      <article><span>主题目标</span><strong>{{ topic }}</strong></article>
      <article><span>已选渠道</span><strong>{{ channels.length }} 个</strong><small>{{ channels.join(' · ') || '尚未选择渠道' }}</small></article>
      <article><span>执行任务</span><strong>{{ tasks.length }} 个</strong><small>制作 · 发布 · 监测</small></article>
      <article><span>活动素材</span><strong>{{ artifacts.length }} 个</strong><small>活动产物，不等于项目素材</small></article>
    </section>

    <section class="detail-section activity-progress-section" data-testid="activity-business-progress">
      <div class="detail-section-heading">
        <div><p class="eyebrow">活动业务进度</p><h2>从主题到监测</h2></div>
        <span>不等同于任务内部阶段</span>
      </div>
      <ol class="activity-progress-list">
        <li v-for="stage in activityBusinessProgress" :key="stage.label" :data-stage-status="stage.status">
          <span class="activity-progress-marker" />
          <div><strong>{{ stage.label }}</strong><small>{{ stage.detail }}</small></div>
        </li>
      </ol>
    </section>

    <section v-if="videoPlan" class="detail-section">
      <div class="detail-section-heading">
        <div><p class="eyebrow">制作任务 / 视频计划</p><h2>拍摄大纲</h2></div>
        <span class="plan-review-status" :data-status="videoPlan.reviewStatus">{{ videoPlan.reviewStatus }}</span>
      </div>
      <div class="detail-meta-line">
        <span>第 {{ videoPlan.planVersion }} 版</span>
        <span>{{ videoPlan.format }}</span>
        <span>录制视口 {{ videoPlan.viewport.width }} × {{ videoPlan.viewport.height }}</span>
      </div>
      <div v-if="isRuntimeActivity" class="detail-viewport-editor">
        <div><strong>调整本次活动的录制尺寸</strong><small>保存会生成新版本，旧确认自动失效。</small></div>
        <label>宽度<input v-model.number="viewportDraft.width" min="320" max="3840" type="number" /></label>
        <label>高度<input v-model.number="viewportDraft.height" min="320" max="3840" type="number" /></label>
        <button type="button" class="primary-button" :disabled="!canRevise" @click="revisePlan">
          {{ actionPending === 'revise' ? '保存中…' : '保存尺寸' }}
        </button>
      </div>
      <ol class="detail-scene-list">
        <li v-for="(scene, index) in videoPlan.scenes" :key="scene.flowId">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          <div><strong>{{ scene.title }}</strong><code>{{ scene.flowId }} · {{ scene.startPath }}</code></div>
        </li>
      </ol>
      <div class="detail-section-actions">
        <p>{{ videoPlan.reviewStatus === '已确认' ? '这版拍摄计划已经确认，制作任务可以继续执行。' : '确认后，制作任务才会使用这版拍摄计划。' }}</p>
        <button type="button" class="primary-button" :disabled="!canConfirm" @click="confirmPlan">
          {{ actionPending === 'confirm' ? '确认中…' : videoPlan.reviewStatus === '已确认' ? '已确认' : '确认拍摄大纲' }}
        </button>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-heading"><div><p class="eyebrow">活动内容</p><h2>渠道成品与内容组</h2></div><span>{{ contentGroups.length }} 个内容组</span></div>
      <div v-if="contentGroups.length > 0" class="detail-content-groups">
        <article v-for="group in contentGroups" :key="group.contentGroupId" class="detail-content-group">
          <div><h3>{{ group.title }}</h3><p>{{ group.coreMessage }}</p></div>
          <ul><li v-for="content in group.contents" :key="content.contentId"><strong>{{ content.title }}</strong><span>{{ content.channel }} · {{ content.format }} · 已登记</span></li></ul>
        </article>
      </div>
      <p v-else class="empty-state">当前活动还没有渠道成品。下一步应由 AI 根据主题和渠道生成文章、视频脚本或其他内容版本。</p>
    </section>

    <section class="detail-section" data-testid="activity-publication-results">
      <div class="detail-section-heading">
        <div><p class="eyebrow">发布与监测</p><h2>渠道结果</h2></div>
        <span>{{ publicationResults.length }} 个渠道版本</span>
      </div>
      <div v-if="publicationResults.length > 0" class="activity-publication-list">
        <article v-for="result in publicationResults" :key="result.publicationId" class="activity-publication-card">
          <div class="activity-publication-heading">
            <div><p class="eyebrow">{{ result.channel }} · {{ result.format }}</p><h3>{{ result.contentTitle }}</h3></div>
            <span class="task-status" :data-status="result.status">{{ result.status }}</span>
          </div>
          <p v-if="result.status === '待建立安排'">该渠道版本已生成，发布安排尚未建立。</p>
          <p v-else-if="result.status === '已安排'">发布安排已建立，等待 marketing-ops 回执。</p>
          <p v-else-if="result.status === '发布失败'">渠道回执标记为失败，需要检查授权人处理结果。</p>
          <p v-else>已收到成功发布回执{{ result.publicUrl === undefined ? '，公开地址尚未登记' : '。' }}</p>
          <div v-if="result.latestObservation" class="activity-observation">
            <span>最近采集 {{ result.latestObservation.collectedAt }} · {{ result.latestObservation.source }}</span>
            <strong>{{ result.latestObservation.metrics }}</strong>
          </div>
          <a v-if="result.publicUrl" class="activity-publication-link" :href="result.publicUrl" target="_blank" rel="noreferrer">打开公开地址 →</a>
        </article>
      </div>
      <p v-else class="empty-state">当前活动还没有渠道成品或发布安排。</p>
    </section>

    <section class="detail-section detail-two-columns">
      <div>
        <div class="detail-section-heading"><div><p class="eyebrow">执行记录</p><h2>关联任务</h2></div><span>{{ tasks.length }} 个</span></div>
        <ul v-if="tasks.length > 0" class="detail-task-list"><li v-for="task in tasks" :key="task.taskId"><div><strong>{{ task.kind }} · {{ task.taskId }}</strong><small>{{ task.contentId ?? '活动级任务' }}</small></div><span class="task-status">{{ taskStatus(task.status) }}</span></li></ul>
        <p v-else class="empty-state">当前活动还没有完整的制作、发布、监测任务链。</p>
      </div>
      <div>
        <div class="detail-section-heading"><div><p class="eyebrow">活动产物</p><h2>素材与成品</h2></div><span>{{ artifacts.length }} 个</span></div>
        <ul v-if="artifacts.length > 0" class="detail-task-list"><li v-for="artifact in artifacts" :key="artifact.artifactId"><div><strong>{{ artifact.name }}</strong><small>{{ artifact.kind }} · {{ artifact.size }}</small></div><span>{{ artifact.artifactId }}</span></li></ul>
        <p v-else class="empty-state">当前活动还没有登记产物。</p>
      </div>
    </section>
    </section>
  </WorkbenchShell>
</template>
