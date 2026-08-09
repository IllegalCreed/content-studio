// @env node

import type {
  ProductionCoverResult,
  ProductionCoverSpec,
  VideoViewport,
} from '../types'
import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { resolveFfmpegPath } from './ffmpeg'

const execFile = promisify(execFileCallback)
const MAX_TITLE_LINES = 2
const MAX_SUBTITLE_LINES = 2

export class MediaCoverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaCoverError'
  }
}

export interface GenerateDeterministicCoverInput extends ProductionCoverSpec {
  ffmpegPath?: string
  outputSize: VideoViewport
  signal?: AbortSignal
  sourcePath: string
}

/**
 * Builds a local-first cover without calling an image model. The first frame
 * of the composed video is embedded in an SVG, then a small deterministic
 * text layer identifies the content and its local fallback provenance.
 */
export async function generateDeterministicCover(
  input: GenerateDeterministicCoverInput,
): Promise<ProductionCoverResult> {
  validateInput(input)
  throwIfAborted(input.signal)
  const ffmpegPath = input.ffmpegPath ?? resolveFfmpegPath()
  try {
    await access(input.sourcePath)
  }
  catch {
    throw new MediaCoverError(`Cover source does not exist: ${input.sourcePath}`)
  }

  const outputDirectory = dirname(input.outputPath)
  await mkdir(outputDirectory, { recursive: true })
  const temporaryDirectory = await mkdtemp(join(outputDirectory, '.cover-frame-'))
  const framePath = join(temporaryDirectory, 'frame.png')
  try {
    await execFile(
      ffmpegPath,
      [
        '-y',
        '-ss',
        '0',
        '-i',
        input.sourcePath,
        '-frames:v',
        '1',
        '-vf',
        coverFrameFilter(input.outputSize),
        framePath,
      ],
      {
        maxBuffer: 4 * 1024 * 1024,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    )
    throwIfAborted(input.signal)
    const frame = await readFile(framePath)
    const svg = createCoverSvg(input, frame.toString('base64'))
    await writeFile(input.outputPath, svg, 'utf8')
  }
  catch (error: unknown) {
    if (error instanceof MediaCoverError)
      throw error
    throw new MediaCoverError(
      `Deterministic cover generation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }

  const outputStatus = await stat(input.outputPath)
  const content = await readFile(input.outputPath)
  return {
    artifactPath: input.outputPath,
    height: input.outputSize.height,
    sha256: createHash('sha256').update(content).digest('hex'),
    sizeBytes: outputStatus.size,
    width: input.outputSize.width,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true)
    throw new MediaCoverError('Deterministic cover generation was cancelled')
}

function validateInput(input: GenerateDeterministicCoverInput): void {
  if (!Number.isInteger(input.outputSize.width) || input.outputSize.width < 2)
    throw new MediaCoverError('Cover output width must be an integer of at least 2')
  if (!Number.isInteger(input.outputSize.height) || input.outputSize.height < 2)
    throw new MediaCoverError('Cover output height must be an integer of at least 2')
  if (input.sourcePath.trim() === '')
    throw new MediaCoverError('Cover source path must not be empty')
  if (input.outputPath.trim() === '')
    throw new MediaCoverError('Cover output path must not be empty')
  if (input.title.trim() === '')
    throw new MediaCoverError('Cover title must not be empty')
}

function coverFrameFilter(outputSize: VideoViewport): string {
  return [
    `scale=${outputSize.width}:${outputSize.height}:force_original_aspect_ratio=decrease`,
    `pad=${outputSize.width}:${outputSize.height}:(ow-iw)/2:(oh-ih)/2:color=#101828`,
    'format=rgb24',
  ].join(',')
}

function createCoverSvg(
  input: GenerateDeterministicCoverInput,
  frameBase64: string,
): string {
  const { height, width } = input.outputSize
  const titleLines = wrapText(input.title, maxCharacters(width), MAX_TITLE_LINES)
  const subtitleLines = input.subtitle === undefined
    ? []
    : wrapText(input.subtitle, maxCharacters(width), MAX_SUBTITLE_LINES)
  const titleFontSize = Math.max(24, Math.round(Math.min(width, height) * 0.075))
  const subtitleFontSize = Math.max(14, Math.round(titleFontSize * 0.45))
  const left = Math.round(width * 0.08)
  const textTop = Math.round(height * 0.64)
  const titleLineHeight = Math.round(titleFontSize * 1.18)
  const subtitleLineHeight = Math.round(subtitleFontSize * 1.35)
  const titleStart = textTop + titleFontSize
  const subtitleStart = titleStart + titleLines.length * titleLineHeight + Math.round(height * 0.04)
  const titleMarkup = titleLines
    .map((line, index) => `<tspan x="${left}" dy="${index === 0 ? 0 : titleLineHeight}">${escapeXml(line)}</tspan>`)
    .join('')
  const subtitleMarkup = subtitleLines
    .map((line, index) => `<tspan x="${left}" dy="${index === 0 ? 0 : subtitleLineHeight}">${escapeXml(line)}</tspan>`)
    .join('')
  const badgeLabel = 'CONTENT STUDIO · LOCAL FALLBACK'
  const badgeText = escapeXml(badgeLabel)
  const badgeFontSize = Math.max(12, Math.round(titleFontSize * 0.34))
  const badgeWidth = Math.min(
    width * 0.82,
    Math.max(240, Math.round(badgeLabel.length * badgeFontSize * 0.64 + badgeFontSize * 1.6)),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(input.title)}">
  <defs>
    <linearGradient id="cover-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101828" stop-opacity="0.05" />
      <stop offset="1" stop-color="#101828" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <image href="data:image/png;base64,${frameBase64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
  <rect width="${width}" height="${height}" fill="url(#cover-shade)" />
  <rect x="${left}" y="${Math.round(height * 0.08)}" width="${badgeWidth}" height="${Math.max(30, Math.round(titleFontSize * 0.9))}" rx="${Math.round(titleFontSize * 0.45)}" fill="#67e8f9" fill-opacity="0.88" />
  <text x="${left + Math.round(badgeFontSize * 0.65)}" y="${Math.round(height * 0.08) + Math.round(titleFontSize * 0.62)}" fill="#06202a" font-family="system-ui, sans-serif" font-size="${badgeFontSize}" font-weight="700" letter-spacing="1">${badgeText}</text>
  <text x="${left}" y="${titleStart}" fill="#ffffff" font-family="system-ui, sans-serif" font-size="${titleFontSize}" font-weight="700">${titleMarkup}</text>
  ${subtitleLines.length === 0 ? '' : `<text x="${left}" y="${subtitleStart}" fill="#d7e3f4" font-family="system-ui, sans-serif" font-size="${subtitleFontSize}">${subtitleMarkup}</text>`}
</svg>
`
}

function maxCharacters(width: number): number {
  return Math.max(12, Math.floor(width / 34))
}

function wrapText(input: string, maxLength: number, maxLines: number): string[] {
  const normalized = Array.from(input)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x1F && codePoint !== 0x7F
    })
    .join('')
    .trim()
  if (normalized === '')
    return []
  const characters = Array.from(normalized)
  const lines: string[] = []
  for (let offset = 0; offset < characters.length && lines.length < maxLines; offset += maxLength) {
    lines.push(characters.slice(offset, offset + maxLength).join(''))
  }
  if (characters.length > maxLength * maxLines) {
    const last = lines.at(-1) ?? ''
    lines[lines.length - 1] = `${last.slice(0, Math.max(1, last.length - 1))}…`
  }
  return lines
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(String.fromCharCode(39), '&apos;')
}
