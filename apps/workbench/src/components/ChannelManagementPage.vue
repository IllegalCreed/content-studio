<script setup lang="ts">
import { computed } from 'vue'
import type { ChannelId } from '@content-studio/core-types'
import type { ChannelProjection, WorkbenchSnapshot } from '../model'

type ChannelAccount = ChannelProjection['accounts'][number]

const props = defineProps<{
  accountReferenceCount: (channel: ChannelProjection) => number
  channelSnapshotCount: number
  enabledChannels: ChannelProjection[]
  projectAccountFor: (channel: ChannelProjection) => ChannelAccount | null
  selectedChannel: ChannelProjection
  selectedChannelAccount: ChannelAccount | null
  snapshot: WorkbenchSnapshot
}>()

const emit = defineEmits<{
  'go-project': []
  'select-channel': [channelId: ChannelId]
  'select-channel-account': [accountId: string]
}>()

const selectedAccountAction = computed(() => {
  const account = props.selectedChannelAccount
  if (account === null) {
    return props.selectedChannel.health === '未查询'
      ? '尚未查询渠道状态'
      : props.selectedChannel.nextAction ?? '暂无待处理动作'
  }
  if (account.nextAction !== null)
    return account.nextAction
  if (account.statusSource !== 'marketing-ops')
    return '尚未查询该账号状态'
  return account.health === '已就绪' ? '暂无待处理动作' : '请检查账号状态'
})

const selectedMetrics = computed(() =>
  props.selectedChannel.metrics.length > 0
    ? props.selectedChannel.metrics.join('、')
    : '暂无登记的平台指标',
)

const selectedProjectAccount = computed(() => props.projectAccountFor(props.selectedChannel))

const selectedProjectAccountLabel = computed(
  () => selectedProjectAccount.value?.alias ?? '未选择项目账号',
)

const selectedFormatSummary = computed(
  () => `${props.selectedChannel.format} · 标题 ${props.selectedChannel.titleLimit} 字 · 正文 ${props.selectedChannel.bodyLimit} 字`,
)
</script>

<template>
  <section id="channels" class="module-section">
    <div class="section-heading">
      <div><p class="eyebrow">全局控制台 / 发布助手状态</p><h2>渠道管理</h2></div>
      <span>{{ props.snapshot.channelBlueprintCount }} 个全局规格 · {{ props.channelSnapshotCount }} 个状态快照</span>
    </div>
    <p class="section-intro">全局目录定义平台能力和账号；项目选择是否启用并绑定其中一个账号。平台支持的指标是能力说明，不是实时数据；账号健康只有明确标记为 marketing-ops 状态时才视为已查询。</p>
    <div class="channel-overview-grid">
      <div class="channel-overview-card"><span>全局规格</span><strong>{{ props.snapshot.channelBlueprintCount }}</strong><small>文章、短帖和视频信息</small></div>
      <div class="channel-overview-card"><span>项目已启用</span><strong>{{ props.enabledChannels.length }}</strong><small>活动只能选择这些渠道</small></div>
      <div class="channel-overview-card"><span>可自动候选</span><strong>{{ props.snapshot.channels.filter(channel => channel.adapterReady).length }}</strong><small>仍需匹配授权和策略</small></div>
      <div class="channel-overview-card"><span>需要处理</span><strong>{{ props.snapshot.channels.filter(channel => channel.health !== '已就绪').length }}</strong><small>重新授权、阻塞或尚未查询</small></div>
    </div>
    <div class="channel-table" role="table" aria-label="渠道目录">
      <div class="channel-row channel-row-heading" role="row"><span>渠道</span><span>项目状态</span><span>全局账号</span><span>账号引用项目数</span><span>交付和格式</span><span>发布助手状态</span><span>规格</span></div>
      <button v-for="channel in props.snapshot.channels" :key="channel.channel" type="button" class="channel-row" :data-channel-id="channel.channel" :class="{ selected: channel.channel === props.selectedChannel.channel }" role="row" @click="emit('select-channel', channel.channel)">
        <strong>{{ channel.channel }}</strong>
        <span :class="channel.enabled ? 'ready' : 'muted-value'">{{ channel.enabled ? '项目已启用' : '项目未启用' }}</span>
        <span>{{ channel.accounts.length > 0 ? channel.accounts.map(account => account.alias).join('、') : '未绑定账号' }}</span>
        <span>{{ props.accountReferenceCount(channel) }} 个项目</span>
        <span>{{ channel.delivery }} · {{ channel.format }}</span>
        <span class="channel-health" :data-health="channel.health">{{ channel.health }}</span>
        <small>{{ channel.titleLimit }} 字标题 · {{ channel.bodyLimit }} 字正文</small>
      </button>
    </div>
    <article class="channel-detail-card">
      <div class="detail-heading">
        <div><p class="eyebrow">选中渠道 · {{ props.selectedChannel.channel }}</p><h3>{{ props.selectedChannelAccount?.alias ?? props.selectedChannel.alias ?? '未配置账号别名' }}</h3></div>
        <span class="channel-health" :data-health="props.selectedChannelAccount?.health ?? props.selectedChannel.health">{{ props.selectedChannelAccount?.health ?? props.selectedChannel.health }}</span>
      </div>
      <div class="channel-account-panel">
        <div class="channel-account-panel-heading"><div><p class="eyebrow">全局账号</p><strong>{{ props.selectedChannel.accounts.length }} 个账号已配置</strong></div><small>{{ props.projectAccountFor(props.selectedChannel)?.alias ?? '当前项目未选择账号' }}</small></div>
        <div v-if="props.selectedChannel.accounts.length > 0" class="channel-account-list">
          <button v-for="account in props.selectedChannel.accounts" :key="account.accountId" type="button" :data-channel-account-id="account.accountId" :class="{ selected: account.accountId === props.selectedChannelAccount?.accountId }" @click="emit('select-channel-account', account.accountId)">
            <strong>{{ account.alias }}</strong>
            <span>{{ account.assignedProjects.length }} 个项目引用 · {{ account.health }}</span>
          </button>
        </div>
        <p v-else class="empty-channel-accounts">当前项目还没有绑定账号。</p>
        <div v-if="props.selectedChannelAccount" class="channel-account-detail">
          <span>账号状态来源</span><strong>{{ props.selectedChannelAccount.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '项目配置（尚未查询）' }}</strong>
          <span>适配器</span><strong>{{ props.selectedChannelAccount.adapterReady ? '已就绪' : '未就绪' }}</strong>
          <span>待处理动作</span><strong>{{ selectedAccountAction }}</strong>
        </div>
      </div>
      <div class="channel-binding-form channel-project-link channel-project-link-compact" data-testid="channel-project-summary">
        <div class="channel-project-link-copy">
          <p class="eyebrow">当前项目引用</p>
          <strong>{{ props.selectedChannel.enabled ? '已启用 · 活动可选择' : '未启用 · 活动不可选择' }}</strong>
          <small>项目账号：{{ selectedProjectAccountLabel }} · 交付方式：{{ props.selectedChannel.delivery }}</small>
        </div>
        <button type="button" class="primary-button" @click="emit('go-project')">修改项目配置</button>
      </div>
      <div class="channel-detail-grid">
        <div><span>当前项目状态</span><strong>{{ props.selectedChannel.enabled ? '已启用，可作为活动目标' : '未启用，活动不可选择' }}</strong></div>
        <div><span>项目账号</span><strong>{{ selectedProjectAccountLabel }}</strong></div>
        <div><span>交付方式</span><strong>{{ props.selectedChannel.delivery }}</strong></div>
        <div><span>平台格式限制</span><strong>{{ selectedFormatSummary }}</strong></div>
        <div><span>平台支持的指标</span><strong>{{ selectedMetrics }}</strong></div>
        <div><span>账号/适配器状态</span><strong>{{ selectedAccountAction }}</strong></div>
      </div>
      <p class="channel-boundary-note">状态来源：{{ props.selectedChannelAccount?.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '项目配置（尚未读取渠道快照）' }}。这里只展示能力和状态，不保存凭据，也不会因为“已就绪”自动获得发布权限。</p>
    </article>
  </section>
</template>
