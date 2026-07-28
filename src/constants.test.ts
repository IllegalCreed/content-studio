import { describe, expect, it } from 'vitest'
import { CHANNEL_BLUEPRINTS } from './constants'

describe('channel blueprints', () => {
  it('covers the 19-channel content inventory without widening publishing authority', () => {
    expect(Object.keys(CHANNEL_BLUEPRINTS)).toHaveLength(19)
    expect(CHANNEL_BLUEPRINTS.github.delivery).toBe('automatic-candidate')
    expect(CHANNEL_BLUEPRINTS.x.delivery).toBe('owner-assisted')
    expect(CHANNEL_BLUEPRINTS.bilibili.format).toBe('video-metadata')
    expect(CHANNEL_BLUEPRINTS.wechat.delivery).toBe('content-only')
    expect(CHANNEL_BLUEPRINTS.xiaohongshu.delivery).toBe('content-only')
  })
})
