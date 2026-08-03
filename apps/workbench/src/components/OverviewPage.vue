<script setup lang="ts">
import type { WorkbenchSnapshot } from '../model'
import { humanizeActivityStatus, humanizeStatus } from '../model'

const props = defineProps<{
  activityTaskSummary: (activityId: string) => string
  enabledChannelCount: number
  ownerHandoffCount: number
  pendingTaskCount: number
  snapshot: WorkbenchSnapshot
}>()

const emit = defineEmits<{
  'go-activities': []
  'go-tasks': []
  'open-activity': [activityId: string]
  'select-task': [taskId: string]
}>()
</script>

<template>
  <section class="overview-stats" aria-label="项目概览">
    <div class="overview-stat overview-stat-primary">
      <span>待处理任务</span>
      <strong>{{ props.pendingTaskCount }}</strong>
      <small>制作、发布、监测</small>
    </div>
    <div class="overview-stat">
      <span>等待人工</span>
      <strong>{{ props.ownerHandoffCount }}</strong>
      <small>需要项目负责人确认</small>
    </div>
    <div class="overview-stat">
      <span>项目渠道</span>
      <strong>{{ props.enabledChannelCount }}</strong>
      <small>全局渠道中已启用</small>
    </div>
    <div class="overview-stat">
      <span>素材占用</span>
      <strong>{{ props.snapshot.storage.projectSize }}</strong>
      <small>临时产物可回收</small>
    </div>
  </section>

  <section class="overview-grid">
    <article class="module-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">发布活动</p><h2>最近活动</h2></div>
        <button type="button" @click="emit('go-activities')">查看全部</button>
      </div>
      <div class="module-list">
        <button v-for="campaign in props.snapshot.campaigns" :key="campaign.campaignId" type="button" :data-campaign-id="campaign.campaignId" @click="emit('open-activity', campaign.campaignId)">
          <span class="list-status">{{ humanizeActivityStatus(campaign.activityStatus) }} · {{ props.activityTaskSummary(campaign.campaignId) }}</span>
          <strong>{{ campaign.title }}</strong>
          <small>{{ campaign.channels.length }} 个渠道 · {{ campaign.activityArtifacts.length }} 个活动产物</small>
        </button>
      </div>
    </article>

    <article class="module-card">
      <div class="module-card-heading">
        <div><p class="eyebrow">执行层投影</p><h2>待处理任务</h2></div>
        <button type="button" @click="emit('go-tasks')">打开面板</button>
      </div>
      <div class="module-list">
        <button v-for="task in props.snapshot.tasks" :key="task.taskId" type="button" @click="emit('select-task', task.taskId)">
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
        <div><p class="eyebrow">项目空间</p><h2>{{ props.snapshot.project.name }}</h2></div>
        <code>{{ props.snapshot.project.projectId }}</code>
      </div>
      <dl class="context-list">
        <div><dt>项目事实</dt><dd>{{ props.snapshot.project.version }}</dd></div>
        <div><dt>已启用渠道</dt><dd>{{ props.enabledChannelCount }} 个</dd></div>
        <div><dt>预览环境</dt><dd class="ready">{{ props.snapshot.project.previewReady ? '可用' : '不可用' }}</dd></div>
        <div><dt>项目语言</dt><dd>{{ props.snapshot.project.locales.join(' / ') }}</dd></div>
      </dl>
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
