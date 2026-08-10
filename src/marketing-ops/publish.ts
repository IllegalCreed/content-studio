// @env node

import type {
  MarketingOpsCampaignRequest,
  MarketingOpsCampaignRequestInput,
  MarketingOpsCampaignSpec,
  MarketingOpsPublicationPackage,
  MarketingOpsRenderedCampaignPackage,
  MarketingOpsRenderedPackageVariant,
} from '../types'
import { assertNoSensitiveKeys } from '../validation'

export type { MarketingOpsCampaignRequestInput } from '../types'

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const IDEMPOTENCY_PATTERN = /^[a-z0-9][a-z0-9._/-]{7,255}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

/**
 * Converts compiler output into the path-free rendered package envelope
 * consumed by marketing-ops. It never reads an artifact or contacts a channel.
 */
export function buildMarketingOpsCampaignRequest(
  input: MarketingOpsCampaignRequestInput,
): MarketingOpsCampaignRequest {
  assertNoSensitiveKeys(input)
  assertCampaignInput(input)
  const projectId = input.packages[0]!.projectId
  return {
    authorization: {
      authorizedAt: input.authorization.authorizedAt,
      source: 'owner-prompt',
    },
    campaignId: input.campaignId,
    execution: cloneExecution(input),
    idempotencyKey: input.idempotencyKey,
    packages: input.packages.map(toRenderedPackage),
    projectId,
    spec: cloneSpec(input),
  }
}

/**
 * Produces the campaign metadata required by marketing-ops from packages that
 * Content Studio has already locked. The metadata describes the package; it
 * does not grant write authority, alter renderer copy, or create a receipt.
 */
export function createMarketingOpsCampaignSpec(
  packages: readonly MarketingOpsPublicationPackage[],
  options: { now?: () => Date } = {},
): MarketingOpsCampaignSpec {
  if (packages.length === 0)
    throw new Error('Marketing-ops campaign spec requires at least one package')
  const first = packages[0]!
  const now = options.now ?? (() => new Date())
  const publishedAt = now()
  if (Number.isNaN(publishedAt.getTime()))
    throw new Error('Marketing-ops campaign spec clock is invalid')
  const channels = unique(packages.map(packageValue => packageValue.channel))
  const locales = unique(packages.map(packageValue => packageValue.locale))
  const media = unique(packages.flatMap(packageValue => packageValue.renderer.media))
  const targetUrls = unique(packages.map(packageValue => packageValue.renderer.canonicalUrl))
  const variants: MarketingOpsCampaignSpec['content']['variants'] = {}
  for (const packageValue of packages) {
    if (packageValue.campaignId !== first.campaignId)
      throw new Error('Marketing-ops campaign packages must share a campaign id')
    if (variants[packageValue.locale] !== undefined)
      continue
    variants[packageValue.locale] = {
      angle: packageValue.body,
      callToAction: packageValue.locale === 'zh-CN' ? '查看详情' : 'View details',
      title: packageValue.title,
    }
  }
  return {
    campaign: first.campaignId,
    channels,
    content: { media, variants },
    failureMode: 'continue-supported',
    id: first.campaignId,
    locales,
    publishAt: publishedAt.toISOString(),
    replies: { createBugIssues: false, mode: 'off' },
    schemaVersion: 1,
    targetUrls,
    topic: first.title,
  }
}

function assertCampaignInput(input: MarketingOpsCampaignRequestInput): void {
  if (!Array.isArray(input.packages) || input.packages.length === 0)
    throw new Error('Marketing-ops publish requires at least one package')
  if (input.packages.length > 20)
    throw new Error('Marketing-ops publish supports at most twenty packages')
  if (!IDENTIFIER_PATTERN.test(input.campaignId))
    throw new Error('Marketing-ops campaign id is invalid')
  if (input.spec.schemaVersion !== 1 || input.spec.id !== input.campaignId)
    throw new Error('Marketing-ops campaign spec must match campaign id')
  if (input.spec.campaign !== input.campaignId)
    throw new Error('Marketing-ops campaign spec campaign must match campaign id')
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey))
    throw new Error('Marketing-ops idempotency key is invalid')
  if (
    input.authorization.source !== 'owner-prompt'
    || Number.isNaN(Date.parse(input.authorization.authorizedAt))
  ) {
    throw new Error('Marketing-ops publish requires a valid owner authorization')
  }

  const firstProjectId = input.packages[0]!.projectId
  const seenPackages = new Set<string>()
  const seenPublications = new Set<string>()
  const channels = new Set<MarketingOpsPublicationPackage['channel']>()
  const specChannels = new Set<MarketingOpsPublicationPackage['channel']>(input.spec.channels)
  const specLocales = new Set(input.spec.locales)
  for (const packageValue of input.packages) {
    assertPackage(packageValue)
    if (packageValue.projectId !== firstProjectId)
      throw new Error('Marketing-ops packages must belong to one project')
    if (packageValue.campaignId !== input.campaignId)
      throw new Error('Marketing-ops package campaign must match campaign id')
    if (!specChannels.has(packageValue.channel))
      throw new Error('Marketing-ops package channel is not requested by the spec')
    if (!specLocales.has(packageValue.locale))
      throw new Error('Marketing-ops package locale is not requested by the spec')
    if (seenPackages.has(packageValue.packageId))
      throw new Error('Marketing-ops package ids must be unique')
    if (seenPublications.has(packageValue.publicationId))
      throw new Error('Marketing-ops publication ids must be unique')
    if (!input.spec.targetUrls.includes(packageValue.renderer.canonicalUrl))
      throw new Error('Marketing-ops spec must include each package canonical URL')
    for (const media of packageValue.renderer.media) {
      if (!input.spec.content.media.includes(media))
        throw new Error('Marketing-ops spec media must include package media')
    }
    seenPackages.add(packageValue.packageId)
    seenPublications.add(packageValue.publicationId)
    channels.add(packageValue.channel)
  }
  if (input.spec.channels.length !== channels.size)
    throw new Error('Marketing-ops spec channels must match package channels')
  for (const channel of channels) {
    if (!specChannels.has(channel))
      throw new Error('Marketing-ops spec channel is missing a package')
  }
  if (input.execution.mode === 'assisted-confirm')
    assertConfirmations(input)
}

function assertPackage(packageValue: MarketingOpsPublicationPackage): void {
  if (
    !IDENTIFIER_PATTERN.test(packageValue.projectId)
    || !IDENTIFIER_PATTERN.test(packageValue.campaignId)
    || !IDENTIFIER_PATTERN.test(packageValue.packageId)
    || !IDENTIFIER_PATTERN.test(packageValue.publicationId)
  ) {
    throw new Error('Marketing-ops package identity is invalid')
  }
  if (!SHA256_PATTERN.test(packageValue.contentHash))
    throw new Error('Marketing-ops package content hash is invalid')
  assertVideoOrientation(packageValue)
  if (!Number.isInteger(packageValue.contentVersion) || packageValue.contentVersion < 1)
    throw new Error('Marketing-ops package content version is invalid')
  assertHttpsUrl(packageValue.renderer.canonicalUrl, 'package canonical URL')
  if (packageValue.renderer.links.length === 0 || packageValue.renderer.links.length > 10)
    throw new Error('Marketing-ops package links are invalid')
  packageValue.renderer.links.forEach(link => assertHttpsUrl(link, 'package link'))

  const artifactIds = new Set<string>()
  const mediaRefs = new Set<string>()
  for (const reference of packageValue.artifactRefs) {
    if (
      !IDENTIFIER_PATTERN.test(reference.artifactId)
      || artifactIds.has(reference.artifactId)
      || !SHA256_PATTERN.test(reference.sha256)
      || !Number.isInteger(reference.version)
      || reference.version < 1
    ) {
      throw new Error('Marketing-ops artifact reference is invalid')
    }
    if (Object.hasOwn(reference, 'relativePath'))
      throw new Error('Marketing-ops artifact references cannot contain paths')
    if (reference.mediaKind !== undefined)
      mediaRefs.add(reference.mediaKind)
    artifactIds.add(reference.artifactId)
  }
  for (const media of packageValue.renderer.media) {
    if (!mediaRefs.has(media))
      throw new Error('Marketing-ops package media must have a resolved artifact reference')
  }
}

function assertVideoOrientation(packageValue: MarketingOpsPublicationPackage): void {
  const orientation = packageValue.videoOrientation
  if (
    orientation !== undefined
    && orientation !== 'landscape'
    && orientation !== 'portrait'
    && orientation !== 'square'
  ) {
    throw new Error('Marketing-ops package video orientation is invalid')
  }
  if (packageValue.contentFormat !== 'video' && orientation !== undefined) {
    throw new Error(
      'Marketing-ops non-video package cannot include video orientation',
    )
  }
  if (packageValue.channel === 'bilibili' && packageValue.contentFormat === 'video') {
    if (orientation !== 'landscape' && orientation !== 'portrait') {
      throw new Error(
        'Bilibili video package requires landscape or portrait video orientation',
      )
    }
  }
}

function assertConfirmations(input: MarketingOpsCampaignRequestInput): void {
  if (input.execution.mode !== 'assisted-confirm')
    return
  if (input.execution.confirmations.length !== input.packages.length)
    throw new Error('Marketing-ops confirmations must match packages')
  const packages = new Map(
    input.packages.map(packageValue => [packageValue.packageId, packageValue]),
  )
  const seen = new Set<string>()
  for (const confirmation of input.execution.confirmations) {
    const packageValue = packages.get(confirmation.packageId)
    if (packageValue === undefined)
      throw new Error('Marketing-ops confirmation package is unknown')
    if (seen.has(confirmation.packageId))
      throw new Error('Marketing-ops confirmation packages must be unique')
    if (
      confirmation.channel !== packageValue.channel
      || confirmation.publicationId !== packageValue.publicationId
      || confirmation.form !== packageValue.contentFormat
    ) {
      throw new Error('Marketing-ops confirmation must match its package')
    }
    assertHttpsUrl(confirmation.publicUrl, 'marketing-ops public URL')
    seen.add(confirmation.packageId)
  }
}

function toRenderedPackage(
  packageValue: MarketingOpsPublicationPackage,
): MarketingOpsRenderedCampaignPackage {
  const variant: MarketingOpsRenderedPackageVariant = {
    body: packageValue.body,
    links: [...packageValue.renderer.links],
    locale: packageValue.locale,
    media: [...packageValue.renderer.media],
    title: packageValue.title,
  }
  return {
    canonicalUrl: packageValue.renderer.canonicalUrl,
    channel: packageValue.channel,
    contentStudio: {
      ...(packageValue.accountRef === undefined
        ? {}
        : { accountRef: packageValue.accountRef }),
      activityId: packageValue.activityId,
      artifactRefs: packageValue.artifactRefs.map(reference => ({ ...reference })),
      contentFormat: packageValue.contentFormat,
      contentHash: packageValue.contentHash,
      contentId: packageValue.contentId,
      contentVersion: packageValue.contentVersion,
      packageId: packageValue.packageId,
      projectId: packageValue.projectId,
      publicationId: packageValue.publicationId,
      schemaVersion: 1,
      ...(packageValue.videoOrientation === undefined
        ? {}
        : { videoOrientation: packageValue.videoOrientation }),
    },
    format: packageValue.renderer.format,
    utmMedium: packageValue.renderer.utmMedium,
    variants: [variant],
  }
}

function cloneExecution(
  input: MarketingOpsCampaignRequestInput,
): MarketingOpsCampaignRequestInput['execution'] {
  if (input.execution.mode === 'assisted-prepare')
    return { mode: 'assisted-prepare' }
  return {
    confirmations: input.execution.confirmations.map(confirmation => ({ ...confirmation })),
    mode: 'assisted-confirm',
  }
}

function cloneSpec(
  input: MarketingOpsCampaignRequestInput,
): MarketingOpsCampaignRequestInput['spec'] {
  const variants: MarketingOpsCampaignRequestInput['spec']['content']['variants'] = {}
  for (const [locale, variant] of Object.entries(input.spec.content.variants)) {
    if (variant !== undefined)
      variants[locale as keyof typeof variants] = { ...variant }
  }
  return {
    ...input.spec,
    content: {
      media: [...input.spec.content.media],
      variants,
    },
    locales: [...input.spec.locales],
    replies: { ...input.spec.replies },
    targetUrls: [...input.spec.targetUrls],
  }
}

function assertHttpsUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error(`${label} must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error(`${label} must be an HTTPS URL without credentials or fragments`)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
