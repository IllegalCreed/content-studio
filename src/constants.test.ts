import { describe, expect, it } from 'vitest'
import {
  CHANNEL_BLUEPRINTS,
  MARKETING_OPS_PACKAGE_FORMAT_VALUES,
  MARKETING_OPS_PACKAGE_FORMATS,
  MARKETING_OPS_STATUS_REFRESH_INTERVAL_MS,
  MARKETING_OPS_STATUS_TTL_MS,
} from './constants'

describe('channel blueprints', () => {
  it('covers the 19-channel content inventory without widening publishing authority', () => {
    expect(Object.keys(CHANNEL_BLUEPRINTS)).toHaveLength(19)
    expect(CHANNEL_BLUEPRINTS.github.delivery).toBe('automatic-candidate')
    expect(CHANNEL_BLUEPRINTS.x.delivery).toBe('owner-assisted')
    expect(CHANNEL_BLUEPRINTS.bilibili.format).toBe('video-metadata')
    expect(CHANNEL_BLUEPRINTS.bilibili.supportedFormats).toEqual([
      'video-metadata',
      'image-text',
      'short-post',
    ])
    expect(CHANNEL_BLUEPRINTS.bilibili.contentForms).toEqual([
      expect.objectContaining({
        format: 'video-metadata',
        media: {
          allowedKinds: ['video'],
          maxCount: 1,
          minCount: 1,
        },
      }),
      expect.objectContaining({
        format: 'image-text',
        media: {
          allowedKinds: ['image'],
          minCount: 1,
        },
      }),
      expect.objectContaining({
        format: 'short-post',
        media: {
          allowedKinds: ['image'],
          minCount: 0,
        },
      }),
    ])
    for (const blueprint of Object.values(CHANNEL_BLUEPRINTS)) {
      expect(blueprint.contentForms.map(form => form.format))
        .toEqual(blueprint.supportedFormats)
      expect(blueprint.contentForms[0]?.format).toBe(blueprint.format)
    }
    expect(CHANNEL_BLUEPRINTS.wechat.delivery).toBe('content-only')
    expect(CHANNEL_BLUEPRINTS.xiaohongshu.delivery).toBe('content-only')
  })

  it('keeps the marketing-ops renderer format enum aligned with channel mappings', () => {
    expect(new Set(Object.values(MARKETING_OPS_PACKAGE_FORMATS)))
      .toEqual(new Set(MARKETING_OPS_PACKAGE_FORMAT_VALUES))
  })

  it('refreshes marketing-ops status before its read-only snapshot expires', () => {
    expect(MARKETING_OPS_STATUS_REFRESH_INTERVAL_MS).toBeGreaterThan(0)
    expect(MARKETING_OPS_STATUS_REFRESH_INTERVAL_MS).toBeLessThan(
      MARKETING_OPS_STATUS_TTL_MS,
    )
  })
})
