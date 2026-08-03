<script setup lang="ts">
import { computed } from 'vue'
import type { ChannelId } from '@content-studio/core-types'
import {
  isPublishingAssistantChannel,
  type ChannelProjection,
  type WorkbenchSnapshot,
} from '../model'

type ChannelAccount = ChannelProjection['accounts'][number]

const props = defineProps<{
  accountReferenceCount: (channel: ChannelProjection) => number
  channelSnapshotCount: number
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
  if (!isPublishingAssistantChannel(props.selectedChannel))
    return '不进入发布助手'
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

const selectedFormatSummary = computed(
  () => `${props.selectedChannel.format} · 标题 ${props.selectedChannel.titleLimit} 字 · 正文 ${props.selectedChannel.bodyLimit} 字`,
)

const publishingChannels = computed(() =>
  props.snapshot.channels.filter(channel => isPublishingAssistantChannel(channel)),
)

const contentOnlyChannels = computed(() =>
  props.snapshot.channels.filter(channel => !isPublishingAssistantChannel(channel)),
)

const channelsNeedingAttention = computed(() =>
  publishingChannels.value.filter(channel => channel.health !== '已就绪'),
)

const globalAccountCount = computed(() =>
  props.snapshot.channels.reduce((total, channel) => total + channel.accounts.length, 0),
)

const selectedChannelReferenceCount = computed(() =>
  props.selectedChannelAccount?.assignedProjects.length ?? 0,
)
</script>

<template>
  <section id="channels" class="module-section">
    <div class="section-heading">
      <div><p class="eyebrow">全局控制台 / 渠道目录</p><h2>全局渠道目录</h2></div>
      <span>{{ props.snapshot.channelBlueprintCount }} 个全局规格 · {{ props.channelSnapshotCount }} 个发布状态快照</span>
    </div>
    <p class="section-intro">这里维护跨项目的平台规格和全局账号。项目是否启用渠道、绑定哪个账号，在项目配置中设置；“仅生成内容”渠道不会进入发布助手。</p>
    <div class="channel-overview-grid">
      <div class="channel-overview-card"><span>全局渠道规格</span><strong>{{ props.snapshot.channelBlueprintCount }}</strong><small>跨项目复用的平台能力</small></div>
      <div class="channel-overview-card"><span>可进入发布助手</span><strong>{{ publishingChannels.length }}</strong><small>全自动候选或人工辅助</small></div>
      <div class="channel-overview-card"><span>仅生成内容</span><strong>{{ contentOnlyChannels.length }}</strong><small>不绑定发布账号</small></div>
      <div class="channel-overview-card"><span>发布助手待处理</span><strong>{{ channelsNeedingAttention.length }}</strong><small>账号、授权或状态需要处理</small></div>
    </div>
    <div class="channel-directory-note" data-testid="channel-directory-note">
      <strong>项目配置不在全局目录中修改</strong>
      <span>当前项目启用哪些渠道、每个渠道绑定哪个账号，只在项目渠道配置中决定。全局目录只展示账号和被项目引用数量。</span>
      <span>{{ globalAccountCount }} 个全局账号已登记 · 平台状态来自 marketing-ops 只读快照</span>
    </div>
    <div class="channel-table" role="table" aria-label="渠道目录">
      <div class="channel-row channel-row-heading" role="row"><span>渠道</span><span>交付范围</span><span>全局账号</span><span>账号引用项目数</span><span>内容格式</span><span>发布助手状态</span><span>规格</span></div>
      <button v-for="channel in props.snapshot.channels" :key="channel.channel" type="button" class="channel-row" :data-channel-id="channel.channel" :class="{ selected: channel.channel === props.selectedChannel.channel }" role="row" @click="emit('select-channel', channel.channel)">
        <strong>{{ channel.channel }}</strong>
        <span>{{ channel.delivery }}</span>
        <span>{{ !isPublishingAssistantChannel(channel) ? '不需要发布账号' : channel.accounts.length > 0 ? channel.accounts.map(account => account.alias).join('、') : '未配置全局账号' }}</span>
        <span>{{ props.accountReferenceCount(channel) }} 个项目</span>
        <span>{{ channel.format }}</span>
        <span class="channel-health" :data-health="channel.health">{{ isPublishingAssistantChannel(channel) ? channel.health : '不进入发布助手' }}</span>
        <small>{{ channel.titleLimit }} 字标题 · {{ channel.bodyLimit }} 字正文</small>
      </button>
    </div>
    <article class="channel-detail-card">
      <div class="detail-heading">
        <div><p class="eyebrow">选中渠道 · {{ props.selectedChannel.channel }}</p><h3>{{ props.selectedChannelAccount?.alias ?? props.selectedChannel.alias ?? '未配置账号别名' }}</h3></div>
        <span class="channel-health" :data-health="props.selectedChannel.health">{{ isPublishingAssistantChannel(props.selectedChannel) ? (props.selectedChannelAccount?.health ?? props.selectedChannel.health) : '不进入发布助手' }}</span>
      </div>
      <div class="channel-account-panel">
        <div class="channel-account-panel-heading"><div><p class="eyebrow">全局账号</p><strong>{{ props.selectedChannel.accounts.length }} 个账号已配置</strong></div><small>{{ isPublishingAssistantChannel(props.selectedChannel) ? '账号身份和授权由 marketing-ops 管理' : '仅生成内容，不配置发布账号' }}</small></div>
        <div v-if="props.selectedChannel.accounts.length > 0" class="channel-account-list">
          <button v-for="account in props.selectedChannel.accounts" :key="account.accountId" type="button" :data-channel-account-id="account.accountId" :class="{ selected: account.accountId === props.selectedChannelAccount?.accountId }" @click="emit('select-channel-account', account.accountId)">
            <strong>{{ account.alias }}</strong>
            <span>{{ account.assignedProjects.length }} 个项目引用 · {{ account.health }}</span>
          </button>
        </div>
        <p v-else class="empty-channel-accounts">{{ isPublishingAssistantChannel(props.selectedChannel) ? '当前渠道还没有配置全局账号。' : '该渠道只生成内容，无需配置发布账号。' }}</p>
        <div v-if="props.selectedChannelAccount" class="channel-account-detail">
          <span>账号状态来源</span><strong>{{ props.selectedChannelAccount.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '尚未读取该账号状态' }}</strong>
          <span>适配器</span><strong>{{ props.selectedChannelAccount.adapterReady ? '已就绪' : '未就绪' }}</strong>
          <span>待处理动作</span><strong>{{ selectedAccountAction }}</strong>
        </div>
      </div>
      <div class="channel-binding-form channel-project-link channel-project-link-compact">
        <div class="channel-project-link-copy">
          <p class="eyebrow">项目级设置</p>
          <strong>项目启用和账号绑定请到项目配置</strong>
          <small>活动只能选择项目已启用的渠道；这里不展示某个项目的启用数量。</small>
        </div>
        <button type="button" class="primary-button" @click="emit('go-project')">进入项目渠道配置</button>
      </div>
      <div class="channel-detail-grid">
        <div><span>交付范围</span><strong>{{ props.selectedChannel.delivery }}</strong></div>
        <div><span>全局账号数</span><strong>{{ props.selectedChannel.accounts.length }}</strong></div>
        <div><span>账号引用项目数</span><strong>{{ selectedChannelReferenceCount }}</strong></div>
        <div><span>平台格式限制</span><strong>{{ selectedFormatSummary }}</strong></div>
        <div><span>平台支持的指标</span><strong>{{ selectedMetrics }}</strong></div>
        <div><span>账号/适配器状态</span><strong>{{ selectedAccountAction }}</strong></div>
      </div>
      <p class="channel-boundary-note">{{ isPublishingAssistantChannel(props.selectedChannel) ? `状态来源：${props.selectedChannelAccount?.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '尚未读取该渠道的 marketing-ops 状态'}。` : '该渠道只生成内容，不读取 marketing-ops 账号状态，也不创建发布任务。' }} 这里只展示能力和状态，不保存凭据，也不会因为“已就绪”自动获得发布权限。</p>
    </article>
  </section>
</template>
