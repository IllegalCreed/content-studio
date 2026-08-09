import type { WorkbenchSnapshot } from '../model'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { snapshot as snapshotSeed } from '../model'
import ActivityListPage from './ActivityListPage.vue'

describe('activity list channel media revision', () => {
  it('opens a controlled final-media picker and emits versioned revision actions', async () => {
    const snapshot = structuredClone(snapshotSeed)
    snapshot.runtimeConnected = true
    const campaign = snapshot.campaigns[0]!
    const content = campaign.contentGroups[0]!.contents[0]!
    content.artifactIds = []
    content.version = 1
    snapshot.campaigns = [campaign]
    const wrapper = mount(ActivityListPage, {
      props: {
        activityComposerOpen: false,
        activityForm: {
          channels: [],
          contentFormats: {},
          topic: '',
          videoEnabled: false,
          videoFormat: 'landscape',
          videoHeight: 1080,
          videoWidth: 1920,
        },
        activitySaveError: null,
        activitySaving: false,
        canConfirmSelectedVideoPlan: false,
        canPublishContent: () => true,
        canReviseSelectedVideoPlan: false,
        contentComposerOpen: false,
        contentFormatOptions: [],
        contentForm: {
          body: '',
          channel: 'bilibili',
          coreMessage: '',
          format: 'video',
          locale: 'zh-CN',
          title: '',
        },
        contentLocaleOptions: [],
        contentSaveError: null,
        contentSaving: false,
        enabledChannels: [],
        hasPublicationTask: () => false,
        mediaRevisionArtifactIds: [],
        mediaRevisionContent: null,
        mediaRevisionError: null,
        mediaRevisionMode: 'append',
        mediaRevisionPending: false,
        projectAccountAlias: () => undefined,
        publicationPlanActionError: null,
        publicationPlanActionPending: null,
        runtimeConnected: true,
        runtimeLoading: false,
        selectedCampaign: campaign,
        selectedCampaignChannelOptions: [],
        selectedCampaignContentCounts: {
          article: 1,
          artifacts: 0,
          imageText: 0,
          shortPost: 0,
          video: 1,
        },
        selectedCampaignIsRuntime: true,
        selectedCampaignTaskCounts: {
          monitoring: 0,
          production: 0,
          publication: 0,
        },
        selectedCampaignTasks: [],
        snapshot: snapshot as WorkbenchSnapshot,
        videoFormatOptions: [],
        videoPlanActionError: null,
        videoPlanActionPending: false,
        videoPlanRevisionError: null,
        videoPlanRevisionPending: false,
        videoPlanViewportDraft: { height: 1080, width: 1920 },
      },
    })

    const row = wrapper.findAll('.content-group-card li')
      .find(candidate => candidate.text().includes(content.title))!
    await row.get('.content-media-action-button').trigger('click')
    expect(wrapper.emitted('open-media-revision')).toEqual([[content]])

    await wrapper.setProps({
      mediaRevisionContent: content,
      mediaRevisionMode: 'replace',
    })
    const panel = wrapper.get('[data-testid="content-media-revision"]')
    expect(panel.text()).toContain('只允许选择当前活动已登记的最终图片或视频')
    expect(panel.text()).toContain('快速排序演示 · 竖屏版本')
    await panel.get('input[value="quick-sort-video-final"]').trigger('change')
    expect(wrapper.emitted('toggle-media-revision-artifact'))
      .toEqual([['quick-sort-video-final']])
    await panel.trigger('submit')
    expect(wrapper.emitted('save-media-revision')).toHaveLength(1)
  })
})
