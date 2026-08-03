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

  it('在媒体加载元数据后显示尺寸和时长', async () => {
    const video = mount(AssetPreview, {
      props: { kind: 'video', label: 'Video', src: '/preview/video.mp4' },
    })
    const videoElement = video.get('video').element as HTMLVideoElement
    Object.defineProperties(videoElement, {
      duration: { configurable: true, value: 12.5 },
      videoHeight: { configurable: true, value: 1080 },
      videoWidth: { configurable: true, value: 1920 },
    })
    await video.get('video').trigger('loadedmetadata')

    expect(video.get('[data-testid="asset-preview-metadata"]').text()).toContain('1920 × 1080')
    expect(video.get('[data-testid="asset-preview-metadata"]').text()).toContain('0:13')
  })
})
