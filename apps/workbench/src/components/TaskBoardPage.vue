<script setup lang="ts">
import { computed } from 'vue'
import PublicationTaskPanel from './PublicationTaskPanel.vue'
import VideoJobPanel from './VideoJobPanel.vue'
import type { CampaignProjection, OwnerHandoffProjection, WorkbenchSnapshot } from '../model'
import { humanizeStatus, humanizeTaskEventKind } from '../model'

type TaskScope = '全部项目' | '当前项目'
type TaskAction = 'cancel' | 'confirm-owner' | 'record' | 'retry' | 'start'
type TaskProjection = WorkbenchSnapshot['tasks'][number]
type TaskOwnerHandoff = OwnerHandoffProjection & {
  campaignTitle: string
  taskId?: string
}

const props = defineProps<{
  activeTaskScope: TaskScope
  canCancelSelectedTask: boolean
  canConfirmOwnerTakeover: boolean
  canRecordSelectedTask: boolean
  canRetrySelectedTask: boolean
  canStartSelectedTask: boolean
  ownerHandoffs: TaskOwnerHandoff[]
  projectCount: number
  projectName: string
  runtimeConnected: boolean
  runtimeLoading: boolean
  selectedTask: TaskProjection
  selectedTaskCampaign: CampaignProjection
  taskActionError: string | null
  taskActionPending: TaskAction | null
  taskCounts: Record<'制作' | '发布' | '监测', number>
  visibleTasks: TaskProjection[]
}>()

const emit = defineEmits<{
  'change-task': [action: TaskAction]
  'go-activities': []
  'go-owner': []
  'select-task': [projectId: string, taskId: string]
}>()

const taskSummaryCopy: Record<'制作' | '发布' | '监测', string> = {
  制作: '文章、图片、视频',
  发布: '渠道交付与发布回执',
  监测: '播放量、阅读量、回复',
}

const selectedTaskContent = computed(() =>
  props.selectedTaskCampaign.contentGroups
    .flatMap(group => group.contents)
    .find(content => content.contentId === props.selectedTask.contentId),
)

const showVideoJobPanel = computed(() =>
  props.selectedTask.kind === '制作'
  && selectedTaskContent.value?.format === '视频'
  && props.selectedTaskCampaign.videoJob !== null,
)

const selectedTaskHandoff = computed(() =>
  props.selectedTask.kind === '发布'
    ? props.selectedTaskCampaign.handoffs.find(handoff => handoff.channel === props.selectedTask.channel)
    : undefined,
)
</script>

<template>
  <section id="tasks" class="module-section">
    <p class="task-scope-note" data-testid="task-scope-note">
      {{ props.activeTaskScope === '全部项目' ? `${props.projectCount} 个已接入项目 · 统一执行记录` : `当前项目 · ${props.projectName}` }}
    </p>
    <div v-if="props.runtimeLoading" class="runtime-data-state" data-testid="task-runtime-state" aria-live="polite">
      <p class="eyebrow">本地运行时</p>
      <h3>正在读取本地任务</h3>
      <p>正在读取当前范围的制作、发布、监测任务和事件，读取完成后才显示真实执行记录。</p>
    </div>
    <template v-else>
    <div class="task-summary" aria-label="任务统计">
      <div v-for="(count, kind) in props.taskCounts" :key="kind" class="overview-stat task-summary-card" data-testid="task-summary-card">
        <span>{{ kind }}任务</span>
        <strong>{{ count }}</strong>
        <small>{{ taskSummaryCopy[kind] }}</small>
      </div>
      <div class="overview-stat task-summary-card" data-testid="task-summary-owner">
        <span>待人工</span>
        <strong>{{ props.ownerHandoffs.length }}</strong>
        <small>登录、审核、最终确认</small>
      </div>
    </div>
    <div v-if="props.visibleTasks.length === 0" class="task-empty-state" data-testid="tasks-empty-state">
      <p class="eyebrow">当前范围没有执行记录</p>
      <h3>{{ props.runtimeConnected ? '还没有制作、发布或监测任务' : '没有可展示的演示任务' }}</h3>
      <p>{{ props.runtimeConnected ? '先创建一个发布活动，并为渠道内容建立制作或发布安排，任务会自动出现在这里。' : '连接本地运行时后，这里会显示真实的项目任务。' }}</p>
      <button type="button" class="primary-button" @click="emit('go-activities')">去发布活动</button>
    </div>
    <div v-if="props.visibleTasks.length > 0" class="task-board">
      <div class="task-list" role="list" aria-label="执行任务">
        <button
          v-for="task in props.visibleTasks"
          :key="`${task.projectId ?? props.projectName}:${task.taskId}`"
          type="button"
          :data-task-id="task.taskId"
          :class="{ selected: task.taskId === props.selectedTask.taskId && task.projectId === props.selectedTask.projectId }"
          @click="emit('select-task', task.projectId ?? props.selectedTask.projectId ?? '', task.taskId)"
        >
          <span class="task-kind">{{ task.kind }}</span>
          <strong>{{ task.title }}</strong>
          <small>{{ task.projectName ?? props.projectName }} · {{ task.activityTitle }} · {{ task.contentTitle }}</small>
          <small>{{ task.channel }} · {{ task.accountAlias }} · {{ humanizeStatus(task.status) }} · 第 {{ task.attempt }} 次尝试</small>
        </button>
      </div>
      <article class="task-detail">
        <div class="detail-heading">
          <div><p class="eyebrow">选中任务 · {{ props.selectedTask.kind }}</p><h3>{{ props.selectedTask.title }}</h3></div>
          <span class="task-status" :data-status="props.selectedTask.status">{{ humanizeStatus(props.selectedTask.status) }}</span>
        </div>
        <p class="task-detail-context">{{ props.selectedTask.activityTitle }} → {{ props.selectedTask.contentTitle }} → {{ props.selectedTask.channel }} → {{ props.selectedTask.accountAlias }}</p>
        <p class="task-detail-copy">{{ props.selectedTask.detail }}</p>
        <ol class="task-step-list" aria-label="任务阶段">
          <li v-for="step in props.selectedTask.steps" :key="step.label" :data-step-status="step.status" :aria-current="step.status === 'active' ? 'step' : undefined">
            <span class="step-marker" />
            <div><strong>{{ step.label }}</strong><small>{{ step.detail }}</small></div>
          </li>
        </ol>
        <div class="task-detail-meta">
          <span>任务编号 <code>{{ props.selectedTask.taskId }}</code></span>
          <span>所属项目 <code>{{ props.selectedTask.projectId ?? props.projectName }}</code></span>
          <span>所属活动 <code>{{ props.selectedTask.activityId }}</code></span>
          <span>当前尝试 <strong>第 {{ props.selectedTask.attempt }} 次</strong></span>
        </div>
        <div class="task-attempts">
          <p class="eyebrow">尝试历史</p>
          <ol>
            <li v-for="attempt in props.selectedTask.attempts" :key="props.selectedTask.taskId + '-attempt-' + attempt.attempt">
              <div><strong>第 {{ attempt.attempt }} 次尝试</strong><span>{{ attempt.status }}</span></div>
              <small>{{ attempt.eventCount }} 条事件 · {{ attempt.lastEvent }}</small>
            </li>
          </ol>
        </div>
        <div v-if="props.selectedTask.events.length > 0" class="task-events">
          <p class="eyebrow">运行事件</p>
          <ol>
            <li v-for="event in props.selectedTask.events" :key="props.selectedTask.taskId + '-' + event.sequence">
              <span>第 {{ event.sequence }} 条 · {{ event.attempt === undefined ? props.selectedTask.attempt : event.attempt }} 次尝试 · {{ humanizeTaskEventKind(event.kind) }}</span>
              <small>{{ event.summary ?? event.message }}</small>
            </li>
          </ol>
        </div>
        <div v-if="props.selectedTask.status === 'awaiting-owner'" class="task-handoff-inline">
          <div><p class="eyebrow">需要人工介入</p><strong>{{ props.selectedTaskCampaign.handoffs[0]?.reason ?? '请完成官方页面确认' }}</strong></div>
          <span>不会保存凭据</span>
        </div>
        <div class="job-actions">
          <p class="runtime-status task-runtime-status" aria-live="polite">
            <span v-if="props.taskActionError" class="task-action-error">{{ props.taskActionError }}</span>
            <span v-else-if="!props.runtimeConnected">运行时未连接 · 演示任务不可操作</span>
            <span v-else>开始制作会自动排队视频录制；操作只写入本地任务事件，不会触发渠道发布</span>
          </p>
          <div>
            <button type="button" class="primary-button" data-testid="record-task" :disabled="!props.canRecordSelectedTask || props.taskActionPending !== null" @click="emit('change-task', 'record')">
              {{ props.taskActionPending === 'record' ? '录制中…' : '手动录制' }}
            </button>
            <button type="button" class="primary-button" data-testid="start-task" :disabled="!props.canStartSelectedTask || props.taskActionPending !== null" @click="emit('change-task', 'start')">
              {{ props.taskActionPending === 'start' ? '启动中…' : '开始制作' }}
            </button>
            <button
              v-if="props.selectedTask.kind === '制作' && props.selectedTask.status === 'awaiting-owner'"
              type="button"
              class="primary-button"
              data-testid="confirm-owner-takeover"
              :disabled="!props.canConfirmOwnerTakeover || props.taskActionPending !== null"
              @click="emit('change-task', 'confirm-owner')"
            >
              {{ props.taskActionPending === 'confirm-owner' ? '确认中…' : '人工已确认，继续录制' }}
            </button>
            <button type="button" :disabled="!props.canCancelSelectedTask || props.taskActionPending !== null" @click="emit('change-task', 'cancel')">
              {{ props.taskActionPending === 'cancel' ? '取消中…' : '取消当前尝试' }}
            </button>
            <button type="button" class="primary-button" :disabled="!props.canRetrySelectedTask || props.taskActionPending !== null" @click="emit('change-task', 'retry')">
              {{ props.taskActionPending === 'retry' ? '重试中…' : '新建重试尝试' }}
            </button>
          </div>
        </div>
      </article>
    </div>
    </template>
  </section>
  <VideoJobPanel
    v-if="!props.runtimeLoading && props.visibleTasks.length > 0 && showVideoJobPanel && props.selectedTaskCampaign.videoJob"
    id="video"
    :account-alias="props.selectedTask.accountAlias"
    :activity-title="props.selectedTask.activityTitle"
    :channel="props.selectedTask.channel"
    :content-title="props.selectedTask.contentTitle"
    :job="props.selectedTaskCampaign.videoJob"
    :video-plan="props.selectedTaskCampaign.videoPlan"
    :runtime-connected="props.runtimeConnected"
    :task-title="props.selectedTask.title"
  />
  <PublicationTaskPanel
    v-if="!props.runtimeLoading && props.visibleTasks.length > 0 && props.selectedTask.kind === '发布'"
    :handoff="selectedTaskHandoff"
    :runtime-connected="props.runtimeConnected"
    :task="props.selectedTask"
    @go-owner="emit('go-owner')"
  />
</template>
