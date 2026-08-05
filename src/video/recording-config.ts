import type {
  CampaignSpec,
  ChannelId,
  Locale,
  ProjectManifest,
  VideoColorScheme,
  VideoFormat,
  VideoRecordingConfig,
  VideoRecordingConfigOverrides,
  VideoRecordingProfile,
} from '../types'
import { CHANNEL_BLUEPRINTS, VIDEO_VIEWPORTS } from '../constants'
import { validateVideoViewport } from './viewport'

const LOCALES = new Set<Locale>(['en', 'zh-CN'])
const COLOR_SCHEMES = new Set<VideoColorScheme>([
  'dark',
  'light',
  'no-preference',
])
const SUPPORTED_SCALE_FACTORS = new Set([1, 2])
const SUPPORTED_KEYS = new Set([
  'colorScheme',
  'deviceScaleFactor',
  'format',
  'locale',
  'outputSize',
  'viewport',
])

export interface VideoRecordingConfigValidationOptions {
  format?: VideoFormat
  locales?: readonly Locale[]
  path?: string
}

export function validateVideoRecordingConfigOverrides(
  input: unknown,
  options: VideoRecordingConfigValidationOptions = {},
): VideoRecordingConfigOverrides {
  const path = options.path ?? 'video recording config'
  const value = asRecord(input, path)
  for (const key of Object.keys(value)) {
    if (!SUPPORTED_KEYS.has(key))
      throw new Error(`${path} contains unsupported field: ${key}`)
  }

  const colorScheme = value.colorScheme === undefined
    ? undefined
    : parseColorScheme(value.colorScheme, `${path}.colorScheme`)
  const deviceScaleFactor = value.deviceScaleFactor === undefined
    ? undefined
    : parseDeviceScaleFactor(
        value.deviceScaleFactor,
        `${path}.deviceScaleFactor`,
      )
  const format = value.format === undefined
    ? undefined
    : parseVideoFormat(value.format, `${path}.format`)
  const locale = value.locale === undefined
    ? undefined
    : parseLocale(value.locale, `${path}.locale`, options.locales)
  const viewport = value.viewport === undefined
    ? undefined
    : validateVideoViewport(value.viewport, format ?? options.format)
  const outputSize = value.outputSize === undefined
    ? undefined
    : validateVideoViewport(value.outputSize, format ?? options.format)

  return {
    ...(colorScheme === undefined ? {} : { colorScheme }),
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor }),
    ...(format === undefined ? {} : { format }),
    ...(locale === undefined ? {} : { locale }),
    ...(outputSize === undefined ? {} : { outputSize }),
    ...(viewport === undefined ? {} : { viewport }),
  }
}

export function validateVideoRecordingProfile(
  input: unknown,
  format: VideoFormat,
  locales?: readonly Locale[],
): VideoRecordingProfile {
  const value = asRecord(input, 'video.recordingProfile')
  const supportedKeys = new Set(['channelVariants', 'defaults'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new Error(`video.recordingProfile contains unsupported field: ${key}`)
  }

  const defaults = value.defaults === undefined
    ? undefined
    : validateVideoRecordingConfigOverrides(value.defaults, {
        format,
        ...(locales === undefined ? {} : { locales }),
        path: 'video.recordingProfile.defaults',
      })
  const channelVariants = value.channelVariants === undefined
    ? undefined
    : parseChannelVariants(value.channelVariants, format, locales)

  return {
    ...(channelVariants === undefined ? {} : { channelVariants }),
    ...(defaults === undefined ? {} : { defaults }),
  }
}

export function resolveVideoRecordingConfig(
  project: ProjectManifest,
  campaign: CampaignSpec,
  channelId?: ChannelId,
): VideoRecordingConfig {
  if (campaign.video === undefined)
    throw new Error('Campaign does not define a video plan')

  const format = campaign.video.format
  const videoChannel = campaign.channels.find(channel =>
    ['bilibili', 'douyin', 'youtube'].includes(channel.id),
  )
  const targetChannel = campaign.channels.find(channel =>
    channel.id === channelId,
  ) ?? videoChannel ?? campaign.channels[0]
  const resolvedChannelId = targetChannel?.id
  const variantFormat = campaign.video.recordingProfile
    ?.channelVariants?.[resolvedChannelId ?? '']
    ?.format
  const effectiveFormat = variantFormat ?? format
  const defaultLocale = targetChannel?.locale
    ?? campaign.channels[0]?.locale
    ?? project.locales[0]
  if (defaultLocale === undefined)
    throw new Error('A video campaign must define a locale')

  const merged: VideoRecordingConfigOverrides = {
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: defaultLocale,
    viewport: VIDEO_VIEWPORTS[effectiveFormat],
  }
  mergeOverrides(merged, project.videoRecordingDefaults)
  mergeOverrides(merged, campaign.video.recordingProfile?.defaults)
  if (resolvedChannelId !== undefined) {
    mergeOverrides(
      merged,
      campaign.video.recordingProfile?.channelVariants?.[resolvedChannelId],
    )
  }

  if (merged.locale === undefined || !project.locales.includes(merged.locale)) {
    throw new Error(
      `Video recording locale must be one of the project locales: ${project.locales.join(', ')}`,
    )
  }
  if (merged.deviceScaleFactor === undefined)
    throw new Error('Video recording deviceScaleFactor is required')
  if (merged.colorScheme === undefined)
    throw new Error('Video recording colorScheme is required')
  if (merged.viewport === undefined)
    throw new Error('Video recording viewport is required')

  const viewport = validateVideoViewport(merged.viewport, effectiveFormat)
  const outputSize = validateVideoViewport(
    merged.outputSize ?? viewport,
    effectiveFormat,
  )
  return {
    colorScheme: merged.colorScheme,
    deviceScaleFactor: merged.deviceScaleFactor,
    format: effectiveFormat,
    locale: merged.locale,
    outputSize,
    viewport,
  }
}

function parseChannelVariants(
  input: unknown,
  format: VideoFormat,
  locales?: readonly Locale[],
): Partial<Record<ChannelId, VideoRecordingConfigOverrides>> {
  const value = asRecord(input, 'video.recordingProfile.channelVariants')
  const variants: Partial<Record<ChannelId, VideoRecordingConfigOverrides>> = {}
  for (const [channel, overrides] of Object.entries(value)) {
    if (!(channel in CHANNEL_BLUEPRINTS))
      throw new Error(`Unsupported video recording channel variant: ${channel}`)
    const raw = asRecord(
      overrides,
      `video.recordingProfile.channelVariants.${channel}`,
    )
    const variantFormat = raw.format === undefined
      ? undefined
      : parseVideoFormat(
          raw.format,
          `video.recordingProfile.channelVariants.${channel}.format`,
        )
    variants[channel as ChannelId] = validateVideoRecordingConfigOverrides(
      overrides,
      {
        format: variantFormat ?? format,
        ...(locales === undefined ? {} : { locales }),
        path: `video.recordingProfile.channelVariants.${channel}`,
      },
    )
  }
  return variants
}

function mergeOverrides(
  target: VideoRecordingConfigOverrides,
  source: VideoRecordingConfigOverrides | undefined,
): void {
  if (source === undefined)
    return
  if (source.colorScheme !== undefined)
    target.colorScheme = source.colorScheme
  if (source.deviceScaleFactor !== undefined)
    target.deviceScaleFactor = source.deviceScaleFactor
  if (source.locale !== undefined)
    target.locale = source.locale
  if (source.outputSize !== undefined)
    target.outputSize = source.outputSize
  if (source.viewport !== undefined)
    target.viewport = source.viewport
}

function asRecord(input: unknown, path: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new TypeError(`${path} must be an object`)
  return input as Record<string, unknown>
}

function parseColorScheme(input: unknown, path: string): VideoColorScheme {
  if (typeof input !== 'string' || !COLOR_SCHEMES.has(input as VideoColorScheme))
    throw new Error(`${path} must be dark, light, or no-preference`)
  return input as VideoColorScheme
}

function parseVideoFormat(input: unknown, path: string): VideoFormat {
  if (
    typeof input !== 'string'
    || (input !== 'landscape' && input !== 'portrait' && input !== 'square')
  ) {
    throw new Error(`${path} must be landscape, portrait, or square`)
  }
  return input
}

function parseDeviceScaleFactor(input: unknown, path: string): number {
  if (
    typeof input !== 'number'
    || !Number.isInteger(input)
    || !SUPPORTED_SCALE_FACTORS.has(input)
  ) {
    throw new Error(`${path} must be one of: 1, 2`)
  }
  return input
}

function parseLocale(
  input: unknown,
  path: string,
  locales: readonly Locale[] | undefined,
): Locale {
  if (typeof input !== 'string' || !LOCALES.has(input as Locale))
    throw new Error(`${path} is not supported`)
  const locale = input as Locale
  if (locales !== undefined && !locales.includes(locale))
    throw new Error(`${path} must be one of the project locales`)
  return locale
}
