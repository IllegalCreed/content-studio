// @env node

import { describe, expect, it } from 'vitest'
import {
  createContentStudioInstallerHostBootstrap,
  verifyManagedMarketingOpsReleaseStatement,
} from './installer-host'

describe('installer host composition', () => {
  it('exports release verification only from the installer-facing entrypoint', () => {
    expect(verifyManagedMarketingOpsReleaseStatement).toBeTypeOf('function')
  })

  it('keeps invalid and unavailable handoffs fail-closed without starting a runtime', async () => {
    const invalid = createContentStudioInstallerHostBootstrap({
      contractVersion: 3,
      manifestSha256: '0'.repeat(64),
      runtimeName: 'marketing-ops',
      runtimeRoot: '/tmp/untrusted',
      runtimeVersion: '0.1.0',
    })
    const unavailable = createContentStudioInstallerHostBootstrap({
      contractVersion: 3,
      manifestSha256: '0'.repeat(64),
      runtimeName: 'marketing-ops',
      runtimeRoot: '/missing/runtimes/marketing-ops/0.1.0',
      runtimeVersion: '0.1.0',
    })

    await expect(invalid.start()).resolves.toBeUndefined()
    await expect(unavailable.start()).resolves.toBeUndefined()
  })
})
