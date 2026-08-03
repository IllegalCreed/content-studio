<script setup lang="ts">
import type {
  ChannelId,
  VideoFormat,
} from '@content-studio/core-types'
import SelectMenu from './SelectMenu.vue'
import type {
  CampaignProjection,
  ChannelContentProjection,
  ChannelProjection,
  WorkbenchSnapshot,
} from '../model'
import { humanizeActivityStatus, humanizeStatus } from '../model'

interface ActivityForm {
  channels: ChannelId[]
  topic: string
  videoEnabled: boolean
  videoFormat: VideoFormat
  videoHeight: number
  videoWidth: number
}

interface ContentForm {
  body: string
  channel: ChannelId
  coreMessage: string
  format: 'article' | 'video'
  locale: 'en' | 'zh-CN'
  title: string
}

const props = defineProps<{
  activityComposerOpen: boolean
  activityForm: ActivityForm
  activitySaveError: string | null
  activitySaving: boolean
  canConfirmSelectedVideoPlan: boolean
  canReviseSelectedVideoPlan: boolean
  contentComposerOpen: boolean
  contentFormatOptions: readonly { label: string, value: string }[]
  contentForm: ContentForm
  contentLocaleOptions: readonly { label: string, value: string }[]
  contentSaveError: string | null
  contentSaving: boolean
  enabledChannels: ChannelProjection[]
  hasPublicationTask: (contentId: string) => boolean
  projectAccountAlias: (channel: ChannelProjection) => string | undefined
  selectedCampaign: CampaignProjection
  selectedCampaignChannelOptions: readonly { label: string, value: string }[]
  selectedCampaignContentCounts: {
    article: number
    artifacts: number
    video: number
  }
  selectedCampaignIsRuntime: boolean
  selectedCampaignTaskCounts: {
    monitoring: number
    production: number
    publication: number
  }
  selectedCampaignTasks: WorkbenchSnapshot['tasks']
  snapshot: WorkbenchSnapshot
  videoFormatOptions: readonly { label: string, value: string }[]
  videoPlanActionError: string | null
  videoPlanActionPending: boolean
  videoPlanRevisionError: string | null
  videoPlanRevisionPending: boolean
  videoPlanViewportDraft: { height: number, width: number }
  publicationPlanActionError: string | null
  publicationPlanActionPending: string | null
}>()

const emit = defineEmits<{
  'apply-activity-video-format': [format: string]
  'close-activity-composer': []
  'close-content-composer': []
  'confirm-video-plan': []
  'create-publication-plan': [content: ChannelContentProjection]
  'open-activity-detail': [activityId: string]
  'open-content-composer': []
  'revise-video-plan': []
  'save-activity': []
  'save-channel-content': []
  'select-task': [taskId: string]
}>()
</script>

<template>
  <section id="activities" class="module-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">项目业务对象</p>
        <h2>发布活动</h2>
      </div>
      <span>{{ props.snapshot.campaigns.length }} 个活动</span>
    </div>
    <p class="section-intro">活动围绕一次主题组织内容组、渠道内容、活动产物和发布安排，执行任务会从这里投影出去。</p>

    <form v-if="props.activityComposerOpen" class="activity-composer" @submit.prevent="emit('save-activity')">
      <div class="section-heading">
        <div><p class="eyebrow">本地应用服务</p><h3>新建发布活动</h3></div>
        <span>先保存业务对象，AI 内容生成随后接入</span>
      </div>
      <div class="activity-composer-grid">
        <label>
          活动主题
          <input v-model="props.activityForm.topic" name="activity-topic" required placeholder="例如：用动画理解快速排序的分区过程" />
        </label>
        <fieldset class="channel-choice-field">
          <legend>目标渠道（可多选）</legend>
          <label v-for="channel in props.enabledChannels" :key="channel.channel" class="channel-choice">
            <input v-model="props.activityForm.channels" :name="'activity-channel-' + channel.channel" type="checkbox" :value="channel.channel" />
            <span><strong>{{ channel.channel }}</strong><small>{{ props.projectAccountAlias(channel) ?? '项目账号待绑定' }}</small></span>
          </label>
          <small v-if="props.enabledChannels.length === 0" class="form-hint">请先在渠道管理中启用项目渠道。</small>
        </fieldset>
        <label class="video-plan-toggle field-wide">
          <span>
            <input v-model="props.activityForm.videoEnabled" name="activity-video-enabled" type="checkbox" />
            <strong>同时建立视频制作计划</strong>
          </span>
          <small>会把当前项目登记的拍摄流程交给 AI/录制任务继续生成。</small>
        </label>
        <fieldset v-if="props.activityForm.videoEnabled" class="video-plan-fields field-wide">
          <legend>视频录制配置</legend>
          <label>
            画幅
            <SelectMenu v-model="props.activityForm.videoFormat" aria-label="视频画幅" :options="props.videoFormatOptions" @update:model-value="emit('apply-activity-video-format', $event)" />
          </label>
          <label>
            录制宽度（CSS 像素）
            <input v-model.number="props.activityForm.videoWidth" name="activity-video-width" min="320" max="3840" required type="number" />
          </label>
          <label>
            录制高度（CSS 像素）
            <input v-model.number="props.activityForm.videoHeight" name="activity-video-height" min="320" max="3840" required type="number" />
          </label>
          <p class="form-hint field-wide">尺寸会同时用于目标网站视口和 Playwright 录制文件，保存时还会经过服务端安全校验。</p>
        </fieldset>
      </div>
      <p v-if="props.activitySaveError" class="form-error" aria-live="polite">{{ props.activitySaveError }}</p>
      <div class="form-actions">
        <button type="button" @click="emit('close-activity-composer')">取消</button>
        <button type="submit" class="primary-button" :disabled="props.activitySaving">
          {{ props.activitySaving ? '保存中…' : '保存发布活动' }}
        </button>
      </div>
    </form>

    <form v-if="props.contentComposerOpen" class="activity-composer content-composer" @submit.prevent="emit('save-channel-content')">
      <div class="section-heading">
        <div><p class="eyebrow">当前活动 / 渠道内容</p><h3>保存一条内容版本</h3></div>
        <span>手动测试入口 · AI/MCP 接入后复用同一接口</span>
      </div>
      <div class="activity-composer-grid">
        <label>
          内容标题
          <input v-model="props.contentForm.title" name="content-title" required placeholder="例如：理解分区操作" />
        </label>
        <label>
          目标渠道
          <SelectMenu v-model="props.contentForm.channel" aria-label="目标渠道" :options="props.selectedCampaignChannelOptions" />
        </label>
        <label>
          内容形式
          <SelectMenu v-model="props.contentForm.format" aria-label="内容形式" :options="props.contentFormatOptions" />
        </label>
        <label>
          语言
          <SelectMenu v-model="props.contentForm.locale" aria-label="语言" :options="props.contentLocaleOptions" />
        </label>
        <label class="field-wide">
          内容组核心信息
          <input v-model="props.contentForm.coreMessage" name="content-core-message" required placeholder="这一组内容要让用户记住什么？" />
        </label>
        <label class="field-wide">
          正文或视频脚本摘要
          <textarea v-model="props.contentForm.body" name="content-body" required rows="5" placeholder="先写入一版可审核内容，后续 AI 会生成正式版本。" />
        </label>
      </div>
      <p v-if="props.contentSaveError" class="form-error" aria-live="polite">{{ props.contentSaveError }}</p>
      <div class="form-actions">
        <button type="button" @click="emit('close-content-composer')">取消</button>
        <button type="submit" class="primary-button" :disabled="props.contentSaving">
          {{ props.contentSaving ? '保存中…' : '保存渠道内容' }}
        </button>
      </div>
    </form>

    <div class="campaign-board">
      <div class="campaign-list" role="list" aria-label="发布活动">
        <button
          v-for="campaign in props.snapshot.campaigns"
          :key="campaign.campaignId"
          type="button"
          :data-campaign-id="campaign.campaignId"
          :class="{ selected: campaign.campaignId === props.selectedCampaign.campaignId }"
          @click="emit('open-activity-detail', campaign.campaignId)"
        >
          <span class="campaign-status" :data-status="campaign.activityStatus">{{ humanizeActivityStatus(campaign.activityStatus) }}</span>
          <strong>{{ campaign.title }}</strong>
          <small>{{ campaign.channels.length }} 个渠道 · {{ campaign.activityArtifacts.length }} 个活动产物</small>
          <span class="arrow">↗</span>
        </button>
      </div>
      <p v-if="props.snapshot.campaigns.length === 0" class="empty-state campaign-empty-state">
        当前运行时还没有发布活动。可以点击右上角“新建发布活动”，先保存主题和项目渠道。
      </p>
      <article v-else class="campaign-detail">
        <div class="detail-heading">
          <div>
            <p class="eyebrow">当前活动</p>
            <h2 data-testid="selected-campaign-title">{{ props.selectedCampaign.title }}</h2>
          </div>
          <div class="detail-heading-actions">
            <span class="asset-count">{{ props.selectedCampaign.activityArtifacts.length }} 个活动产物</span>
            <button type="button" class="primary-button" data-testid="activity-detail-link" @click="emit('open-activity-detail', props.selectedCampaign.campaignId)">打开活动详情</button>
          </div>
        </div>
        <div class="activity-status-line">
          <span class="task-status">{{ humanizeActivityStatus(props.selectedCampaign.activityStatus) }}</span>
          <span class="activity-topic">{{ props.selectedCampaign.topic }}</span>
        </div>
        <div class="activity-structure-note">
          <span>活动状态只描述主题本身</span>
          <strong>任务阶段请在任务面板查看</strong>
        </div>
        <div class="activity-execution-summary" aria-label="活动执行记录摘要">
          <div><span>制作任务</span><strong>{{ props.selectedCampaignTaskCounts.production }}</strong></div>
          <div><span>发布任务</span><strong>{{ props.selectedCampaignTaskCounts.publication }}</strong></div>
          <div><span>监测任务</span><strong>{{ props.selectedCampaignTaskCounts.monitoring }}</strong></div>
        </div>
        <section
          v-if="props.selectedCampaign.videoPlan"
          class="shooting-plan-card"
          data-testid="shooting-plan"
        >
          <div class="shooting-plan-heading">
            <div>
              <p class="eyebrow">制作计划</p>
              <h3>拍摄大纲</h3>
            </div>
            <span class="plan-review-status" :data-status="props.selectedCampaign.videoPlan.reviewStatus">
              {{ props.selectedCampaign.videoPlan.reviewStatus }}
            </span>
          </div>
          <div class="shooting-plan-meta">
            <span>第 {{ props.selectedCampaign.videoPlan.planVersion }} 版</span>
            <span>{{ props.selectedCampaign.videoPlan.format }} · {{ props.selectedCampaign.videoPlan.scenes.length }} 个场景</span>
            <span>录制视口 {{ props.selectedCampaign.videoPlan.viewport.width }} × {{ props.selectedCampaign.videoPlan.viewport.height }}</span>
          </div>
          <div v-if="props.selectedCampaignIsRuntime" class="video-viewport-editor">
            <div>
              <p class="eyebrow">调整本次活动的录制尺寸</p>
              <small>保存后会生成新版本，并重新等待确认；不会修改项目源代码。</small>
            </div>
            <div class="video-viewport-fields">
              <label>
                宽度
                <input v-model.number="props.videoPlanViewportDraft.width" name="video-plan-width" min="320" max="3840" type="number" />
              </label>
              <label>
                高度
                <input v-model.number="props.videoPlanViewportDraft.height" name="video-plan-height" min="320" max="3840" type="number" />
              </label>
              <button
                type="button"
                class="primary-button"
                :disabled="!props.canReviseSelectedVideoPlan"
                @click="emit('revise-video-plan')"
              >
                {{ props.videoPlanRevisionPending ? '保存中…' : '保存尺寸并生成新版本' }}
              </button>
            </div>
            <p v-if="props.videoPlanRevisionError" class="form-error" aria-live="polite">{{ props.videoPlanRevisionError }}</p>
          </div>
          <ol class="shooting-plan-scenes">
            <li v-for="(scene, index) in props.selectedCampaign.videoPlan.scenes" :key="scene.flowId">
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <strong>{{ scene.title }}</strong>
                <small>{{ scene.objective }}</small>
                <code>{{ scene.flowId }} · {{ scene.startPath }}</code>
              </div>
            </li>
          </ol>
          <div class="shooting-plan-actions">
            <p>
              <span v-if="props.videoPlanActionError" class="task-action-error">{{ props.videoPlanActionError }}</span>
              <span v-else-if="!props.selectedCampaignIsRuntime">演示活动只读，真实活动确认后会写入本地版本。</span>
              <span v-else-if="props.selectedCampaign.videoPlan.reviewStatus === '已确认'">已确认，后续录制沿用这个版本。</span>
              <span v-else>确认后才能把这版大纲交给制作任务执行。</span>
            </p>
            <button
              type="button"
              class="primary-button"
              data-testid="confirm-video-plan"
              :disabled="!props.canConfirmSelectedVideoPlan"
              @click="emit('confirm-video-plan')"
            >
              {{ props.videoPlanActionPending ? '确认中…' : props.selectedCampaign.videoPlan.reviewStatus === '已确认' ? '已确认' : '确认拍摄大纲' }}
            </button>
          </div>
        </section>
        <div class="content-type-grid">
          <div><span>文章成品</span><strong>{{ props.selectedCampaignContentCounts.article }}</strong><small>按渠道分别生成</small></div>
          <div><span>视频成品</span><strong>{{ props.selectedCampaignContentCounts.video }}</strong><small>素材组装后发布</small></div>
          <div><span>活动素材</span><strong>{{ props.selectedCampaignContentCounts.artifacts }}</strong><small>引用的项目或活动产物</small></div>
          <div><span>目标渠道</span><strong>{{ props.selectedCampaign.channels.length }}</strong><small>账号由项目绑定</small></div>
        </div>
        <div class="detail-footer">
          <div><span>下一步</span><p>{{ props.selectedCampaign.nextAction }}</p></div>
          <ul aria-label="活动渠道">
            <li v-for="channel in props.selectedCampaign.channels" :key="channel">{{ channel }}</li>
          </ul>
        </div>
        <div class="activity-detail-grid">
          <div>
            <div class="module-card-heading">
              <p class="eyebrow">内容素材与渠道成品</p>
              <button type="button" :disabled="!props.snapshot.runtimeConnected" @click="emit('open-content-composer')">
                {{ props.snapshot.runtimeConnected ? '新增渠道内容' : '等待运行时' }}
              </button>
            </div>
            <p v-if="props.selectedCampaign.contentGroups.length === 0" class="empty-state">当前活动还没有内容版本。可以先保存一条手动测试内容，之后由 AI/MCP 复用同一个内容接口。</p>
            <p v-if="props.publicationPlanActionError" class="form-error" aria-live="polite">{{ props.publicationPlanActionError }}</p>
            <div class="content-group-list">
              <article v-for="group in props.selectedCampaign.contentGroups" :key="group.contentGroupId" class="content-group-card">
                <strong>{{ group.title }}</strong>
                <small>{{ group.coreMessage }}</small>
                <ul>
                  <li v-for="content in group.contents" :key="content.contentId">
                    <span>{{ content.format }}成品 · {{ content.channel }} · {{ content.accountAlias ?? '项目账号待绑定' }}</span>
                    <strong>{{ content.title }}</strong>
                    <small>{{ content.locale }} · {{ content.status }}</small>
                    <details v-if="content.body" class="content-preview-details">
                      <summary>查看文字预览</summary>
                      <pre>{{ content.body }}</pre>
                    </details>
                    <button
                      type="button"
                      class="content-action-button"
                      :disabled="!props.selectedCampaignIsRuntime || !props.snapshot.runtimeConnected || props.hasPublicationTask(content.contentId) || props.publicationPlanActionPending !== null"
                      @click="emit('create-publication-plan', content)"
                    >
                      {{ props.publicationPlanActionPending === content.contentId ? '创建中…' : props.hasPublicationTask(content.contentId) ? '已建立发布安排' : '建立发布安排' }}
                    </button>
                  </li>
                </ul>
              </article>
            </div>
          </div>
          <div>
            <p class="eyebrow">关联执行任务</p>
            <div class="related-task-list">
              <button v-for="task in props.selectedCampaignTasks" :key="task.taskId" type="button" @click="emit('select-task', task.taskId)">
                <span>{{ task.kind }} · {{ humanizeStatus(task.status) }}</span>
                <strong>{{ task.title }}</strong>
                <small>{{ task.contentTitle }} · {{ task.channel }} · {{ task.accountAlias }}</small>
              </button>
            </div>
          </div>
        </div>
        <div class="activity-artifacts-row">
          <div>
            <p class="eyebrow">活动引用的素材</p>
            <div class="chip-list">
              <span v-for="assetId in props.selectedCampaign.referencedAssets" :key="assetId">{{ props.snapshot.projectAssets.find(asset => asset.assetId === assetId)?.name ?? assetId }}</span>
            </div>
          </div>
          <div>
            <p class="eyebrow">活动生成的素材与成品</p>
            <div class="chip-list">
              <span v-for="artifact in props.selectedCampaign.activityArtifacts" :key="artifact.artifactId">{{ artifact.name }} · {{ artifact.status }}</span>
            </div>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
