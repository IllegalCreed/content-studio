<script setup lang="ts">
import type { CampaignJobStatus } from '@content-studio/core-types'
import { computed } from 'vue'
import {
  humanizeStatus,
  lifecycleStages,
} from '../model'

const props = defineProps<{
  status: CampaignJobStatus
}>()

const activeIndex = computed(() =>
  lifecycleStages.indexOf(props.status),
)
</script>

<template>
  <ol
    class="status-rail"
    aria-label="任务生命周期"
  >
    <li
      v-for="(stage, index) in lifecycleStages"
      :key="stage"
      :class="{
        active: index === activeIndex,
        complete: index < activeIndex,
      }"
    >
      <span class="status-dot" />
      <span>{{ humanizeStatus(stage) }}</span>
    </li>
  </ol>
</template>
