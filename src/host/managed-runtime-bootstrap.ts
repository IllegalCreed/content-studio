// @env node

import type {
  MarketingOpsCampaignRequest,
  MarketingOpsManagedRuntime,
  MarketingOpsMcpClient,
  MarketingOpsMcpPublishClient,
} from '../types'
import type { ManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import type { InstallerManagedRuntimeHandoff } from './managed-runtime-handoff'
import { MARKETING_OPS_COMPATIBILITY_MATRIX } from '../constants'
import {
  assessMarketingOpsCompatibility,
  createMarketingOpsManagedRuntime,
} from '../marketing-ops/client'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { parseInstallerManagedRuntimeHandoff } from './managed-runtime-handoff'

export interface ManagedMarketingOpsMcpSession {
  callTool: (input:
    | Parameters<MarketingOpsMcpClient['callTool']>[0]
    | {
      arguments: MarketingOpsCampaignRequest
      name: 'publish_campaign'
    },
  ) => Promise<unknown>
  close: () => Promise<void> | void
  getServerVersion: () => Promise<unknown> | unknown
}

export interface ManagedMarketingOpsRuntimeConnector {
  connect: (
    asset: ManagedMarketingOpsRuntimeAsset,
  ) => Promise<ManagedMarketingOpsMcpSession>
}

export interface InstallerManagedRuntimeBootstrapOptions {
  connector: ManagedMarketingOpsRuntimeConnector
  manifestSha256: string
  runtimeRoot: string
}

export interface InstallerManagedRuntimeHandoffBootstrapOptions {
  connector: ManagedMarketingOpsRuntimeConnector
  handoff: unknown
}

/**
 * Converts an installer-owned handoff into the existing narrow bootstrap only
 * after validating its exact identity and fixed runtime-root shape.
 */
export function createInstallerManagedRuntimeBootstrapFromHandoff(
  options: InstallerManagedRuntimeHandoffBootstrapOptions,
): { start: () => Promise<MarketingOpsManagedRuntime | undefined> } {
  const handoff = parseInstallerManagedRuntimeHandoff(options.handoff)
  if (handoff === null)
    return { start: async () => undefined }
  return createInstallerManagedRuntimeBootstrapFromValidatedHandoff(
    options.connector,
    handoff,
  )
}

/**
 * Builds the installer-side bootstrap around a runtime asset already pinned by
 * the installer. It does not infer commands, paths, credentials, or a trust
 * digest from user input. Any validation or connection failure stays private
 * and leaves Content Studio running without a marketing-ops runtime.
 */
export function createInstallerManagedRuntimeBootstrap(
  options: InstallerManagedRuntimeBootstrapOptions,
): { start: () => Promise<MarketingOpsManagedRuntime | undefined> } {
  let startPromise: Promise<MarketingOpsManagedRuntime | undefined> | undefined
  return {
    start: () => {
      startPromise ??= startManagedRuntime(options)
      return startPromise
    },
  }
}

function createInstallerManagedRuntimeBootstrapFromValidatedHandoff(
  connector: ManagedMarketingOpsRuntimeConnector,
  handoff: InstallerManagedRuntimeHandoff,
): { start: () => Promise<MarketingOpsManagedRuntime | undefined> } {
  return createInstallerManagedRuntimeBootstrap({
    connector,
    manifestSha256: handoff.manifestSha256,
    runtimeRoot: handoff.runtimeRoot,
  })
}

async function startManagedRuntime(
  options: InstallerManagedRuntimeBootstrapOptions,
): Promise<MarketingOpsManagedRuntime | undefined> {
  const asset = await resolveManagedMarketingOpsRuntimeAsset(
    options.runtimeRoot,
    options.manifestSha256,
  )
  if (asset === null)
    return undefined
  let session: ManagedMarketingOpsMcpSession | undefined
  try {
    const connectedSession = await options.connector.connect(asset)
    session = connectedSession
    const serverVersion = await connectedSession.getServerVersion()
    if (!isCompatibleServerVersion(serverVersion, asset)) {
      await closeQuietly(connectedSession)
      return undefined
    }
    return createMarketingOpsManagedRuntime({
      close: () => connectedSession.close(),
      mcp: {
        callTool: input => connectedSession.callTool(input),
        getServerVersion: () => connectedSession.getServerVersion(),
      },
      publishMcp: {
        callTool: input => connectedSession.callTool(input),
      } satisfies MarketingOpsMcpPublishClient,
    })
  }
  catch {
    await closeQuietly(session)
    return undefined
  }
}

function isCompatibleServerVersion(
  input: unknown,
  asset: ManagedMarketingOpsRuntimeAsset,
): boolean {
  const version = parseServerVersion(input)
  if (version === null)
    return false
  return version.version === asset.runtimeVersion
    && assessMarketingOpsCompatibility({
      contractVersion: MARKETING_OPS_COMPATIBILITY_MATRIX[0].contractVersion,
      runtimeName: version.name,
      runtimeVersion: version.version,
    }).compatible
}

function parseServerVersion(input: unknown): { name: string, version: string } | null {
  if (!isRecord(input))
    return null
  const keys = Object.keys(input)
  if (
    keys.length !== 2
    || !keys.includes('name')
    || !keys.includes('version')
    || typeof input.name !== 'string'
    || typeof input.version !== 'string'
    || input.name.length === 0
    || input.name.length > 64
    || input.version.length === 0
    || input.version.length > 128
  ) {
    return null
  }
  return { name: input.name, version: input.version }
}

async function closeQuietly(
  session: ManagedMarketingOpsMcpSession | undefined,
): Promise<void> {
  try {
    await session?.close()
  }
  catch {
    // Connection failures are deliberately represented only by an unavailable runtime.
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
