<script setup lang="ts">
import type { OwnerHandoffProjection } from '../model'

interface OwnerHandoffListItem extends OwnerHandoffProjection {
  campaignTitle: string
  taskId?: string
}

const props = defineProps<{
  actionError?: string | null
  actionPending?: 'cancel' | 'complete' | 'managed-abandon' | 'managed-confirm' | 'managed-resume' | null
  ownerHandoffs: OwnerHandoffListItem[]
}>()

const emit = defineEmits<{
  'abandon-managed-handoff': [handoffId: string]
  'cancel-handoff': [handoffId: string]
  'confirm-managed-handoff': [handoffId: string]
  'complete-handoff': [handoffId: string]
  'open-task': [taskId: string]
  'resume-managed-handoff': [handoffId: string]
}>()

function handoffStatusLabel(handoff: OwnerHandoffListItem): string {
  if (handoff.handoffKind === 'marketing-ops' && handoff.confirmationStatus === 'pending')
    return '公开地址已锁定，等待确认回执'
  return handoff.status === 'completed'
    ? '已完成，等待回执'
    : handoff.status === 'ready'
      ? '已准备'
    : handoff.status === 'cancelled'
      ? '已取消'
      : handoff.status === 'expired'
        ? '已过期'
        : '待处理'
}

function formatExpiry(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp))
    return '有效时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
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
          <p class="eyebrow">{{ handoff.campaignTitle }} · {{ handoff.channel }} · {{ handoff.accountAlias }} · 发布任务 · {{ handoffStatusLabel(handoff) }}</p>
          <h3>{{ handoff.reason }}</h3>
          <ul class="handoff-checklist"><li v-for="item in handoff.checklist" :key="item">{{ item }}</li></ul>
          <p class="handoff-target">
            官方页面：
            <a
              data-testid="owner-handoff-official"
              :href="handoff.officialTargetUrl"
              target="_blank"
              rel="noreferrer"
            ><code translate="no">{{ handoff.officialTargetUrl }}</code></a>
            · 有效至 {{ formatExpiry(handoff.expiresAt) }}
          </p>
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
        <template v-if="handoff.handoffKind === 'marketing-ops'">
          <p
            class="handoff-managed-note"
            data-testid="owner-handoff-managed-note"
          >此交接由 Content Studio 受管发布流程继续处理。登录、验证码和最终发布仍由你在官方页面完成；界面不会代点，也不接受手填公开地址。</p>
          <p v-if="handoff.publicUrl" class="handoff-target">
            运行时观察到的公开页面：
            <a
              data-testid="owner-handoff-public-url"
              :href="handoff.publicUrl"
              target="_blank"
              rel="noreferrer"
            ><code translate="no">{{ handoff.publicUrl }}</code></a>
          </p>
          <div v-if="handoff.status === 'waiting'" class="handoff-actions">
            <button
              v-if="handoff.confirmationStatus !== 'pending'"
              type="button"
              class="primary-button"
              data-testid="owner-handoff-managed-resume"
              :disabled="props.actionPending !== null && props.actionPending !== undefined"
              @click="emit('resume-managed-handoff', handoff.handoffId)"
            >{{ props.actionPending === 'managed-resume' ? '检查中…' : '检查发布结果' }}</button>
            <button
              v-else
              type="button"
              class="primary-button"
              data-testid="owner-handoff-managed-confirm"
              :disabled="props.actionPending !== null && props.actionPending !== undefined"
              @click="emit('confirm-managed-handoff', handoff.handoffId)"
            >{{ props.actionPending === 'managed-confirm' ? '写入回执中…' : '确认并写入回执' }}</button>
            <button
              type="button"
              data-testid="owner-handoff-managed-abandon"
              :disabled="props.actionPending !== null && props.actionPending !== undefined"
              @click="emit('abandon-managed-handoff', handoff.handoffId)"
            >{{ props.actionPending === 'managed-abandon' ? '放弃中…' : '放弃此次交接' }}</button>
          </div>
        </template>
        <div v-else-if="handoff.status === 'waiting'" class="handoff-actions">
          <button type="button" class="primary-button" data-testid="owner-handoff-complete" :disabled="props.actionPending !== null && props.actionPending !== undefined" @click="emit('complete-handoff', handoff.handoffId)">{{ props.actionPending === 'complete' ? '保存完成状态中…' : '我已完成官方操作' }}</button>
          <button type="button" data-testid="owner-handoff-cancel" :disabled="props.actionPending !== null && props.actionPending !== undefined" @click="emit('cancel-handoff', handoff.handoffId)">{{ props.actionPending === 'cancel' ? '取消中…' : '取消交接' }}</button>
        </div>
      </article>
    </div>
    <div v-else class="empty-handoff">当前没有需要人工接管的内容。</div>
  </section>
</template>
