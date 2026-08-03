<script setup lang="ts">
import { computed } from 'vue'
import type { VideoJobProjection } from '../model'
import { humanizeEventKind } from '../model'

const props = defineProps<{
  job: VideoJobProjection
  runtimeConnected: boolean
}>()

const progress = computed(() =>
  props.job.totalActions === 0
    ? 0
    : Math.round((props.job.completedActions / props.job.totalActions) * 100),
)
</script>

<template>
  <section class="panel video-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">
          视频制作 · 第 {{ job.attempt }} 次尝试
        </p>
        <h2>{{ job.jobId }}</h2>
      </div>
      <span class="progress-value">{{ progress }}%</span>
    </div>

    <div class="progress-track">
      <span :style="{ width: `${progress}%` }" />
    </div>

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
          <div class="preview-orbit orbit-one" />
          <div class="preview-orbit orbit-two" />
          <div class="preview-bars">
            <span
              v-for="height in [36, 68, 48, 82, 56, 72, 42]"
              :key="height"
              :style="{ height: `${height}%` }"
            />
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
