<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  CampaignJobStatus,
  CampaignVideo,
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
  const runtimeTasks = store.projectView?.tasks.filter(task => task.activityId === activityId.value)
  if (runtimeTasks !== undefined && runtimeTasks.length > 0)
    return runtimeTasks
  return store.snapshot.tasks.filter(task => task.activityId === activityId.value)
})
const contentGroups = computed(() => store.projectView?.contentGroups
  .filter(group => group.activityId === activityId.value)
  .map(group => ({
    ...group,
    contents: store.projectView!.channelContents.filter(content => content.contentGroupId === group.contentGroupId),
  }))
  ?? [])
const artifacts = computed(() => store.projectView?.activityArtifacts
  .filter(artifact => artifact.activityId === activityId.value)
  ?? [])
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
      <article><span>活动素材</span><strong>{{ artifacts.length || staticActivity?.activityArtifacts.length || 0 }} 个</strong><small>活动产物，不等于项目素材</small></article>
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

    <section class="detail-section detail-two-columns">
      <div>
        <div class="detail-section-heading"><div><p class="eyebrow">执行记录</p><h2>关联任务</h2></div><span>{{ tasks.length }} 个</span></div>
        <ul v-if="tasks.length > 0" class="detail-task-list"><li v-for="task in tasks" :key="task.taskId"><div><strong>{{ task.kind }} · {{ task.taskId }}</strong><small>{{ task.contentId ?? '活动级任务' }}</small></div><span class="task-status">{{ taskStatus(task.status) }}</span></li></ul>
        <p v-else class="empty-state">当前活动还没有完整的制作、发布、监测任务链。</p>
      </div>
      <div>
        <div class="detail-section-heading"><div><p class="eyebrow">活动产物</p><h2>素材与成品</h2></div><span>{{ artifacts.length }} 个</span></div>
        <ul v-if="artifacts.length > 0" class="detail-task-list"><li v-for="artifact in artifacts" :key="artifact.artifactId"><div><strong>{{ artifact.artifactId }}</strong><small>{{ artifact.kind }} · v{{ artifact.version }}</small></div><span>{{ artifact.relativePath }}</span></li></ul>
        <p v-else class="empty-state">当前活动还没有登记产物。</p>
      </div>
    </section>
    </section>
  </WorkbenchShell>
</template>
