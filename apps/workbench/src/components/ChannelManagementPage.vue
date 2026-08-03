<script setup lang="ts">
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
</script>

<template>
  <section id="channels" class="module-section">
    <div class="section-heading">
      <div><p class="eyebrow">全局控制台 / 发布助手状态</p><h2>渠道管理</h2></div>
      <span>{{ props.snapshot.channelBlueprintCount }} 个全局规格 · {{ props.channelSnapshotCount }} 个状态快照</span>
    </div>
    <p class="section-intro">全局目录定义平台能力和账号；项目选择是否启用并绑定其中一个账号。右侧状态来自 marketing-ops 的只读渠道检查，健康不等于拥有发布权限。</p>
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
          <span>下一步</span><strong>{{ props.selectedChannelAccount.nextAction ?? '保持状态快照' }}</strong>
        </div>
      </div>
      <div class="channel-binding-form channel-project-link">
        <div class="channel-account-panel-heading">
          <div><p class="eyebrow">项目级设置</p><strong>项目渠道配置不在全局目录中修改</strong></div>
          <small>全局页只查看平台能力和状态</small>
        </div>
        <p class="channel-boundary-note">每个项目选择哪个账号、是否使用该渠道和交付方式，请到当前项目的“项目概览”里配置。</p>
        <div class="form-actions">
          <small class="form-hint">这里不会修改项目绑定。</small>
          <button type="button" class="primary-button" @click="emit('go-project')">去项目配置</button>
        </div>
      </div>
      <div class="channel-detail-grid">
        <div><span>项目策略</span><strong>{{ props.selectedChannel.enabled ? '允许作为活动目标' : '未启用' }}</strong></div>
        <div><span>可监测指标</span><strong>{{ props.selectedChannel.metrics.join('、') }}</strong></div>
        <div><span>下一步</span><strong>{{ props.selectedChannelAccount?.nextAction ?? props.selectedChannel.nextAction ?? '保持渠道状态快照' }}</strong></div>
      </div>
      <p class="channel-boundary-note">状态来源：{{ props.selectedChannelAccount?.statusSource === 'marketing-ops' ? 'marketing-ops 只读快照' : '项目配置（尚未读取渠道快照）' }}。这里只展示能力和状态，不保存凭据，也不会因为“已就绪”自动获得发布权限。</p>
    </article>
  </section>
</template>
