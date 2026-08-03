import type { VideoFormat, VideoViewport } from '../types'
import { VIDEO_VIEWPORT_LIMITS } from '../constants'

export function validateVideoViewport(
  input: unknown,
  format?: VideoFormat,
): VideoViewport {
  if (!isRecord(input))
    throw new Error('video.viewport must be an object')

  const width = positiveInteger(input.width, 'video.viewport.width')
  const height = positiveInteger(input.height, 'video.viewport.height')
  const {
    maxAspectRatio,
    maxDimension,
    maxPixels,
    minDimension,
  } = VIDEO_VIEWPORT_LIMITS

  if (width < minDimension || height < minDimension)
    throw new Error(`video.viewport dimensions must be at least ${minDimension}px`)
  if (width > maxDimension || height > maxDimension)
    throw new Error(`video.viewport dimensions must be at most ${maxDimension}px`)
  if (width * height > maxPixels)
    throw new Error('video.viewport pixel area exceeds the safe recording limit')

  const aspectRatio = Math.max(width / height, height / width)
  if (aspectRatio > maxAspectRatio)
    throw new Error(`video.viewport aspect ratio must not exceed ${maxAspectRatio}:1`)
  if (format === 'landscape' && width < height)
    throw new Error('video.viewport must be landscape for a landscape video')
  if (format === 'portrait' && height < width)
    throw new Error('video.viewport must be portrait for a portrait video')
  if (format === 'square' && width !== height)
    throw new Error('video.viewport must be square for a square video')

  return { height, width }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function positiveInteger(input: unknown, name: string): number {
  if (!Number.isInteger(input) || (input as number) <= 0)
    throw new Error(`${name} must be a positive integer`)
  return input as number
}
