<script setup lang="ts">
import SelectMenu from './SelectMenu.vue'
import type { ChannelProjection, WorkbenchSnapshot } from '../model'
import { humanizeActivityStatus } from '../model'

interface ChannelBindingForm {
  accountRef: string
}

const props = defineProps<{
  activityTaskSummary: (activityId: string) => string
  channelBindingForm: ChannelBindingForm
  channelBindingSaveError: string | null
  channelBindingSaving: boolean
  enabledChannels: ChannelProjection[]
  projectAccountAlias: (channel: ChannelProjection) => string | undefined
  projectAccountOptions: readonly { label: string, value: string }[]
  projectAccounts: ChannelProjection['accounts']
  runtimeConnected: boolean
  selectedChannel: ChannelProjection
  snapshot: WorkbenchSnapshot
}>()

const emit = defineEmits<{
  'go-activities': []
  'go-channels': []
  'save-channel-binding': []
  'select-activity': [activityId: string]
  'select-channel': [channel: ChannelProjection['channel']]
}>()
</script>

<template>
  <section id="project" class="module-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">项目空间 / 当前项目</p>
        <h2>{{ props.snapshot.project.name }}</h2>
      </div>
      <span><code>{{ props.snapshot.project.projectId }}</code> · {{ props.snapshot.project.version }}</span>
    </div>
    <p class="section-intro">项目是事实、渠道开关、制作方式、项目素材和发布活动的归属边界。全局渠道只提供能力定义，活动只能选择这里已经启用的渠道。</p>

    <div class="project-overview-grid">
      <article class="module-card project-profile-card">
        <div class="module-card-heading">
          <div><p class="eyebrow">接入方式</p><h3>{{ props.snapshot.project.integrationMode }}</h3></div>
          <span class="status-chip" data-connected="true">{{ props.snapshot.project.recordingMode }}</span>
        </div>
        <dl class="context-list">
          <div><dt>项目事实</dt><dd>{{ props.snapshot.project.version }}</dd></div>
          <div><dt>预览环境</dt><dd class="ready">{{ props.snapshot.project.previewReady ? '可用' : '不可用' }}</dd></div>
          <div><dt>项目语言</dt><dd>{{ props.snapshot.project.locales.join(' / ') }}</dd></div>
          <div><dt>运行时</dt><dd>{{ props.snapshot.runtimeConnected ? '已连接' : '未连接（只读演示）' }}</dd></div>
        </dl>
      </article>
      <article class="module-card">
        <div class="module-card-heading"><div><p class="eyebrow">项目事实摘要</p><h3>录制前先确认这些信息</h3></div><span>只读</span></div>
        <ul class="fact-list"><li v-for="fact in props.snapshot.project.facts" :key="fact">{{ fact }}</li></ul>
      </article>
    </div>

    <div class="project-overview-grid project-overview-grid-lower">
      <article class="module-card">
        <div class="module-card-heading"><div><p class="eyebrow">项目配置投影</p><h3>渠道和素材</h3></div><button type="button" data-testid="project-view-channels" class="primary-button" @click="emit('go-channels')">查看渠道</button></div>
        <div class="project-summary-lines">
          <div><span>已启用渠道</span><strong>{{ props.enabledChannels.length }} / {{ props.snapshot.channelBlueprintCount }}</strong></div>
          <div><span>账号绑定</span><strong>{{ props.projectAccounts.length }} 个</strong></div>
          <div><span>项目素材</span><strong>{{ props.snapshot.projectAssets.length }} 个</strong></div>
          <div><span>活动产物</span><strong>{{ props.snapshot.activityArtifacts.length }} 个</strong></div>
          <div><span>保留策略</span><strong>{{ props.snapshot.storage.retention }}</strong></div>
        </div>
        <div class="project-account-chip-list">
          <span v-for="account in props.projectAccounts" :key="account.accountId"><strong>{{ account.alias }}</strong><small>{{ account.channel }}{{ account.isDefault ? ' · 默认' : '' }}</small></span>
        </div>
      </article>
      <article class="module-card">
        <div class="module-card-heading"><div><p class="eyebrow">发布活动</p><h3>{{ props.snapshot.campaigns.length }} 个主题</h3></div><button type="button" data-testid="project-view-activities" class="primary-button" @click="emit('go-activities')">进入活动</button></div>
        <div class="module-list compact-list">
          <button v-for="campaign in props.snapshot.campaigns" :key="campaign.campaignId" type="button" @click="emit('select-activity', campaign.campaignId)">
            <span class="list-status">{{ humanizeActivityStatus(campaign.activityStatus) }} · {{ props.activityTaskSummary(campaign.campaignId) }}</span>
            <strong>{{ campaign.title }}</strong>
            <small>{{ campaign.topic }}</small>
          </button>
        </div>
      </article>
    </div>

    <section class="module-card project-channel-config" data-testid="project-channel-config">
      <div class="module-card-heading">
        <div><p class="eyebrow">项目空间 / 发布设置</p><h3>项目渠道配置</h3></div>
        <span>{{ props.enabledChannels.length }} 个渠道已启用</span>
      </div>
      <p class="section-intro">这里决定当前项目实际使用哪些全局渠道，以及每个渠道对应的项目账号。发布活动只能选择已启用的渠道。</p>
      <div class="project-channel-config-grid">
        <div class="project-channel-list" role="list" aria-label="项目渠道配置列表">
          <button v-for="channel in props.snapshot.channels" :key="channel.channel" type="button" :data-project-channel-id="channel.channel" :class="{ selected: channel.channel === props.selectedChannel.channel }" @click="emit('select-channel', channel.channel)">
            <span :class="channel.enabled ? 'ready' : 'muted-value'">{{ channel.enabled ? '已启用' : '未启用' }}</span>
            <strong>{{ channel.channel }}</strong>
            <small>{{ channel.delivery === '仅生成内容' ? '仅生成内容 · 无需发布账号' : `${props.projectAccountAlias(channel) ?? '未选择账号'} · ${channel.accounts.length} 个可选账号` }}</small>
          </button>
        </div>
        <div class="channel-binding-form">
          <div class="channel-account-panel-heading">
            <div><p class="eyebrow">当前项目 · {{ props.selectedChannel.channel }}</p><strong>配置项目如何使用该渠道</strong></div>
            <small>{{ props.selectedChannel.delivery === '仅生成内容' ? '无需发布账号' : '只保存不透明账号引用' }}</small>
          </div>
          <div class="channel-binding-fields">
            <label>
              <span>{{ props.selectedChannel.delivery === '仅生成内容' ? '项目使用方式' : '项目账号' }}</span>
              <SelectMenu v-model="props.channelBindingForm.accountRef" data-testid="project-channel-account" aria-label="项目账号" :disabled="!props.runtimeConnected || props.channelBindingSaving" :options="props.projectAccountOptions" />
            </label>
            <div class="channel-binding-readonly" data-testid="project-channel-delivery">
              <span>交付方式</span>
              <strong>{{ props.selectedChannel.delivery }}</strong>
              <small>由全局渠道规格决定，项目不可修改</small>
            </div>
          </div>
          <p v-if="props.channelBindingSaveError" class="form-error" aria-live="polite">{{ props.channelBindingSaveError }}</p>
          <div class="form-actions">
            <small class="form-hint">保存项目配置不会登录渠道、读取凭据或触发发布；仅生成内容渠道不需要绑定账号。</small>
            <button data-testid="save-channel-binding" type="button" class="primary-button" :disabled="!props.runtimeConnected || props.channelBindingSaving" @click="emit('save-channel-binding')">
              {{ props.channelBindingSaving ? '保存中…' : '保存项目渠道配置' }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>
