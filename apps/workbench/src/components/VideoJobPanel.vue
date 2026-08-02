<script setup lang="ts">
import { computed } from 'vue'
import type { VideoJobProjection } from '../model'
import { humanizeEventKind } from '../model'

const props = defineProps<{
  job: VideoJobProjection
  runtimeConnected: boolean
}>()

const progress = computed(() =>
  Math.round(
    (props.job.completedActions / props.job.totalActions) * 100,
  ),
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
        <div class="preview-orbit orbit-one" />
        <div class="preview-orbit orbit-two" />
        <div class="preview-bars">
          <span
            v-for="height in [36, 68, 48, 82, 56, 72, 42]"
            :key="height"
            :style="{ height: `${height}%` }"
          />
        </div>
        <p>{{ job.previewLabel }}</p>
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
          :disabled="!runtimeConnected"
        >
          重试这一轮
        </button>
      </div>
    </div>
  </section>
</template>
