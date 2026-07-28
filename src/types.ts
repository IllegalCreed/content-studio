export type Locale = 'en' | 'zh-CN'

export type ChannelId
  = | 'bilibili'
    | 'bluesky'
    | 'dev'
    | 'douyin'
    | 'facebook'
    | 'github'
    | 'hacker-news'
    | 'jianshu'
    | 'juejin'
    | 'mastodon'
    | 'product-hunt'
    | 'reddit'
    | 'v2ex'
    | 'wechat'
    | 'weibo'
    | 'x'
    | 'xiaohongshu'
    | 'youtube'
    | 'zhihu'

export type DeliveryMode
  = | 'automatic-candidate'
    | 'content-only'
    | 'owner-assisted'

export type ContentFormat = 'article' | 'short-post' | 'video-metadata'

export type VideoFormat = 'landscape' | 'portrait' | 'square'

export type LocalizedText = Record<Locale, string>

export interface ProjectFact {
  id: string
  text: LocalizedText
}

export interface SemanticLocator {
  by: 'label' | 'role' | 'test-id' | 'text'
  value: string
  name?: string
}

export type CaptureStep
  = | {
    kind: 'capture'
    label: string
    durationMs?: number
  }
  | {
    kind: 'click'
    locator: SemanticLocator
    durationMs?: number
  }
  | {
    kind: 'fill'
    locator: SemanticLocator
    value: string
    durationMs?: number
  }
  | {
    kind: 'press'
    key: string
    durationMs?: number
  }
  | {
    kind: 'wait'
    durationMs: number
  }

export interface CaptureFlow {
  id: string
  title: LocalizedText
  startPath: string
  steps: CaptureStep[]
}

export interface ProjectManifest {
  schemaVersion: 1
  projectId: string
  name: string
  canonicalUrl: string
  repositoryUrl: string
  locales: Locale[]
  tagline: LocalizedText
  facts: ProjectFact[]
  captureFlows: CaptureFlow[]
}

export interface CampaignChannel {
  id: ChannelId
  locale: Locale
}

export interface CampaignVideo {
  flowIds: string[]
  format: VideoFormat
}

export interface CampaignSpec {
  schemaVersion: 1
  campaignId: string
  topic: LocalizedText
  goal: 'education' | 'feedback' | 'launch'
  targetUrl: string
  highlights: string[]
  tags: string[]
  channels: CampaignChannel[]
  video?: CampaignVideo
}

export interface ChannelBlueprint {
  delivery: DeliveryMode
  format: ContentFormat
  maxBodyLength: number
  maxTitleLength: number
}

export interface ContentPackage {
  body: string
  campaignId: string
  channel: ChannelId
  delivery: DeliveryMode
  format: ContentFormat
  locale: Locale
  tags: string[]
  targetUrl: string
  title: string
}

export type CompiledCaptureAction = CaptureStep & {
  durationMs: number
  startMs: number
}

export interface CompiledScene {
  actions: CompiledCaptureAction[]
  id: string
  startMs: number
  startPath: string
  title: string
}

export interface VideoPlan {
  campaignId: string
  durationMs: number
  format: VideoFormat
  scenes: CompiledScene[]
  viewport: {
    height: number
    width: number
  }
}

export interface StudioBundle {
  bundleVersion: 1
  campaignId: string
  contentPackages: ContentPackage[]
  projectId: string
  videoPlan: VideoPlan | null
}
