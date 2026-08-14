import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { snapshot } from '../model'
import PublicationTaskPanel from './PublicationTaskPanel.vue'

describe('publicationTaskPanel', () => {
  it('按选中的发布任务展示交付上下文和人工交接入口', async () => {
    const task = snapshot.tasks.find(candidate => candidate.taskId === 'release-notes-publish-x')!
    const campaign = snapshot.campaigns.find(candidate => candidate.campaignId === 'release-notes')!
    const wrapper = mount(PublicationTaskPanel, {
      props: {
        handoff: campaign.handoffs[0],
        runtimeConnected: false,
        task,
      },
    })

    expect(wrapper.get('[data-testid="publication-task-panel"]').text()).toContain('发布交付')
    expect(wrapper.text()).toContain('版本更新发布')
    expect(wrapper.text()).toContain('Version update overview')
    expect(wrapper.text()).toContain('x')
    expect(wrapper.text()).toContain('Algorithm Visualizer')
    expect(wrapper.get('[data-testid="publication-open-official"]').attributes('href')).toBe('https://x.com/compose/post')

    await wrapper.get('[data-testid="publication-open-owner"]').trigger('click')
    expect(wrapper.emitted('go-owner')).toEqual([[]])
  })

  it('offers a bounded Bilibili prepare action before an owner handoff exists', async () => {
    const task = {
      ...snapshot.tasks.find(candidate => candidate.taskId === 'release-notes-publish-x')!,
      channel: 'bilibili' as const,
      publicationId: 'publication-bilibili-a',
    }
    const wrapper = mount(PublicationTaskPanel, {
      props: {
        runtimeConnected: true,
        task,
      },
    })

    expect(wrapper.text()).toContain('只会打开并填写 Bilibili 官方页面')
    await wrapper.get('[data-testid="publication-prepare-managed"]').trigger('click')
    expect(wrapper.emitted('prepare-managed')).toEqual([[]])
  })

  it('does not offer managed prepare for an unsupported channel or disconnected runtime', () => {
    const unsupported = mount(PublicationTaskPanel, {
      props: {
        runtimeConnected: true,
        task: {
          ...snapshot.tasks.find(candidate => candidate.taskId === 'release-notes-publish-x')!,
          publicationId: 'publication-x-a',
        },
      },
    })
    expect(unsupported.find('[data-testid="publication-prepare-managed"]').exists()).toBe(false)

    const disconnected = mount(PublicationTaskPanel, {
      props: {
        runtimeConnected: false,
        task: {
          ...snapshot.tasks.find(candidate => candidate.taskId === 'release-notes-publish-x')!,
          channel: 'bilibili' as const,
          publicationId: 'publication-bilibili-a',
        },
      },
    })
    expect(disconnected.get('[data-testid="publication-prepare-managed"]').attributes('disabled')).toBeDefined()
  })
})
