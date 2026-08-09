import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { snapshot } from '../model'
import ActivityChannelFormats from './ActivityChannelFormats.vue'

describe('activity channel content forms', () => {
  it('shows per-form media requirements and keeps at least one form selected', async () => {
    const channel = snapshot.channels.find(candidate => candidate.channel === 'bilibili')!
    const wrapper = mount(ActivityChannelFormats, {
      props: {
        channel,
        selectedFormats: ['video-metadata'],
      },
    })

    expect(wrapper.text()).toContain('视频')
    expect(wrapper.text()).toContain('需要 1 个视频')
    expect(wrapper.text()).toContain('图文')
    expect(wrapper.text()).toContain('至少 1 张图片')
    expect(wrapper.text()).toContain('动态')
    expect(wrapper.text()).toContain('可选图片')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(3)
    expect(wrapper.get('input[value="video-metadata"]').attributes())
      .toHaveProperty('disabled')

    await wrapper.get('input[value="image-text"]').trigger('change')

    expect(wrapper.emitted('toggle')).toEqual([['image-text']])
  })
})
