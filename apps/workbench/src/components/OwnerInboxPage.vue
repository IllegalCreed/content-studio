<script setup lang="ts">
interface OwnerHandoffProjection {
  accountAlias: string
  campaignTitle: string
  channel: string
  checklist: string[]
  expiresAt: string
  handoffId: string
  officialTargetUrl: string
  reason: string
  status?: 'cancelled' | 'completed' | 'expired' | 'ready' | 'waiting'
  taskId?: string
}

const props = defineProps<{
  actionError?: string | null
  actionPending?: 'cancel' | 'complete' | null
  ownerHandoffs: OwnerHandoffProjection[]
}>()

const emit = defineEmits<{
  'cancel-handoff': [handoffId: string]
  'complete-handoff': [handoffId: string]
  'open-task': [taskId: string]
}>()

function handoffStatusLabel(status: OwnerHandoffProjection['status']): string {
  return status === 'completed'
    ? '已完成，等待回执'
    : status === 'ready'
      ? '已准备'
    : status === 'cancelled'
      ? '已取消'
      : status === 'expired'
        ? '已过期'
        : '待处理'
}
</script>

<template>
  <section id="owner-inbox" class="module-section">
    <div class="section-heading">
      <div><p class="eyebrow">执行中的人工介入</p><h2>待人工处理</h2></div>
      <span>{{ ownerHandoffs.length }} 个待处理</span>
    </div>
    <p class="section-intro">这不是独立的业务对象，而是任务进入“等待人工”后的处理清单。系统只准备审查包，不保存登录信息。</p>
    <p v-if="props.actionError" class="form-error" aria-live="polite">{{ props.actionError }}</p>
    <div v-if="ownerHandoffs.length > 0" class="handoff-list">
      <article v-for="handoff in props.ownerHandoffs" :key="handoff.handoffId" class="handoff-card" data-testid="owner-handoff-card">
        <span class="channel-badge">{{ handoff.channel }}</span>
        <div>
          <p class="eyebrow">{{ handoff.campaignTitle }} · {{ handoff.channel }} · {{ handoff.accountAlias }} · 发布任务 · {{ handoffStatusLabel(handoff.status) }}</p>
          <h3>{{ handoff.reason }}</h3>
          <ul class="handoff-checklist"><li v-for="item in handoff.checklist" :key="item">{{ item }}</li></ul>
          <p>官方地址：<code>{{ handoff.officialTargetUrl }}</code> · 失效时间：{{ handoff.expiresAt }}</p>
        </div>
        <button
          v-if="handoff.taskId"
          type="button"
          class="primary-button"
          data-testid="owner-handoff-task"
          :data-task-id="handoff.taskId"
          @click="emit('open-task', handoff.taskId)"
        >查看对应任务</button>
        <button v-else type="button" disabled>任务尚未建立</button>
        <div v-if="handoff.status === 'waiting' || handoff.status === undefined" class="handoff-actions">
          <button type="button" class="primary-button" data-testid="owner-handoff-complete" :disabled="props.actionPending !== null && props.actionPending !== undefined" @click="emit('complete-handoff', handoff.handoffId)">{{ props.actionPending === 'complete' ? '保存中…' : '我已完成交接' }}</button>
          <button type="button" data-testid="owner-handoff-cancel" :disabled="props.actionPending !== null && props.actionPending !== undefined" @click="emit('cancel-handoff', handoff.handoffId)">{{ props.actionPending === 'cancel' ? '取消中…' : '取消交接' }}</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-handoff">当前没有需要人工接管的内容。</div>
  </section>
</template>
