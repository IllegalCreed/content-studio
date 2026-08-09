// @env node

import type {
  ChannelId,
  MarketingOpsChannelHealth,
  MarketingOpsChannelNextStep,
  MarketingOpsChannelsStatusSnapshot,
  MarketingOpsChannelStatus,
  MarketingOpsCompatibilityAssessment,
  MarketingOpsCompatibilityInput,
  MarketingOpsMcpStatusClientOptions,
  MarketingOpsPublicationReceipt,
  MarketingOpsPublicationRequest,
  MarketingOpsStatusClient,
  MarketingOpsStatusClientOptions,
  PublicationReceipt,
} from '../types'
import {
  CHANNEL_BLUEPRINTS,
  MARKETING_OPS_COMPATIBILITY_MATRIX,
  MARKETING_OPS_RUNTIME_NAME,
  MARKETING_OPS_STATUS_TTL_MS,
} from '../constants'
import { assertNoSensitiveKeys } from '../validation'

export interface MarketingOpsClient {
  /**
   * 真实实现由随附的 marketing-ops 运行时提供；Content Studio 不在这里执行渠道写入。
   */
  publish: (input: MarketingOpsPublicationRequest) => Promise<MarketingOpsPublicationReceipt>
}

export interface FakeMarketingOpsClientOptions {
  now?: () => Date
  publicOrigin?: string
}

const MARKETING_OPS_CHANNEL_HEALTH = new Set<MarketingOpsChannelHealth>([
  'blocked',
  'not-configured',
  'ready',
  'reauth-required',
])
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u
const RUNTIME_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/u

export function assessMarketingOpsCompatibility(
  input: MarketingOpsCompatibilityInput,
): MarketingOpsCompatibilityAssessment {
  const compatibility = MARKETING_OPS_COMPATIBILITY_MATRIX[0]
  const base = {
    contractVersion: input.contractVersion,
    expectedContractVersion: compatibility.contractVersion,
    runtimeVersion: input.runtimeVersion,
  }
  if (input.runtimeName !== MARKETING_OPS_RUNTIME_NAME) {
    return { ...base, compatible: false, issue: 'runtime-name' }
  }
  const runtimeVersion = RUNTIME_VERSION_PATTERN.exec(input.runtimeVersion)
  if (
    runtimeVersion === null
    || Number(runtimeVersion[1]) !== compatibility.runtimeMajor
    || Number(runtimeVersion[2]) !== compatibility.runtimeMinor
  ) {
    return { ...base, compatible: false, issue: 'runtime-version' }
  }
  if (input.contractVersion !== compatibility.contractVersion) {
    return { ...base, compatible: false, issue: 'contract-version' }
  }
  return { ...base, compatible: true }
}

export function createMarketingOpsStatusClient(
  options: MarketingOpsStatusClientOptions,
): MarketingOpsStatusClient {
  const now = options.now ?? (() => new Date())
  return {
    getChannelsStatus: async (projectId) => {
      assertProjectId(projectId)
      const runtime = parseRuntimeInfo(await options.transport.getRuntimeInfo())
      const runtimeAssessment = assessMarketingOpsCompatibility({
        contractVersion: MARKETING_OPS_COMPATIBILITY_MATRIX[0].contractVersion,
        runtimeName: runtime.name,
        runtimeVersion: runtime.version,
      })
      if (!runtimeAssessment.compatible) {
        throw new Error(
          `Incompatible marketing-ops runtime: ${runtimeAssessment.issue}`,
        )
      }
      const response = parseChannelsStatusResponse(
        await options.transport.getChannelsStatus({ projectId }),
        projectId,
      )
      const compatibility = assessMarketingOpsCompatibility({
        contractVersion: response.contractVersion,
        runtimeName: runtime.name,
        runtimeVersion: runtime.version,
      })
      if (!compatibility.compatible) {
        throw new Error(
          `Incompatible marketing-ops contract: ${compatibility.issue}`,
        )
      }
      const observedAt = now()
      const observedAtMs = observedAt.getTime()
      if (!Number.isFinite(observedAtMs))
        throw new Error('Marketing-ops status clock returned an invalid date')
      return {
        authorizesExternalWrite: false,
        channels: response.channels,
        contractVersion: response.contractVersion,
        expiresAt: new Date(
          observedAtMs + MARKETING_OPS_STATUS_TTL_MS,
        ).toISOString(),
        observedAt: observedAt.toISOString(),
        projectId,
        runtimeVersion: runtime.version,
      }
    },
  }
}

/**
 * Narrows an initialized MCP client to the single read-only status tool.
 * Text content is deliberately ignored; only structuredContent crosses into
 * the status parser.
 */
export function createMarketingOpsMcpStatusClient(
  options: MarketingOpsMcpStatusClientOptions,
): MarketingOpsStatusClient {
  return createMarketingOpsStatusClient({
    ...(options.now === undefined ? {} : { now: options.now }),
    transport: {
      getChannelsStatus: async input => parseMarketingOpsMcpToolResult(
        await options.mcp.callTool({
          arguments: input,
          name: 'channels_status',
        }),
      ),
      getRuntimeInfo: async () => options.mcp.getServerVersion(),
    },
  })
}

export function isMarketingOpsStatusSnapshotFresh(
  snapshot: MarketingOpsChannelsStatusSnapshot,
  now = new Date(),
): boolean {
  const observedAt = Date.parse(snapshot.observedAt)
  const expiresAt = Date.parse(snapshot.expiresAt)
  const current = now.getTime()
  return Number.isFinite(observedAt)
    && Number.isFinite(expiresAt)
    && Number.isFinite(current)
    && expiresAt > observedAt
    && expiresAt - observedAt <= MARKETING_OPS_STATUS_TTL_MS
    && current >= observedAt
    && current < expiresAt
}

/**
 * 仅用于本地契约测试的假适配器。它不启动浏览器、不读取凭据，也不连接任何渠道。
 */
export function createFakeMarketingOpsClient(
  options: FakeMarketingOpsClientOptions = {},
): MarketingOpsClient {
  const now = options.now ?? (() => new Date())
  const publicOrigin = options.publicOrigin ?? 'https://marketing-ops.invalid'
  return {
    publish: async (input) => {
      const issuedAt = now().toISOString()
      const externalReceiptId = `fixture-${input.publicationId}`
      return {
        accountRef: input.accountRef,
        activityId: input.activityId,
        channel: input.channel,
        contentSha256: input.contentSha256,
        externalReceiptId,
        issuedAt,
        projectId: input.projectId,
        publicationId: input.publicationId,
        publicUrl: `${publicOrigin}/${encodeURIComponent(input.publicationId)}`,
        receiptId: `marketing-ops-${input.publicationId}`,
        source: 'marketing-ops',
        status: 'published',
      }
    },
  }
}

export interface MarketingOpsReceiptMatch {
  accountRef?: string
  activityId: string
  channel: ChannelId
  projectId: string
  publicationId: string
}

export function assertMatchingMarketingOpsReceipt(
  receipt: PublicationReceipt,
  expected: MarketingOpsReceiptMatch,
): asserts receipt is MarketingOpsPublicationReceipt {
  if (receipt.source !== 'marketing-ops')
    throw new Error('Published receipt must come from marketing-ops')
  if (receipt.issuedAt === undefined || Number.isNaN(Date.parse(receipt.issuedAt)))
    throw new Error('marketing-ops receipt must include a valid issuedAt timestamp')
  if (
    receipt.projectId !== expected.projectId
    || receipt.activityId !== expected.activityId
    || receipt.publicationId !== expected.publicationId
    || receipt.channel !== expected.channel
  ) {
    throw new Error('marketing-ops receipt must match project, activity, publication, and channel')
  }
  if (expected.accountRef !== undefined && receipt.accountRef !== expected.accountRef)
    throw new Error('marketing-ops receipt must match the bound channel account')
}

function parseRuntimeInfo(input: unknown): { name: string, version: string } {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'marketing-ops runtime info')
  assertSupportedKeys(value, ['name', 'version'], 'marketing-ops runtime info')
  return {
    name: stringField(value.name, 'marketing-ops runtime name', 64),
    version: stringField(value.version, 'marketing-ops runtime version', 128),
  }
}

function parseMarketingOpsMcpToolResult(input: unknown): unknown {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'marketing-ops MCP tool result')
  assertSupportedKeys(
    value,
    ['_meta', 'content', 'isError', 'structuredContent'],
    'marketing-ops MCP tool result',
  )
  if (value.isError !== undefined && typeof value.isError !== 'boolean')
    throw new Error('Marketing-ops MCP tool isError must be a boolean')
  if (value.isError === true)
    throw new Error('Marketing-ops MCP tool failed')
  if (value.structuredContent === undefined)
    throw new Error('Marketing-ops MCP tool must return structuredContent')
  return value.structuredContent
}

function parseChannelsStatusResponse(
  input: unknown,
  projectId: string,
): {
  channels: MarketingOpsChannelStatus[]
  contractVersion: number
} {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'marketing-ops channels status')
  assertSupportedKeys(
    value,
    ['channels', 'contractVersion', 'projectId'],
    'marketing-ops channels status',
  )
  if (value.projectId !== projectId)
    throw new Error('Marketing-ops channels status must match the requested project')
  if (!Number.isInteger(value.contractVersion) || (value.contractVersion as number) < 1)
    throw new Error('Marketing-ops contract version must be a positive integer')
  if (!Array.isArray(value.channels))
    throw new Error('Marketing-ops channels status must include a channels array')
  const seen = new Set<ChannelId>()
  const channels = value.channels.map((inputChannel, index) => {
    const channel = parseChannelStatus(inputChannel, index)
    if (seen.has(channel.channel))
      throw new Error(`Duplicate marketing-ops channel status: ${channel.channel}`)
    seen.add(channel.channel)
    return channel
  })
  return {
    channels,
    contractVersion: value.contractVersion as number,
  }
}

function parseChannelStatus(input: unknown, index: number): MarketingOpsChannelStatus {
  const value = asRecord(input, `marketing-ops channels[${index}]`)
  assertSupportedKeys(
    value,
    ['adapterReady', 'alias', 'channel', 'health', 'nextAction'],
    `marketing-ops channels[${index}]`,
  )
  const channel = stringField(
    value.channel,
    `marketing-ops channels[${index}].channel`,
    64,
  )
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new Error(`Unsupported marketing-ops channel status: ${channel}`)
  const health = stringField(
    value.health,
    `marketing-ops channels[${index}].health`,
    32,
  )
  if (!MARKETING_OPS_CHANNEL_HEALTH.has(health as MarketingOpsChannelHealth))
    throw new Error(`Unsupported marketing-ops channel health: ${health}`)
  if (typeof value.adapterReady !== 'boolean')
    throw new Error('Marketing-ops channel adapterReady must be a boolean')
  const accountAlias = nullableStringField(
    value.alias,
    `marketing-ops channels[${index}].alias`,
    128,
  )
  nullableStringField(
    value.nextAction,
    `marketing-ops channels[${index}].nextAction`,
    256,
  )
  return {
    ...(accountAlias === undefined ? {} : { accountAlias }),
    adapterReady: value.adapterReady,
    channel: channel as ChannelId,
    health: health as MarketingOpsChannelHealth,
    nextStep: channelNextStep(
      health as MarketingOpsChannelHealth,
      value.adapterReady,
    ),
  }
}

function channelNextStep(
  health: MarketingOpsChannelHealth,
  adapterReady: boolean,
): MarketingOpsChannelNextStep {
  if (health === 'ready' && adapterReady)
    return 'ready'
  if (health === 'reauth-required')
    return 'reauthorize'
  if (health === 'not-configured')
    return 'configure'
  return 'blocked'
}

function assertProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId))
    throw new Error('Marketing-ops projectId is invalid')
}

function asRecord(input: unknown, name: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new Error(`${name} must be an object`)
  return input as Record<string, unknown>
}

function assertSupportedKeys(
  value: Record<string, unknown>,
  supported: readonly string[],
  name: string,
): void {
  const supportedKeys = new Set(supported)
  const unsupported = Object.keys(value).find(key => !supportedKeys.has(key))
  if (unsupported !== undefined)
    throw new Error(`${name} contains unsupported field: ${unsupported}`)
}

function stringField(input: unknown, name: string, maxLength: number): string {
  if (
    typeof input !== 'string'
    || input.trim() === ''
    || input.length > maxLength
    || [...input].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    throw new Error(`${name} must be a bounded text value`)
  }
  return input
}

function nullableStringField(
  input: unknown,
  name: string,
  maxLength: number,
): string | undefined {
  if (input === null)
    return undefined
  return stringField(input, name, maxLength)
}
