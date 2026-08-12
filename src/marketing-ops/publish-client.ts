// @env node

import type {
  MarketingOpsCampaignRequest,
  MarketingOpsPublishClient,
  MarketingOpsPublishFailure,
  MarketingOpsPublishHandoff,
  MarketingOpsPublishResult,
} from '../types'
import { assertNoSensitiveKeys } from '../validation'

interface MarketingOpsPublishClientOptions {
  publishCampaign: (input: MarketingOpsCampaignRequest) => Promise<unknown>
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const ID_PATTERN = /^\w[\w./-]{0,255}$/u

export function createMarketingOpsPublishClient(
  options: MarketingOpsPublishClientOptions,
): MarketingOpsPublishClient {
  return {
    publishCampaign: async (input) => {
      assertNoSensitiveKeys(input)
      let value: unknown
      try {
        value = await options.publishCampaign(input)
      }
      catch (error: unknown) {
        throw publishFailure(error instanceof Error ? error.message : undefined)
      }
      return parsePublishResult(value, input)
    },
  }
}

function parsePublishResult(
  input: unknown,
  request: MarketingOpsCampaignRequest,
): MarketingOpsPublishResult {
  const value = asRecord(input)
  if (value.isError === true)
    throw publishFailure(toolText(value.content))
  const allowed = new Set([
    'campaignId',
    'failures',
    'followUps',
    'handoffs',
    'limitations',
    'projectId',
    'receipts',
  ])
  if (Object.keys(value).some(key => !allowed.has(key)))
    throw new Error('Marketing-ops publish result schema is invalid')
  if (value.projectId !== request.projectId || value.campaignId !== request.campaignId)
    throw new Error('Marketing-ops publish result scope does not match request')
  if (!Array.isArray(value.receipts) || !Array.isArray(value.failures) || !Array.isArray(value.handoffs))
    throw new Error('Marketing-ops publish result schema is invalid')
  const packages = request.packages
  const receipts = value.receipts.map(item => parseReceipt(item, request, packages))
  const failures = value.failures.map(item => parseFailure(item, packages))
  const handoffs = value.handoffs.map(item => parseHandoff(item, packages))
  const limitations = Array.isArray(value.limitations)
    ? value.limitations.filter((item): item is string => typeof item === 'string')
    : []
  return {
    campaignId: request.campaignId,
    failures,
    handoffs,
    limitations,
    projectId: request.projectId,
    receipts,
  }
}

function publishFailure(details?: string): Error {
  const normalized = details?.replace(/\s+/gu, ' ').trim()
  return new Error(
    normalized === undefined || normalized === '' || containsSensitiveDiagnostic(normalized)
      ? 'Marketing-ops publish failed'
      : `Marketing-ops publish failed: ${normalized.slice(0, 500)}`,
  )
}

function containsSensitiveDiagnostic(value: string): boolean {
  return /bearer|cookie|credential|keychain|password|secret|token|api[-_]?key|\/private\//iu.test(value)
}

function toolText(input: unknown): string | undefined {
  if (!Array.isArray(input))
    return undefined
  const text = input
    .map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item))
        return undefined
      const record = item as Record<string, unknown>
      if (record.type !== 'text' || typeof record.text !== 'string')
        return undefined
      return record.text
    })
    .filter((item): item is string => item !== undefined)
    .join(' ')
    .trim()
  return text === '' ? undefined : text
}

function parseReceipt(
  input: unknown,
  request: MarketingOpsCampaignRequest,
  packages: readonly MarketingOpsCampaignRequest['packages'][number][],
): MarketingOpsPublishResult['receipts'][number] {
  const value = asRecord(input)
  const packageValue = matchPackage(value, packages)
  if (value.projectId !== request.projectId || value.campaignId !== request.campaignId)
    throw new Error('Marketing-ops receipt scope does not match request')
  if (value.channel !== packageValue.channel)
    throw new Error('Marketing-ops receipt channel does not match request')
  const status = value.status
  if (status !== 'published' && status !== 'failed')
    throw new Error('Marketing-ops receipt status is invalid')
  const publicUrl = optionalHttpsUrl(value.publicUrl)
  const publishedAt = stringValue(value.publishedAt)
  if (publishedAt === undefined || Number.isNaN(Date.parse(publishedAt)))
    throw new Error('Marketing-ops receipt timestamp is invalid')
  const postId = stringValue(value.postId)
  const receiptId = stringValue(value.receiptId) ?? stringValue(value.idempotencyKey)
  if (postId === undefined || receiptId === undefined)
    throw new Error('Marketing-ops receipt identity is invalid')
  const packageId = stringValue(value.packageId)
  const publicationId = stringValue(value.publicationId)
  const activityId = stringValue(value.activityId)
  if (
    packageId === undefined
    || packageId !== packageValue.contentStudio.packageId
    || publicationId === undefined
    || publicationId !== packageValue.contentStudio.publicationId
    || activityId === undefined
    || activityId !== packageValue.contentStudio.activityId
  ) {
    throw new Error('Marketing-ops receipt package provenance does not match request')
  }
  const contentHash = stringValue(value.contentHash)
  if (contentHash === undefined || !SHA256_PATTERN.test(contentHash))
    throw new Error('Marketing-ops receipt content hash is invalid')
  const contentStudioContentHash = stringValue(value.contentStudioContentHash)
  if (
    contentStudioContentHash === undefined
    || contentStudioContentHash !== packageValue.contentStudio.contentHash
  ) {
    throw new Error('Marketing-ops receipt source content hash does not match request')
  }
  const contentFormat = stringValue(value.contentFormat)
  if (contentFormat !== packageValue.contentStudio.contentFormat) {
    throw new Error('Marketing-ops receipt form does not match request')
  }
  const videoOrientation = parseVideoOrientation(value.videoOrientation)
  assertVideoOrientationMatchesPackage(
    videoOrientation,
    packageValue.channel,
    packageValue.contentStudio.contentFormat,
    packageValue.contentStudio.videoOrientation,
    'receipt',
  )
  if (value.accountRef !== undefined && stringValue(value.accountRef) === undefined)
    throw new Error('Marketing-ops receipt account is invalid')
  const accountRef = stringValue(value.accountRef)
  if (accountRef !== packageValue.contentStudio.accountRef)
    throw new Error('Marketing-ops receipt account does not match request')
  return {
    ...(accountRef === undefined ? {} : { accountRef }),
    activityId,
    channel: packageValue.channel,
    contentSha256: packageValue.contentStudio.contentHash,
    externalReceiptId: postId,
    issuedAt: new Date(publishedAt).toISOString(),
    projectId: request.projectId,
    publicationId,
    publicUrl,
    receiptId,
    source: 'marketing-ops',
    status,
    ...(videoOrientation === undefined ? {} : { videoOrientation }),
  }
}

function parseFailure(
  input: unknown,
  packages: readonly MarketingOpsCampaignRequest['packages'][number][],
): MarketingOpsPublishFailure {
  const value = asRecord(input)
  const packageValue = matchPackage(value, packages)
  if (value.channel !== packageValue.channel)
    throw new Error('Marketing-ops handoff channel does not match request')
  const code = stringValue(value.code)
  const message = stringValue(value.message)
  if (code === undefined || message === undefined || typeof value.retryable !== 'boolean')
    throw new Error('Marketing-ops failure schema is invalid')
  return {
    code,
    message,
    packageId: packageValue.contentStudio.packageId,
    retryable: value.retryable,
  }
}

function parseHandoff(
  input: unknown,
  packages: readonly MarketingOpsCampaignRequest['packages'][number][],
): MarketingOpsPublishHandoff {
  const value = asRecord(input)
  const packageValue = matchPackage(value, packages)
  const status = value.status
  if (status !== 'awaiting-owner' && status !== 'confirmed')
    throw new Error('Marketing-ops handoff status is invalid')
  const contentHash = stringValue(value.contentHash)
  const contentStudioContentHash = stringValue(value.contentStudioContentHash)
  const idempotencyKey = stringValue(value.idempotencyKey)
  if (
    contentHash === undefined
    || !SHA256_PATTERN.test(contentHash)
    || contentStudioContentHash === undefined
    || contentStudioContentHash !== packageValue.contentStudio.contentHash
    || idempotencyKey === undefined
    || !ID_PATTERN.test(idempotencyKey)
  ) {
    throw new Error('Marketing-ops handoff identity is invalid')
  }
  const form = stringValue(value.form)
  if (form !== packageValue.contentStudio.contentFormat)
    throw new Error('Marketing-ops handoff form does not match request')
  const videoOrientation = parseVideoOrientation(value.videoOrientation)
  assertVideoOrientationMatchesPackage(
    videoOrientation,
    packageValue.channel,
    packageValue.contentStudio.contentFormat,
    packageValue.contentStudio.videoOrientation,
    'handoff',
  )
  return {
    contentHash,
    contentStudioContentHash,
    form,
    idempotencyKey,
    ...(typeof value.nextAction === 'string' ? { nextAction: value.nextAction } : {}),
    packageId: packageValue.contentStudio.packageId,
    publicationId: packageValue.contentStudio.publicationId,
    status,
    ...(videoOrientation === undefined ? {} : { videoOrientation }),
  }
}

function parseVideoOrientation(input: unknown):
  | 'landscape'
  | 'portrait'
  | 'square'
  | undefined {
  if (input === undefined) {
    return undefined
  }
  if (input !== 'landscape' && input !== 'portrait' && input !== 'square') {
    throw new Error('Marketing-ops video orientation is invalid')
  }
  return input
}

function assertVideoOrientationMatchesPackage(
  actual: 'landscape' | 'portrait' | 'square' | undefined,
  channel: string,
  contentFormat: string,
  expected: 'landscape' | 'portrait' | 'square' | undefined,
  resultKind: 'receipt' | 'handoff',
): void {
  if (contentFormat === 'video') {
    if (
      actual !== expected
      || (channel === 'bilibili' && actual !== 'landscape' && actual !== 'portrait')
      || (channel === 'bilibili' && expected !== 'landscape' && expected !== 'portrait')
    ) {
      throw new Error(`Marketing-ops ${resultKind} video orientation does not match request`)
    }
    return
  }
  if (actual !== undefined)
    throw new Error(`Marketing-ops ${resultKind} has unexpected video orientation`)
}

function matchPackage(
  value: Record<string, unknown>,
  packages: readonly MarketingOpsCampaignRequest['packages'][number][],
): MarketingOpsCampaignRequest['packages'][number] {
  const packageId = stringValue(value.packageId)
  const channel = value.channel
  const candidates = packages.filter(packageValue =>
    (packageId === undefined || packageValue.contentStudio.packageId === packageId)
    && (channel === undefined || packageValue.channel === channel),
  )
  if (candidates.length !== 1)
    throw new Error('Marketing-ops result cannot be mapped to one package')
  return candidates[0]!
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error('Marketing-ops publish result schema is invalid')
  assertNoSensitiveKeys(input)
  return input as Record<string, unknown>
}

function stringValue(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined
}

function optionalHttpsUrl(input: unknown): string | undefined {
  if (input === undefined)
    return undefined
  const value = stringValue(input)
  if (value === undefined)
    throw new Error('Marketing-ops receipt URL is invalid')
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error('Marketing-ops receipt URL is invalid')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Marketing-ops receipt URL is invalid')
  return value
}
