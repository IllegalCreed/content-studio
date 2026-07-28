import type {
  CaptureStep,
  ChannelBlueprint,
  ChannelId,
  VideoFormat,
} from './types'

export const CHANNEL_BLUEPRINTS = {
  'bilibili': blueprint('owner-assisted', 'video-metadata', 80, 2000),
  'bluesky': blueprint('automatic-candidate', 'short-post', 80, 300),
  'dev': blueprint('automatic-candidate', 'article', 128, 12000),
  'douyin': blueprint('owner-assisted', 'video-metadata', 55, 2200),
  'facebook': blueprint('owner-assisted', 'short-post', 100, 4000),
  'github': blueprint('automatic-candidate', 'article', 128, 12000),
  'hacker-news': blueprint('owner-assisted', 'short-post', 80, 1000),
  'jianshu': blueprint('owner-assisted', 'article', 100, 12000),
  'juejin': blueprint('owner-assisted', 'article', 80, 12000),
  'mastodon': blueprint('automatic-candidate', 'short-post', 80, 500),
  'product-hunt': blueprint('owner-assisted', 'short-post', 60, 1000),
  'reddit': blueprint('content-only', 'short-post', 300, 40000),
  'v2ex': blueprint('owner-assisted', 'short-post', 120, 10000),
  'wechat': blueprint('content-only', 'article', 64, 20000),
  'weibo': blueprint('owner-assisted', 'short-post', 55, 2000),
  'x': blueprint('owner-assisted', 'short-post', 70, 280),
  'xiaohongshu': blueprint('content-only', 'short-post', 20, 1000),
  'youtube': blueprint('owner-assisted', 'video-metadata', 100, 5000),
  'zhihu': blueprint('owner-assisted', 'article', 100, 20000),
} satisfies Record<ChannelId, ChannelBlueprint>

export const DEFAULT_ACTION_DURATION_MS = {
  capture: 2000,
  click: 600,
  fill: 600,
  press: 400,
  wait: 0,
} satisfies Record<CaptureStep['kind'], number>

export const VIDEO_VIEWPORTS = {
  landscape: {
    height: 1080,
    width: 1920,
  },
  portrait: {
    height: 1920,
    width: 1080,
  },
  square: {
    height: 1080,
    width: 1080,
  },
} satisfies Record<VideoFormat, { height: number, width: number }>

function blueprint(
  delivery: ChannelBlueprint['delivery'],
  format: ChannelBlueprint['format'],
  maxTitleLength: number,
  maxBodyLength: number,
): ChannelBlueprint {
  return {
    delivery,
    format,
    maxBodyLength,
    maxTitleLength,
  }
}
