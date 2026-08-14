// @env node

import type {
  ActivityArtifact,
  MarketingOpsArtifactReference,
  MarketingOpsMediaKind,
  MarketingOpsPublicationPackage,
  MarketingOpsPublicationPackageInput,
  MarketingOpsRendererOutput,
} from '../types'
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import {
  MARKETING_OPS_PACKAGE_FORMATS,
  selectedContentFormatsForChannel,
} from '../constants'
import { assessChannelContentReadiness } from '../content/readiness'
import { resolveVideoFormatForChannel } from '../video/recording-config'

export function compileMarketingOpsPublicationPackage(
  input: MarketingOpsPublicationPackageInput,
): MarketingOpsPublicationPackage {
  assertPackageScope(input)
  assertRendererOutput(input)
  const videoOrientation = resolveVideoOrientation(input)

  const artifacts = resolveArtifacts(input)
  const artifactRefs = resolveArtifactReferences(input, artifacts)
  const readiness = assessChannelContentReadiness(
    input.content.channel,
    input.content.format,
    input.content.artifactIds,
    artifacts,
    input.content.locale,
  )
  if (!readiness.ready) {
    throw new Error(
      `Marketing-ops package media is not ready: ${readiness.reason}`,
    )
  }

  const expectedMedia = mediaKindsForArtifacts(artifacts)
  assertResolvedMedia(expectedMedia, input.renderer.media)

  const renderer = {
    canonicalUrl: input.renderer.canonicalUrl,
    format: input.renderer.format,
    links: [...input.renderer.links],
    media: [...input.renderer.media],
    utmMedium: input.renderer.utmMedium,
  }
  const hashPayload = {
    activityId: input.activity.activityId,
    artifactRefs,
    body: input.content.body,
    campaignId: input.activity.campaignId,
    channel: input.content.channel,
    contentFormat: input.content.format,
    contentId: input.content.contentId,
    contentVersion: input.content.version,
    locale: input.content.locale,
    projectId: input.content.projectId,
    renderer,
    schemaVersion: 1 as const,
    title: input.content.title,
    ...(videoOrientation === undefined ? {} : { videoOrientation }),
  }

  return {
    ...(input.accountRef === undefined ? {} : { accountRef: input.accountRef }),
    ...hashPayload,
    contentHash: createHash('sha256')
      .update(stableStringify(hashPayload))
      .digest('hex'),
    packageId: input.publication.publicationId,
    publicationId: input.publication.publicationId,
  }
}

/**
 * Produces the single fixed renderer envelope supported by the Workbench's
 * Bilibili owner-assisted entry point. The values come only from immutable
 * activity/content/artifact records; the UI cannot supply or rewrite them.
 */
export function createBilibiliMarketingOpsRendererOutput(
  input: Omit<MarketingOpsPublicationPackageInput, 'renderer'>,
): MarketingOpsRendererOutput {
  if (input.content.channel !== 'bilibili' || input.publication.channel !== 'bilibili')
    throw new Error('Fixed Bilibili renderer requires a Bilibili publication')
  if (!input.content.body.includes(input.activity.targetUrl)) {
    throw new Error(
      'Bilibili renderer target URL must already be present in locked content',
    )
  }
  assertProjectUrl(
    input.activity.targetUrl,
    input.snapshot.manifest.canonicalUrl,
    'activity target URL',
  )
  return {
    canonicalUrl: input.activity.targetUrl,
    format: 'manual-package',
    links: [input.activity.targetUrl],
    media: mediaKindsForArtifacts(resolveArtifacts(input)),
    utmMedium: 'social',
  }
}

/**
 * Carries the activity's locked video format into a rendered package. A
 * package is only a video package when its channel content says so; other
 * content forms must not accidentally inherit an activity-level video plan.
 * Bilibili's video form is deliberately fail-closed because the owner needs
 * to know which upload orientation the platform-facing handoff represents.
 */
function resolveVideoOrientation(
  input: MarketingOpsPublicationPackageInput,
): MarketingOpsPublicationPackage['videoOrientation'] {
  if (input.content.format !== 'video')
    return undefined
  const format = input.activity.video === undefined
    ? undefined
    : resolveVideoFormatForChannel(input.activity.video, input.content.channel)
  if (format === undefined) {
    if (input.content.channel === 'bilibili') {
      throw new Error('Bilibili video package requires activity video orientation')
    }
    return undefined
  }
  if (
    input.content.channel === 'bilibili'
    && format !== 'landscape'
    && format !== 'portrait'
  ) {
    throw new Error('Bilibili video package orientation must be landscape or portrait')
  }
  return format
}

export function compileMarketingOpsPublicationPackages(
  inputs: readonly MarketingOpsPublicationPackageInput[],
): MarketingOpsPublicationPackage[] {
  const packages = inputs.map(compileMarketingOpsPublicationPackage)
  const packageIds = new Set<string>()
  for (const packageValue of packages) {
    if (packageIds.has(packageValue.packageId)) {
      throw new Error(
        `Duplicate marketing-ops package id: ${packageValue.packageId}`,
      )
    }
    packageIds.add(packageValue.packageId)
  }
  return packages
}

function assertPackageScope(input: MarketingOpsPublicationPackageInput): void {
  const { activity, content, publication, snapshot } = input
  const projectIds = [
    activity.projectId,
    content.projectId,
    publication.projectId,
    snapshot.projectId,
    snapshot.manifest.projectId,
  ]
  if (projectIds.some(projectId => projectId !== content.projectId))
    throw new Error('Marketing-ops package records must belong to one project')
  if (activity.projectSnapshotId !== snapshot.snapshotId) {
    throw new Error(
      'Marketing-ops package activity must use the supplied project snapshot',
    )
  }
  if (
    content.activityId !== activity.activityId
    || publication.activityId !== activity.activityId
  ) {
    throw new Error('Marketing-ops package records must belong to one activity')
  }
  if (
    publication.contentId !== content.contentId
    || publication.channel !== content.channel
  ) {
    throw new Error(
      'Marketing-ops publication must match its channel content',
    )
  }
  if (!snapshot.manifest.locales.includes(content.locale)) {
    throw new Error(
      `Marketing-ops package locale is not enabled by the project: ${content.locale}`,
    )
  }
  const activityChannel = activity.channels.find(channel =>
    channel.id === content.channel && channel.locale === content.locale,
  )
  if (activityChannel === undefined) {
    throw new Error(
      'Marketing-ops package channel and locale must match the activity',
    )
  }
  const activityFormat = content.format === 'video'
    ? 'video-metadata'
    : content.format
  if (!selectedContentFormatsForChannel(activityChannel).includes(activityFormat)) {
    throw new Error(
      'Marketing-ops package content form must match the activity channel',
    )
  }
  if (content.title.trim() === '')
    throw new Error('Marketing-ops package title must not be empty')
  if (content.body.trim() === '')
    throw new Error('Marketing-ops package body must not be empty')
  if (publication.publicationId.trim() === '')
    throw new Error('Marketing-ops package publication id must not be empty')
}

function assertRendererOutput(input: MarketingOpsPublicationPackageInput): void {
  const { content, renderer, snapshot } = input
  const expectedFormat = MARKETING_OPS_PACKAGE_FORMATS[content.channel]
  if (renderer.format !== expectedFormat) {
    throw new Error(
      `Marketing-ops renderer format for ${content.channel} must be ${expectedFormat}`,
    )
  }
  if (renderer.links.length === 0 || renderer.links.length > 10) {
    throw new Error(
      'Marketing-ops renderer must include between one and ten links',
    )
  }
  assertProjectUrl(
    renderer.canonicalUrl,
    snapshot.manifest.canonicalUrl,
    'canonical URL',
  )
  assertProjectUrl(
    input.activity.targetUrl,
    snapshot.manifest.canonicalUrl,
    'activity target URL',
  )
  for (const link of renderer.links) {
    assertProjectUrl(link, snapshot.manifest.canonicalUrl, 'link')
    if (!content.body.includes(link)) {
      throw new Error(
        `Marketing-ops renderer link is missing from channel content: ${link}`,
      )
    }
  }
}

function resolveArtifactReferences(
  input: MarketingOpsPublicationPackageInput,
  resolvedArtifacts: readonly ActivityArtifact[] = resolveArtifacts(input),
): MarketingOpsArtifactReference[] {
  const artifacts = [
    ...resolvedArtifacts,
    ...resolveBilibiliAuxiliaryArtifacts(input, resolvedArtifacts),
  ]
  return artifacts.map((artifact) => {
    const mediaKind = mediaKindForArtifact(artifact)
    return {
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      locale: artifact.locale ?? 'neutral',
      ...(mediaKind === undefined ? {} : { mediaKind }),
      sha256: artifact.sha256,
      version: artifact.version,
    }
  })
}

function resolveBilibiliAuxiliaryArtifacts(
  input: MarketingOpsPublicationPackageInput,
  resolvedArtifacts: readonly ActivityArtifact[],
): ActivityArtifact[] {
  if (input.content.channel !== 'bilibili')
    return []
  const selected = new Set(resolvedArtifacts.map(artifact => artifact.artifactId))
  const latestById = new Map<string, ActivityArtifact>()
  for (const artifact of input.artifacts) {
    const current = latestById.get(artifact.artifactId)
    if (current === undefined || current.version < artifact.version)
      latestById.set(artifact.artifactId, artifact)
  }
  const candidates = [...latestById.values()]
    .filter((artifact) => {
      if (selected.has(artifact.artifactId) || artifact.kind !== 'image')
        return false
      if (
        artifact.locale !== undefined
        && artifact.locale !== 'neutral'
        && artifact.locale !== input.content.locale
      ) {
        return false
      }
      return hasCoverToken(artifact)
    })
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))

  if (input.content.format === 'video') {
    const selectedLandscape = resolvedArtifacts.filter(artifact =>
      artifact.kind === 'image' && hasCoverSlotToken(artifact, '16x9'))
    const selectedFourByThree = resolvedArtifacts.filter(artifact =>
      artifact.kind === 'image' && hasCoverSlotToken(artifact, '4x3'))
    const landscape = selectedLandscape.length > 0
      ? selectExactlyOneCover(selectedLandscape, '16:9')
      : selectExactlyOneCover(
          candidates.filter(artifact => hasCoverSlotToken(artifact, '16x9')),
          '16:9',
        )
    const fourByThree = selectedFourByThree.length > 0
      ? selectExactlyOneCover(selectedFourByThree, '4:3')
      : selectExactlyOneCover(
          candidates.filter(artifact => hasCoverSlotToken(artifact, '4x3')),
          '4:3',
        )
    assertResolvedArtifact(input, landscape)
    assertResolvedArtifact(input, fourByThree)
    const appended = new Set(resolvedArtifacts.map(artifact => artifact.artifactId))
    return [landscape, fourByThree].filter(artifact => !appended.has(artifact.artifactId))
  }

  if (input.content.format !== 'image-text')
    return []
  const selectedImageTextCovers = resolvedArtifacts.filter(artifact =>
    artifact.kind === 'image' && hasCoverToken(artifact))
  if (selectedImageTextCovers.length > 0) {
    selectExactlyOneCover(selectedImageTextCovers, 'image-text')
    return []
  }
  const dedicated = candidates.filter(artifact => hasImageTextCoverToken(artifact))
  const cover = selectExactlyOneCover(
    dedicated.length > 0 ? dedicated : candidates,
    'image-text',
  )
  assertResolvedArtifact(input, cover)
  return [cover]
}

function selectExactlyOneCover(
  candidates: readonly ActivityArtifact[],
  slot: string,
): ActivityArtifact {
  if (candidates.length !== 1) {
    throw new Error(
      `Bilibili ${slot} package requires exactly one registered locale-matching cover artifact`,
    )
  }
  return candidates[0]!
}

function artifactIdentity(artifact: ActivityArtifact): string {
  return `${artifact.artifactId}/${artifact.relativePath}`.toLowerCase()
}

function hasCoverToken(artifact: ActivityArtifact): boolean {
  return /(?:^|[-_./])cover(?:[-_./]|$)/u.test(artifactIdentity(artifact))
}

function hasCoverSlotToken(
  artifact: ActivityArtifact,
  slot: '16x9' | '4x3',
): boolean {
  const identity = artifactIdentity(artifact)
  const token = slot === '16x9'
    ? /(?:^|[-_./])(?:16x9|16-9|16_9|landscape)(?:[-_./]|$)/u
    : /(?:^|[-_./])(?:4x3|4-3|4_3)(?:[-_./]|$)/u
  return hasCoverToken(artifact) && token.test(identity)
}

function hasImageTextCoverToken(artifact: ActivityArtifact): boolean {
  const identity = artifactIdentity(artifact)
  return hasCoverToken(artifact)
    && /(?:^|[-_./])(?:image-text|imagetext|article)(?:[-_./]|$)/u.test(identity)
}

function resolveArtifacts(
  input: Pick<MarketingOpsPublicationPackageInput, 'artifacts' | 'content'>,
): ActivityArtifact[] {
  const latestById = new Map<string, ActivityArtifact>()
  for (const artifact of input.artifacts) {
    const current = latestById.get(artifact.artifactId)
    if (current === undefined || current.version < artifact.version)
      latestById.set(artifact.artifactId, artifact)
  }

  const seen = new Set<string>()
  return input.content.artifactIds.map((artifactId) => {
    if (seen.has(artifactId))
      throw new Error(`Duplicate marketing-ops artifact reference: ${artifactId}`)
    seen.add(artifactId)
    const artifact = latestById.get(artifactId)
    if (artifact === undefined) {
      throw new Error(
        `Marketing-ops artifact reference was not resolved: ${artifactId}`,
      )
    }
    assertResolvedArtifact(input, artifact)
    return artifact
  })
}

function assertResolvedArtifact(
  input: Pick<MarketingOpsPublicationPackageInput, 'content'>,
  artifact: ActivityArtifact,
): void {
  if (
    artifact.projectId !== input.content.projectId
    || artifact.activityId !== input.content.activityId
  ) {
    throw new Error(
      'Marketing-ops artifact references must match the project and activity',
    )
  }
  if (
    artifact.locale !== undefined
    && artifact.locale !== 'neutral'
    && artifact.locale !== input.content.locale
  ) {
    throw new Error(
      `Marketing-ops artifact locale ${artifact.locale} does not match content locale ${input.content.locale}`,
    )
  }
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    throw new Error(
      `Marketing-ops artifact must have a valid sha256: ${artifact.artifactId}`,
    )
  }
  if (!Number.isInteger(artifact.version) || artifact.version < 1) {
    throw new Error(`Marketing-ops artifact must have a positive version: ${artifact.artifactId}`)
  }
}

function mediaKindsForArtifacts(
  artifacts: readonly ActivityArtifact[],
): MarketingOpsMediaKind[] {
  const media: MarketingOpsMediaKind[] = []
  for (const artifact of artifacts) {
    const mediaKind = mediaKindForArtifact(artifact)
    if (mediaKind !== undefined && !media.includes(mediaKind))
      media.push(mediaKind)
  }
  return media
}

function mediaKindForArtifact(
  artifact: ActivityArtifact,
): MarketingOpsMediaKind | undefined {
  if (artifact.kind === 'video')
    return 'video'
  if (artifact.kind !== 'image')
    return undefined
  return extname(artifact.relativePath).toLowerCase() === '.gif'
    ? 'gif'
    : 'image'
}

function assertResolvedMedia(
  expected: readonly MarketingOpsMediaKind[],
  rendered: readonly MarketingOpsMediaKind[],
): void {
  if (rendered.length > 3)
    throw new Error('Marketing-ops renderer supports at most three media kinds')
  if (new Set(rendered).size !== rendered.length)
    throw new Error('Marketing-ops renderer media kinds must be unique')
  if (
    expected.length !== rendered.length
    || expected.some(media => !rendered.includes(media))
  ) {
    throw new Error(
      'Marketing-ops renderer media must match resolved final artifact references',
    )
  }
}

function assertProjectUrl(
  value: string,
  canonicalUrl: string,
  label: string,
): void {
  let candidate: URL
  let project: URL
  try {
    candidate = new URL(value)
    project = new URL(canonicalUrl)
  }
  catch {
    throw new Error(`Marketing-ops renderer ${label} must be a valid URL`)
  }
  if (candidate.username !== '' || candidate.password !== '')
    throw new Error(`Marketing-ops renderer ${label} must not contain credentials`)
  if (candidate.protocol !== 'https:')
    throw new Error(`Marketing-ops renderer ${label} must use HTTPS`)
  if (candidate.origin !== project.origin) {
    throw new Error(
      `Marketing-ops renderer ${label} must use the project canonical origin`,
    )
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}
