import type {
  CampaignJobStatus,
  CaptureStep,
  ChannelBlueprint,
  ChannelId,
  ContentFormat,
  ContentFormBlueprint,
  ContentMediaRequirement,
  MarketingOpsMediaKind,
  MarketingOpsPackageFormat,
  MarketingOpsUtmMedium,
  StorageRetentionPolicy,
  VideoFormat,
  VideoViewport,
} from './types'

const CONTENT_MEDIA_REQUIREMENTS = {
  none: {
    allowedKinds: [],
    maxCount: 0,
    minCount: 0,
  },
  optionalImage: {
    allowedKinds: ['image'],
    minCount: 0,
  },
  requiredImage: {
    allowedKinds: ['image'],
    minCount: 1,
  },
  requiredVideo: {
    allowedKinds: ['video'],
    maxCount: 1,
    minCount: 1,
  },
} as const satisfies Record<string, ContentMediaRequirement>

export const CHANNEL_BLUEPRINTS = {
  'bilibili': blueprint(
    'owner-assisted',
    'video-metadata',
    80,
    2000,
    [
      contentForm('image-text', 80, 2000),
      contentForm(
        'short-post',
        80,
        2000,
        CONTENT_MEDIA_REQUIREMENTS.optionalImage,
      ),
    ],
  ),
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

/**
 * Renderer formats understood by the current marketing-ops contract. This
 * describes package shape only; it does not imply adapter or write support.
 */
export const MARKETING_OPS_PACKAGE_FORMATS = {
  'bilibili': 'manual-package',
  'bluesky': 'post',
  'dev': 'article',
  'douyin': 'manual-package',
  'facebook': 'manual-package',
  'github': 'release',
  'hacker-news': 'manual-package',
  'jianshu': 'manual-package',
  'juejin': 'manual-package',
  'mastodon': 'status',
  'product-hunt': 'manual-package',
  'reddit': 'post',
  'v2ex': 'manual-package',
  'wechat': 'manual-package',
  'weibo': 'post',
  'x': 'manual-package',
  'xiaohongshu': 'manual-package',
  'youtube': 'manual-package',
  'zhihu': 'manual-package',
} as const satisfies Record<ChannelId, MarketingOpsPackageFormat>

export const MARKETING_OPS_PACKAGE_FORMAT_VALUES = [
  'article',
  'manual-package',
  'post',
  'release',
  'status',
] as const satisfies readonly MarketingOpsPackageFormat[]

export const MARKETING_OPS_MEDIA_KINDS = [
  'gif',
  'image',
  'video',
] as const satisfies readonly MarketingOpsMediaKind[]

export const MARKETING_OPS_UTM_MEDIUM_VALUES = [
  'community',
  'social',
] as const satisfies readonly MarketingOpsUtmMedium[]

export const MARKETING_OPS_COMPATIBILITY_MATRIX = [{
  contentStudioMajor: 0,
  contentStudioMinor: 1,
  contractVersion: 3,
  runtimeMajor: 0,
  runtimeMinor: 1,
}] as const

export const MARKETING_OPS_RUNTIME_NAME = 'marketing-ops' as const

export const MARKETING_OPS_STATUS_TTL_MS = 60_000

export const DEFAULT_ACTION_DURATION_MS = {
  'capture': 2000,
  'click': 600,
  'fill': 600,
  'press': 400,
  'wait': 0,
  'wait-for': 1000,
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
} satisfies Record<VideoFormat, VideoViewport>

export const VIDEO_VIEWPORT_LIMITS = {
  maxAspectRatio: 4,
  maxDimension: 3840,
  maxPixels: 8_294_400,
  minDimension: 320,
} as const

export const GIF_LIMITS = {
  defaultDurationSeconds: 4,
  defaultFps: 10,
  defaultLongEdge: 640,
  maxDimension: 1920,
  maxDurationSeconds: 15,
  maxFps: 24,
  maxFrames: 300,
  maxPixels: 3_000_000,
  maxSizeBytes: 8 * 1024 * 1024,
} as const

export const CAMPAIGN_JOB_TRANSITIONS = {
  'awaiting-owner': ['cancelled', 'published', 'recording'],
  'cancelled': ['queued'],
  'composing': ['awaiting-owner', 'cancelled', 'completed', 'failed'],
  'completed': [],
  'failed': ['queued'],
  'generating': ['cancelled', 'failed', 'recording'],
  'monitoring': [],
  'published': ['monitoring'],
  'queued': ['cancelled', 'generating'],
  'recording': ['awaiting-owner', 'cancelled', 'composing', 'failed'],
} as const satisfies Record<CampaignJobStatus, readonly CampaignJobStatus[]>

export const DEFAULT_RECORDING_MAX_ATTEMPTS = 1
export const MAX_RECORDING_ATTEMPTS = 3

export const MCP_LIST_TTL_MS = 60_000
export const MCP_RESOURCE_TTL_MS = 0
export const COMPOSITION_AUDIO_CHANNEL_LAYOUT = 'stereo'
export const COMPOSITION_AUDIO_SAMPLE_RATE = 48_000

export const DEFAULT_STORAGE_RETENTION_POLICY = {
  activityArtifactDays: 30,
  rebuildableCacheDays: 7,
  recycleRecoveryDays: 30,
} as const satisfies StorageRetentionPolicy

export const CONTENT_STUDIO_RECORD_TYPES = {
  activity: 'activity',
  activityArtifact: 'activity-artifact',
  channelContent: 'channel-content',
  contentGroup: 'content-group',
  monitoringObservation: 'monitoring-observation',
  ownerHandoff: 'owner-handoff',
  project: 'project',
  projectAsset: 'project-asset',
  projectChannelBinding: 'project-channel-binding',
  projectSnapshot: 'project-snapshot',
  publicationPlan: 'publication-plan',
  publicationReceipt: 'publication-receipt',
  report: 'report',
} as const

function blueprint(
  delivery: ChannelBlueprint['delivery'],
  format: ChannelBlueprint['format'],
  maxTitleLength: number,
  maxBodyLength: number,
  additionalContentForms: readonly ContentFormBlueprint[] = [],
): ChannelBlueprint {
  const contentForms = [
    contentForm(format, maxTitleLength, maxBodyLength),
    ...additionalContentForms,
  ]
  return {
    contentForms,
    delivery,
    format,
    maxBodyLength,
    maxTitleLength,
    supportedFormats: contentForms.map(form => form.format),
  }
}

function contentForm(
  format: ContentFormat,
  maxTitleLength: number,
  maxBodyLength: number,
  media: ContentMediaRequirement = defaultContentMediaRequirement(format),
): ContentFormBlueprint {
  return {
    format,
    maxBodyLength,
    maxTitleLength,
    media,
  }
}

export function defaultContentMediaRequirement(
  format: ContentFormat,
): ContentMediaRequirement {
  if (format === 'article')
    return CONTENT_MEDIA_REQUIREMENTS.optionalImage
  if (format === 'image-text')
    return CONTENT_MEDIA_REQUIREMENTS.requiredImage
  if (format === 'video-metadata')
    return CONTENT_MEDIA_REQUIREMENTS.requiredVideo
  return CONTENT_MEDIA_REQUIREMENTS.none
}
