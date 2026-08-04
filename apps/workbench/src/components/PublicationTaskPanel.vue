<script setup lang="ts">
import { computed } from 'vue'
import type { OwnerHandoffProjection, TaskProjection } from '../model'
import { humanizeStatus } from '../model'

const props = defineProps<{
  handoff?: OwnerHandoffProjection
  runtimeConnected: boolean
  task: TaskProjection
}>()

const emit = defineEmits<{
  'go-owner': []
}>()

const deliveryStateLabel = computed(() => {
  if (props.task.status === 'published')
    return '已收到发布回执'
  if (props.task.status === 'awaiting-owner')
    return '等待人工处理'
  if (props.task.status === 'failed')
    return '发布失败'
  return humanizeStatus(props.task.status)
})

const deliveryStateDetail = computed(() => {
  if (props.task.status === 'published')
    return '渠道回执已进入任务记录。'
  if (props.task.status === 'awaiting-owner')
    return '完成官方页面操作后才会等待渠道回执。'
  if (props.task.status === 'failed')
    return '请查看任务事件后创建新的重试尝试。'
  return '状态由本地任务运行时更新。'
})

const handoffStatusLabel = computed(() => {
  if (props.handoff?.status === 'completed')
    return '人工已完成，等待回执'
  if (props.handoff?.status === 'cancelled')
    return '人工交接已取消'
  if (props.handoff?.status === 'expired')
    return '人工交接已过期'
  return '等待授权人处理'
})
</script>

<template>
  <section id="publication" class="panel publication-panel" data-testid="publication-task-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">选中任务 · 发布交付</p>
        <h2>{{ props.task.title }}</h2>
        <p class="publication-task-context">
          活动：{{ props.task.activityTitle }} · 内容：{{ props.task.contentTitle }} · 渠道：{{ props.task.channel }} · 账号：{{ props.task.accountAlias }}
        </p>
        <p class="publication-task-id">任务编号：<code>{{ props.task.taskId }}</code></p>
      </div>
      <span class="task-status" :data-status="props.task.status">{{ humanizeStatus(props.task.status) }}</span>
    </div>

    <div class="publication-task-meta">
      <div>
        <span>交付渠道</span>
        <strong>{{ props.task.channel }}</strong>
        <small>{{ props.task.accountAlias }}</small>
      </div>
      <div>
        <span>当前状态</span>
        <strong>{{ deliveryStateLabel }}</strong>
        <small>{{ deliveryStateDetail }}</small>
      </div>
      <div>
        <span>任务尝试</span>
        <strong>第 {{ props.task.attempt }} 次</strong>
        <small>{{ props.task.attempts.at(-1)?.lastEvent ?? '尚未产生事件' }}</small>
      </div>
    </div>

    <section v-if="props.handoff" class="publication-handoff" data-testid="publication-task-handoff">
      <div class="publication-handoff-heading">
        <div>
          <p class="eyebrow">当前发布暂停点</p>
          <h3>{{ handoffStatusLabel }}</h3>
        </div>
        <span>{{ props.handoff.expiresAt }} 前有效</span>
      </div>
      <p class="publication-handoff-reason">{{ props.handoff.reason }}</p>
      <ul class="publication-handoff-checklist">
        <li v-for="item in props.handoff.checklist" :key="item">{{ item }}</li>
      </ul>
      <div class="publication-handoff-actions">
        <a
          data-testid="publication-open-official"
          :href="props.handoff.officialTargetUrl"
          target="_blank"
          rel="noreferrer"
        >打开官方页面</a>
        <button type="button" class="primary-button" data-testid="publication-open-owner" @click="emit('go-owner')">打开处理清单</button>
      </div>
    </section>
    <section v-else class="publication-receipt-note" data-testid="publication-task-receipt">
      <p class="eyebrow">发布回执</p>
      <strong>{{ deliveryStateLabel }}</strong>
      <p>{{ deliveryStateDetail }}</p>
    </section>

    <p class="publication-runtime-note">
      {{ props.runtimeConnected ? '发布状态只接受本地运行时和 marketing-ops 回执，不会由页面自行推断。' : '运行时未连接，当前仅展示任务投影，不会触发真实渠道发布。' }}
    </p>
  </section>
</template>
