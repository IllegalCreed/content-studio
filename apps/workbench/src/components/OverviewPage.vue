<script setup lang="ts">
import type { WorkbenchSnapshot } from '../model'
import { humanizeActivityStatus, humanizeStatus } from '../model'

const props = defineProps<{
  activityTaskSummary: (activityId: string) => string
  ownerHandoffCount: number
  pendingTaskCount: number
  projectCount: number
  snapshot: WorkbenchSnapshot
}>()

const emit = defineEmits<{
  'go-activities': []
  'go-project': []
  'go-tasks': []
  'open-activity': [activityId: string]
  'select-task': [taskId: string]
}>()
</script>

<template>
  <section class="overview-scope-note" data-testid="overview-scope-note">
    <div>
      <p class="eyebrow">全局控制台 / 跨项目汇总</p>
      <strong>这里看所有项目的活动、任务和待人工事项</strong>
      <span>当前本地运行时已加载 {{ props.projectCount }} 个项目；下面的活动和任务都带有项目归属。</span>
    </div>
    <button type="button" @click="emit('go-project')">查看当前项目</button>
  </section>

  <section class="overview-stats" aria-label="全局总览">
    <div class="overview-stat overview-stat-primary">
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
      <strong>{{ props.snapshot.campaigns.length }}</strong>
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
        <button v-for="campaign in props.snapshot.campaigns" :key="campaign.campaignId" type="button" :data-campaign-id="campaign.campaignId" @click="emit('open-activity', campaign.campaignId)">
          <span class="list-status">{{ props.snapshot.project.name }} · {{ humanizeActivityStatus(campaign.activityStatus) }} · {{ props.activityTaskSummary(campaign.campaignId) }}</span>
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
        <button v-for="task in props.snapshot.tasks" :key="task.taskId" type="button" @click="emit('select-task', task.taskId)">
          <span class="list-status">{{ props.snapshot.project.name }} · {{ task.kind }} · {{ humanizeStatus(task.status) }}</span>
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
        <span>跨项目索引</span>
      </div>
      <div class="project-rollup-list">
        <div class="project-rollup-item">
          <div>
            <strong>{{ props.snapshot.project.name }}</strong>
            <code>{{ props.snapshot.project.projectId }}</code>
          </div>
          <small>{{ props.snapshot.campaigns.length }} 个活动 · {{ props.snapshot.tasks.length }} 个任务 · {{ props.snapshot.project.locales.join(' / ') }}</small>
          <button type="button" @click="emit('go-project')">打开项目空间</button>
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
