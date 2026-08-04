<script setup lang="ts">
import { computed } from 'vue'
import type { VideoJobProjection, VideoPlanProjection } from '../model'
import { humanizeEventKind } from '../model'

const props = defineProps<{
  accountAlias?: string
  activityTitle?: string
  channel?: string
  contentTitle?: string
  job: VideoJobProjection
  runtimeConnected: boolean
  taskTitle?: string
  videoPlan?: VideoPlanProjection | null
}>()

const progress = computed(() =>
  props.job.totalActions === 0
    ? 0
    : Math.round((props.job.completedActions / props.job.totalActions) * 100),
)

const recordingScenes = computed(() => {
  let actionIndex = 0
  return (props.videoPlan?.scenes ?? []).map(scene => ({
    ...scene,
    actions: scene.actions.map(action => {
      const index = actionIndex++
      const status: 'done' | 'active' | 'pending' = index < props.job.completedActions
        ? 'done'
        : index === props.job.completedActions
          ? 'active'
          : 'pending'
      return {
        ...action,
        index,
        status,
      }
    }),
  }))
})

function actionStatusLabel(status: 'active' | 'done' | 'pending'): string {
  return status === 'done' ? '已完成' : status === 'active' ? '当前动作' : '待执行'
}
</script>

<template>
  <section class="panel video-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">
          选中任务 · 录制证据 · 第 {{ job.attempt }} 次尝试
        </p>
        <h2>{{ props.taskTitle ?? job.jobId }}</h2>
        <p v-if="props.activityTitle || props.contentTitle || props.channel || props.accountAlias" class="video-job-context">
          活动：{{ props.activityTitle ?? '未关联活动' }} · 内容：{{ props.contentTitle ?? '未关联内容' }} · 渠道：{{ props.channel ?? '未指定渠道' }} · 账号：{{ props.accountAlias ?? '未绑定账号' }}
        </p>
        <p class="video-job-id">任务编号：<code>{{ job.jobId }}</code></p>
      </div>
      <div class="video-progress-summary">
        <span>动作进度</span>
        <strong>{{ job.completedActions }} / {{ job.totalActions }} 个动作</strong>
        <small>{{ progress }}%</small>
      </div>
    </div>

    <div
      class="progress-track video-action-progress"
      data-testid="recording-action-progress"
      role="progressbar"
      aria-label="录制动作进度"
      :aria-valuemax="100"
      :aria-valuemin="0"
      :aria-valuenow="progress"
    >
      <span :style="{ width: `${progress}%` }" />
    </div>

    <div v-if="recordingScenes.length > 0" class="recording-actions" data-testid="recording-action-list">
      <div class="recording-actions-heading">
        <div>
          <p class="eyebrow">当前阶段 · 录制中</p>
          <h3>动作清单</h3>
        </div>
        <small>动作是场景步骤的执行明细</small>
      </div>
      <ol class="recording-scene-list">
        <li v-for="(scene, sceneIndex) in recordingScenes" :key="scene.flowId" class="recording-scene">
          <div class="recording-scene-heading">
            <span>场景 {{ String(sceneIndex + 1).padStart(2, '0') }}</span>
            <strong>{{ scene.title }}</strong>
            <small>{{ scene.objective }}</small>
          </div>
          <ol class="recording-action-list">
            <li v-for="action in scene.actions" :key="action.index" :data-action-status="action.status">
              <span class="recording-action-index">{{ action.index + 1 }}</span>
              <strong>{{ action.label }}</strong>
              <small>{{ actionStatusLabel(action.status) }}</small>
            </li>
          </ol>
        </li>
      </ol>
    </div>
    <p v-else class="recording-actions-note">当前没有可展开的动作计划，仅显示录制回执。</p>

    <div class="video-grid">
      <div
        class="preview-frame"
        role="img"
        :aria-label="job.previewLabel"
      >
        <img
          v-if="job.previewUrl"
          class="preview-image"
          :src="job.previewUrl"
          :alt="job.previewLabel"
          loading="lazy"
          decoding="async"
        >
        <template v-else>
          <div class="preview-placeholder">
            <span class="preview-placeholder-mark">◎</span>
            <strong>{{ job.previewLabel }}</strong>
            <p>本轮尚未生成可预览帧</p>
          </div>
        </template>
        <div class="preview-caption">
          <span>{{ job.outcome }}</span>
          <p>{{ job.previewLabel }}</p>
        </div>
      </div>

      <div class="event-stream">
        <p class="eyebrow">
          最近进度
        </p>
        <ol>
          <li
            v-for="event in job.events"
            :key="event.sequence"
          >
            <span>#{{ event.sequence }}</span>
            <div>
              <strong>{{ humanizeEventKind(event.kind) }}</strong>
              <p>{{ event.message }}</p>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <div class="recording-evidence">
      <div>
        <p class="eyebrow">录制产物</p>
        <ul v-if="job.artifacts.length > 0">
          <li
            v-for="artifact in job.artifacts"
            :key="artifact.id"
          >
            <span>{{ artifact.kind }}</span>
            <a
              :href="artifact.url"
              download
              target="_blank"
              rel="noreferrer"
            >{{ artifact.name }}</a>
            <small>{{ artifact.size }}</small>
          </li>
        </ul>
        <p v-else class="muted-value">本轮没有登记产物。</p>
      </div>
      <div>
        <p class="eyebrow">日志摘要</p>
        <p class="recording-log-summary">
          控制台错误 {{ job.logs.consoleErrors }} · 警告 {{ job.logs.consoleWarnings }} · 页面错误 {{ job.logs.pageErrors }}
        </p>
        <p v-if="job.failure" class="form-error">{{ job.failure }}</p>
        <ul v-if="job.logs.entries.length > 0" class="recording-log-list">
          <li v-for="entry in job.logs.entries" :key="entry">{{ entry }}</li>
        </ul>
      </div>
    </div>

    <div class="job-actions">
      <p
        data-testid="runtime-status"
        class="runtime-status"
      >
        <span />
        {{ runtimeConnected ? '运行时已连接' : '运行时未连接' }}
      </p>
      <div>
        <button
          type="button"
          aria-label="Cancel recording job"
          :disabled="!runtimeConnected"
        >
          取消制作
        </button>
        <button
          type="button"
          class="primary-button"
          data-testid="retry-task"
          :disabled="!runtimeConnected"
        >
          重试这一轮
        </button>
      </div>
    </div>
  </section>
</template>
