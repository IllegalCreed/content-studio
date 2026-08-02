<script setup lang="ts">
import { computed } from 'vue'
import type { TaskStepProjection } from '../model'

const props = defineProps<{
  steps: TaskStepProjection[]
}>()

const activeIndex = computed(() =>
  props.steps.findIndex(step => step.status === 'active'),
)
</script>

<template>
  <ol
    class="status-rail"
    aria-label="任务生命周期"
  >
    <li
      v-for="(step, index) in props.steps"
      :key="step.label"
      :class="{
        active: index === activeIndex,
        complete: step.status === 'done',
      }"
      :data-step-status="step.status"
    >
      <span class="status-dot" />
      <span>{{ step.label }}</span>
    </li>
  </ol>
</template>
