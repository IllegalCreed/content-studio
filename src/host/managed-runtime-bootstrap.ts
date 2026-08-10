// @env node

import type { MarketingOpsManagedRuntime, MarketingOpsMcpClient } from '../types'
import type { ManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { MARKETING_OPS_COMPATIBILITY_MATRIX } from '../constants'
import {
  assessMarketingOpsCompatibility,
  createMarketingOpsManagedRuntime,
} from '../marketing-ops/client'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'

export interface ManagedMarketingOpsMcpSession extends MarketingOpsMcpClient {
  close: () => Promise<void> | void
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
  if (!isRecord(input) || typeof input.name !== 'string' || typeof input.version !== 'string')
    return false
  return input.version === asset.runtimeVersion
    && assessMarketingOpsCompatibility({
      contractVersion: MARKETING_OPS_COMPATIBILITY_MATRIX[0].contractVersion,
      runtimeName: input.name,
      runtimeVersion: input.version,
    }).compatible
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
