<script setup lang="ts">
import type { CampaignProjection, ProjectIndexProjection, TaskProjection, WorkbenchSnapshot } from '../model'
import { humanizeActivityStatus, humanizeStatus } from '../model'

const props = defineProps<{
  activityTaskSummary: (activityId: string, projectId?: string) => string
  campaigns: CampaignProjection[]
  ownerHandoffCount: number
  pendingTaskCount: number
  projectCount: number
  projectIndex: ProjectIndexProjection[]
  snapshot: WorkbenchSnapshot
  tasks: TaskProjection[]
}>()

const emit = defineEmits<{
  'go-activities': []
  'go-project': []
  'go-tasks': []
  'open-activity': [projectId: string, activityId: string]
  'open-project': [projectId: string]
  'select-task': [projectId: string, taskId: string]
}>()
</script>

<template>
  <section class="overview-stats" aria-label="全局总览">
    <div class="overview-stat">
      <span>待处理任务</span>
      <strong>{{ props.pendingTaskCount }}</strong>
      <small>制作、发布、监测</small>
    </div>
    <div class="overview-stat">
      <span>等待人工</span>
      <strong>{{ props.ownerHandoffCount }}</strong>
      <small>跨项目授权、审核和最终确认</small>
    </div>
    <div class="overview-stat">
      <span>发布活动</span>
      <strong>{{ props.campaigns.length }}</strong>
      <small>按项目和主题归档</small>
    </div>
    <div class="overview-stat">
      <span>已加载项目</span>
      <strong>{{ props.projectCount }}</strong>
      <small>项目目录接入后自动扩展</small>
    </div>
  </section>

  <section class="overview-grid">
    <article class="module-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">跨项目活动</p><h2>最近活动</h2></div>
        <button type="button" @click="emit('go-activities')">查看项目活动</button>
      </div>
      <div class="module-list">
        <button v-for="campaign in props.campaigns" :key="`${campaign.projectId ?? props.snapshot.project.projectId}:${campaign.campaignId}`" type="button" :data-campaign-id="campaign.campaignId" @click="emit('open-activity', campaign.projectId ?? props.snapshot.project.projectId, campaign.campaignId)">
          <span class="list-status">{{ campaign.projectName ?? props.snapshot.project.name }} · {{ humanizeActivityStatus(campaign.activityStatus) }} · {{ props.activityTaskSummary(campaign.campaignId, campaign.projectId) }}</span>
          <strong>{{ campaign.title }}</strong>
          <small>{{ campaign.channels.length }} 个渠道 · {{ campaign.activityArtifacts.length }} 个活动产物</small>
        </button>
      </div>
    </article>

    <article class="module-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">跨项目执行层</p><h2>待处理任务</h2></div>
        <button type="button" @click="emit('go-tasks')">打开全局面板</button>
      </div>
      <div class="module-list">
        <button v-for="task in props.tasks" :key="`${task.projectId ?? props.snapshot.project.projectId}:${task.taskId}`" type="button" @click="emit('select-task', task.projectId ?? props.snapshot.project.projectId, task.taskId)">
          <span class="list-status">{{ task.projectName ?? props.snapshot.project.name }} · {{ task.kind }} · {{ humanizeStatus(task.status) }}</span>
          <strong>{{ task.title }}</strong>
          <small>{{ task.activityTitle }} · {{ task.contentTitle }} · {{ task.channel }} · {{ task.accountAlias }}<br>{{ task.detail }}</small>
        </button>
      </div>
    </article>
  </section>

  <section class="overview-grid">
    <article class="module-card project-rollup-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">项目汇总</p><h2>{{ props.projectCount }} 个项目</h2></div>
        <span class="project-rollup-scope" data-testid="project-rollup-scope">跨项目索引</span>
      </div>
      <div class="project-rollup-list">
        <div v-for="project in props.projectIndex" :key="project.projectId" class="project-rollup-item">
          <div>
            <strong>{{ project.name }}</strong>
            <code>{{ project.projectId }}</code>
          </div>
          <small>{{ project.activityCount }} 个活动 · {{ project.taskCount }} 个任务 · v{{ project.snapshotVersion }} · {{ project.previewReady ? '预览就绪' : '暂无预览流' }}</small>
          <small v-if="project.enabledChannels.length > 0" class="project-rollup-channels">已启用 {{ project.enabledChannels.length }} 个渠道</small>
          <small v-else class="project-rollup-channels">尚未启用渠道</small>
          <button type="button" @click="emit('open-project', project.projectId)">打开项目空间</button>
        </div>
      </div>
    </article>

    <article class="module-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">本地运行时</p><h2>{{ props.snapshot.runtimeConnected ? '已连接' : '未连接' }}</h2></div>
        <span class="status-chip" :data-connected="props.snapshot.runtimeConnected">{{ props.snapshot.runtimeConnected ? '可执行' : '只读' }}</span>
      </div>
      <ul class="runtime-checks">
        <li><span>项目数据与任务</span><strong>已加载</strong></li>
        <li><span>Playwright 录制器</span><strong>已安装</strong></li>
        <li><span>发布运行时</span><strong>等待授权</strong></li>
      </ul>
    </article>
  </section>
</template>
