// @env node

import type { InstallerManagedRuntimeBootstrap } from './host/run'
import { createInstallerManagedRuntimeBootstrapFromHandoff } from './host/managed-runtime-bootstrap'
import { createManagedMarketingOpsStdioConnector } from './host/managed-runtime-stdio'

/**
 * Installer-only composition point. The caller must supply a handoff from an
 * installer-owned signed or embedded trust source, never from CLI arguments,
 * environment variables, project files, or MCP input.
 */
export function createContentStudioInstallerHostBootstrap(
  handoff: unknown,
): InstallerManagedRuntimeBootstrap {
  return createInstallerManagedRuntimeBootstrapFromHandoff({
    connector: createManagedMarketingOpsStdioConnector(),
    handoff,
  })
}

export { runContentStudioHost } from './host/run'
export type { ContentStudioHostOptions } from './host/run'
