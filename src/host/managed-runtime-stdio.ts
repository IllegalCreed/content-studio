// @env node

import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Stream } from 'node:stream'
import type { MarketingOpsCampaignRequest } from '../types'
import type { ManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import type {
  ManagedMarketingOpsMcpSession,
  ManagedMarketingOpsRuntimeConnector,
} from './managed-runtime-bootstrap'
import { Buffer } from 'node:buffer'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { MARKETING_OPS_MANAGED_RUNTIME_VERSION } from '../constants'
import { assertNoSensitiveKeys } from '../validation'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { verifyInstalledManagedMarketingOpsRuntime } from './managed-runtime-installed-guard'

const CLIENT_NAME = 'content-studio-host'
const CLIENT_VERSION = '0.1.0'
const RUNTIME_VERSION = MARKETING_OPS_MANAGED_RUNTIME_VERSION
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
const CLOSE_TIMEOUT_MS = 2_000
const MAX_STDERR_BYTES = 16 * 1024
const MAX_STDOUT_BUFFER_BYTES = 256 * 1024
const POSIX_SAFE_ENVIRONMENT_KEYS = [
  'GH_CONFIG_DIR',
  'HOME',
  'PATH',
  'TMPDIR',
  'XDG_CONFIG_HOME',
] as const
const WINDOWS_SAFE_ENVIRONMENT_KEYS = [
  'APPDATA',
  'LOCALAPPDATA',
  'PATH',
  'TEMP',
  'TMP',
  'USERPROFILE',
] as const
const SAFE_ENVIRONMENT_KEYS = process.platform === 'win32'
  ? WINDOWS_SAFE_ENVIRONMENT_KEYS
  : POSIX_SAFE_ENVIRONMENT_KEYS

/**
 * Small structural seam used by tests and by an installer-owned wrapper. The
 * production factory below always supplies the official SDK implementations;
 * command, path, and environment choices never come from this seam.
 */
export interface ManagedMarketingOpsStdioClient {
  callTool: (input: {
    arguments?: Record<string, unknown>
    name: string
  }, resultSchema?: unknown, options?: { timeout?: number }) => Promise<unknown>
  close: () => Promise<void>
  connect: (transport: ManagedMarketingOpsStdioTransport) => Promise<void>
  getServerVersion: () => unknown
}

export interface ManagedMarketingOpsStdioTransport {
  close: () => Promise<void>
  stderr: Stream | null
}

export interface ManagedMarketingOpsStdioConnectorOptions {
  /** Test seam; production uses the pinned SDK constructor. */
  createClient?: () => ManagedMarketingOpsStdioClient
  /** Test seam; production uses the pinned SDK constructor. */
  createTransport?: (
    parameters: StdioServerParameters,
  ) => ManagedMarketingOpsStdioTransport
  connectTimeoutMs?: number
  requestTimeoutMs?: number
}

/**
 * Creates a connector which can only launch the verified bundled runtime with
 * the current Node executable. It never consults PATH, a command argument, or
 * a user-provided runtime environment.
 */
export function createManagedMarketingOpsStdioConnector(
  options: ManagedMarketingOpsStdioConnectorOptions = {},
): ManagedMarketingOpsRuntimeConnector {
  const timeoutMs = validatedTimeout(options.connectTimeoutMs)
  const requestTimeoutMs = validatedTimeout(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
  )
  const createClient = options.createClient
    ?? (() => new Client({ name: CLIENT_NAME, version: CLIENT_VERSION }) as unknown as ManagedMarketingOpsStdioClient)
  const createTransport = options.createTransport
    ?? ((parameters: StdioServerParameters) => new StdioClientTransport(
      withSdkEnvironmentDenyOverrides(parameters),
    ))

  return {
    connect: async (asset) => {
      let transport: ManagedMarketingOpsStdioTransport | undefined
      let client: ManagedMarketingOpsStdioClient | undefined
      try {
        const verifiedAsset = await revalidateAsset(asset)
        if (verifiedAsset === null)
          throw new Error('asset')
        const parameters = createServerParameters(verifiedAsset)
        transport = createTransport(parameters)
        consumeStderr(transport.stderr)
        const connectedClient = createClient()
        client = connectedClient
        await connectWithTimeout(connectedClient, transport, timeoutMs)
        return createSession(
          connectedClient,
          transport,
          requestTimeoutMs,
          join(verifiedAsset.runtimeRoot, 'asset-bundles'),
        )
      }
      catch {
        await closeResources(client, transport)
        throw new Error('Managed marketing-ops connection unavailable')
      }
    },
  }
}

async function revalidateAsset(
  asset: ManagedMarketingOpsRuntimeAsset,
): Promise<ManagedMarketingOpsRuntimeAsset | null> {
  if (
    asset.runtimeVersion !== RUNTIME_VERSION
    || !isAbsolute(asset.runtimeRoot)
    || resolve(asset.runtimeRoot) !== asset.runtimeRoot
    || asset.entrypoint !== resolve(asset.runtimeRoot, 'dist/server.js')
    || !isFixedRuntimeRoot(asset.runtimeRoot)
  ) {
    return null
  }
  if (!await verifyInstalledManagedMarketingOpsRuntime(asset.runtimeRoot))
    return null
  const verified = await resolveManagedMarketingOpsRuntimeAsset(
    asset.runtimeRoot,
    asset.manifestSha256,
  )
  if (
    verified === null
    || verified.entrypoint !== asset.entrypoint
    || verified.runtimeRoot !== asset.runtimeRoot
    || verified.runtimeVersion !== asset.runtimeVersion
  ) {
    return null
  }
  if (!await verifyInstalledManagedMarketingOpsRuntime(verified.runtimeRoot))
    return null
  return verified
}

function isFixedRuntimeRoot(path: string): boolean {
  const segments = path.split(/[\\/]+/u).filter(Boolean)
  return segments.slice(-3).join('/') === 'runtimes/marketing-ops/0.2.0'
}

function createServerParameters(
  asset: ManagedMarketingOpsRuntimeAsset,
): StdioServerParameters {
  const assetBundleRoot = join(asset.runtimeRoot, 'asset-bundles')
  return {
    args: [asset.entrypoint],
    command: process.execPath,
    cwd: asset.runtimeRoot,
    env: safeEnvironment(assetBundleRoot),
    maxBufferSize: MAX_STDOUT_BUFFER_BYTES,
    stderr: 'pipe',
  }
}

function safeEnvironment(assetBundleRoot: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = process.env[key]
    if (value !== undefined && !value.startsWith('()'))
      environment[key] = value
  }
  environment.MARKETING_OPS_BILIBILI_ASSET_BUNDLE_ROOT = assetBundleRoot
  return environment
}

function withSdkEnvironmentDenyOverrides(
  parameters: StdioServerParameters,
): StdioServerParameters {
  // The pinned MCP SDK merges its platform defaults into every spawn. Node's
  // child_process.spawn omits undefined environment values, so these local
  // deny-overrides keep that merge from re-expanding the explicit allowlist.
  const environment: Record<string, string | undefined> = {}
  for (const key of DEFAULT_INHERITED_ENV_VARS)
    environment[key] = undefined
  Object.assign(environment, parameters.env)
  // The SDK type models only string values; this one local boundary preserves
  // Node's documented `undefined`-means-omitted spawn behavior.
  return {
    ...parameters,
    env: environment as Record<string, string>,
  }
}

function consumeStderr(stream: Stream | null): void {
  if (stream === null)
    return
  let bytes = 0
  stream.on('data', (chunk: unknown) => {
    if (bytes >= MAX_STDERR_BYTES)
      return
    const chunkBytes = typeof chunk === 'string'
      ? Buffer.byteLength(chunk)
      : chunk instanceof Uint8Array
        ? chunk.byteLength
        : MAX_STDERR_BYTES
    bytes = Math.min(MAX_STDERR_BYTES, bytes + chunkBytes)
  })
  stream.on('error', () => undefined)
  const resume = (stream as Stream & { resume: () => void }).resume
  resume.call(stream)
}

async function connectWithTimeout(
  client: ManagedMarketingOpsStdioClient,
  transport: ManagedMarketingOpsStdioTransport,
  timeoutMs: number,
): Promise<void> {
  await withTimeout(client.connect(transport), timeoutMs)
}

function createSession(
  client: ManagedMarketingOpsStdioClient,
  transport: ManagedMarketingOpsStdioTransport,
  requestTimeoutMs: number,
  assetBundleRoot: string,
): ManagedMarketingOpsMcpSession {
  let closePromise: Promise<void> | undefined
  return {
    assetBundleRoot,
    callTool: async (input) => {
      const toolInput = managedToolInput(input)
      if (toolInput === null)
        throw new Error('Unsupported marketing-ops tool')
      try {
        return await withTimeout(
          client.callTool(toolInput as unknown as {
            arguments: Record<string, unknown>
            name: string
          }, undefined, { timeout: requestTimeoutMs }),
          requestTimeoutMs,
        )
      }
      catch (error) {
        const message = error instanceof Error ? error.message.trim().slice(0, 300) : ''
        throw new Error(
          message === '' || containsSensitiveDiagnostic(message)
            ? 'Marketing-ops tool unavailable'
            : `Marketing-ops tool unavailable: ${message}`,
        )
      }
    },
    close: () => {
      closePromise ??= closeResources(client, transport)
      return closePromise
    },
    getServerVersion: async () => client.getServerVersion(),
  }
}

function containsSensitiveDiagnostic(value: string): boolean {
  return /bearer|cookie|credential|keychain|password|secret|token|api[-_]?key|\/private\//iu.test(value)
}

function managedToolInput(
  input: unknown,
): Parameters<ManagedMarketingOpsMcpSession['callTool']>[0] | null {
  if (isChannelsStatusInput(input)) {
    return {
      arguments: { projectId: input.arguments.projectId },
      name: 'channels_status',
    }
  }
  if (!isPublishCampaignInput(input))
    return null
  return {
    arguments: input.arguments,
    name: 'publish_campaign',
  }
}

function isChannelsStatusInput(
  input: unknown,
): input is { arguments: { projectId: string }, name: 'channels_status' } {
  if (!isRecord(input) || input.name !== 'channels_status' || !isRecord(input.arguments))
    return false
  const keys = Object.keys(input.arguments)
  return keys.length === 1
    && keys[0] === 'projectId'
    && typeof input.arguments.projectId === 'string'
    && /^[a-z0-9][a-z0-9-]{0,62}$/u.test(input.arguments.projectId)
}

function isPublishCampaignInput(
  input: unknown,
): input is { arguments: MarketingOpsCampaignRequest, name: 'publish_campaign' } {
  if (!isRecord(input) || input.name !== 'publish_campaign' || !isRecord(input.arguments))
    return false
  const expected = new Set([
    'authorization',
    'campaignId',
    'execution',
    'idempotencyKey',
    'packages',
    'projectId',
    'spec',
  ])
  if (
    Object.keys(input.arguments).length !== expected.size
    || Object.keys(input.arguments).some(key => !expected.has(key))
  ) {
    return false
  }
  try {
    assertNoSensitiveKeys(input.arguments)
    return true
  }
  catch {
    return false
  }
}

async function closeResources(
  client: ManagedMarketingOpsStdioClient | undefined,
  transport: ManagedMarketingOpsStdioTransport | undefined,
): Promise<void> {
  if (client !== undefined)
    await attemptClose(() => client.close())
  await attemptClose(() => transport?.close())
}

async function attemptClose(close: () => Promise<void> | undefined): Promise<boolean> {
  if (close === undefined)
    return true
  try {
    await withTimeout(Promise.resolve().then(close), CLOSE_TIMEOUT_MS)
    return true
  }
  catch {
    return false
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('operation timeout')), timeoutMs)
        timer.unref?.()
      }),
    ])
  }
  finally {
    if (timer !== undefined)
      clearTimeout(timer)
  }
}

function validatedTimeout(input: number | undefined, fallback: number = DEFAULT_CONNECT_TIMEOUT_MS): number {
  if (input === undefined)
    return fallback
  if (!Number.isInteger(input) || input < 1 || input > 30_000)
    return fallback
  return input
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
