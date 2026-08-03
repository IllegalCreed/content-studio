import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AssetPreview from './AssetPreview.vue'

describe('asset preview', () => {
  it('renders text without interpreting it as html', () => {
    const wrapper = mount(AssetPreview, {
      props: {
        kind: 'text',
        label: '文章版本',
        text: '<script>alert(1)</script>\n正文',
      },
    })

    expect(wrapper.get('[data-testid="asset-preview-text"]').text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it('renders image, video and audio controls from registered preview urls', () => {
    expect(mount(AssetPreview, {
      props: { kind: 'image', label: 'Logo', src: '/preview/logo.png' },
    }).get('img').attributes('src')).toBe('/preview/logo.png')
    expect(mount(AssetPreview, {
      props: { kind: 'video', label: 'Video', src: '/preview/video.mp4' },
    }).get('video').attributes('controls')).toBeDefined()
    expect(mount(AssetPreview, {
      props: { kind: 'audio', label: 'Audio', src: '/preview/audio.mp3' },
    }).get('audio').attributes('controls')).toBeDefined()
  })
})
