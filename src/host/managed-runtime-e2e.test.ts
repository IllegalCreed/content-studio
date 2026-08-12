// @env node

import type { MarketingOpsManagedRuntime } from '../types'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installManagedMarketingOpsRuntime } from '../installer-host'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { createInstallerManagedRuntimeBootstrap } from './managed-runtime-bootstrap'
import { createManagedMarketingOpsStdioConnector } from './managed-runtime-stdio'

const stagingRoot = process.env.CONTENT_STUDIO_TEST_MARKETING_OPS_STAGING
const temporaryDirectories: string[] = []

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function createPrivateHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'content-studio-marketing-ops-home-'))
  temporaryDirectories.push(home)
  const root = join(home, 'Library', 'Application Support', 'marketing-ops')
  const projects = join(root, 'projects')
  await mkdirPrivate(projects)
  await writeFile(join(projects, 'algorithm-visualizer.json'), `${JSON.stringify({
    canonicalOrigins: ['https://example.com'],
    channels: ['bilibili'],
    displayName: 'stdio fixture',
    id: 'algorithm-visualizer',
    schemaVersion: 1,
  })}\n`, { encoding: 'utf8', mode: 0o600 })
  return home
}

async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true })
  await chmod(path, 0o700)
}

async function closeRuntime(runtime: MarketingOpsManagedRuntime | undefined): Promise<void> {
  try {
    await runtime?.close()
  }
  catch {
    // The test must not expose child stderr or transport details.
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100,
  })))
})

describe.runIf(process.platform !== 'win32' && stagingRoot !== undefined)(
  'managed marketing-ops fresh-home handoff',
  () => {
    it('installs the runtime and stops at official Bilibili login or risk-control handoff', async () => {
      const home = await createPrivateHome()
      vi.stubEnv('HOME', home)
      const installerRoot = await mkdtemp(join(tmpdir(), 'content-studio-marketing-ops-install-'))
      temporaryDirectories.push(installerRoot)
      const canonicalInstallerRoot = await realpath(installerRoot)
      const manifest = await readFile(join(stagingRoot!, 'runtime-manifest.json'))
      const manifestSha256 = sha256(manifest)
      expect(await resolveManagedMarketingOpsRuntimeAsset(stagingRoot!, manifestSha256)).not.toBeNull()

      const handoff = await installManagedMarketingOpsRuntime({
        expectedManifestSha256: manifestSha256,
        installerRoot: canonicalInstallerRoot,
        sourceRoot: stagingRoot!,
      })
      expect(handoff).not.toBeNull()
      const bootstrap = createInstallerManagedRuntimeBootstrap({
        connector: createManagedMarketingOpsStdioConnector({ requestTimeoutMs: 30_000 }),
        manifestSha256: handoff!.manifestSha256,
        runtimeRoot: handoff!.runtimeRoot,
      })
      const runtime = await bootstrap.start()
      try {
        expect(runtime).toBeDefined()
        const status = await runtime!.statusClient.getChannelsStatus('algorithm-visualizer')
        const bilibili = status.channels.find(channel => channel.channel === 'bilibili')

        expect(status.capabilities).toContain('content-studio-assisted-publication-v1')
        expect(bilibili).toMatchObject({
          adapterReady: false,
          assistedPublicationReady: false,
          channel: 'bilibili',
        })
        expect(bilibili).not.toHaveProperty('accountRef')
        expect(bilibili?.health).not.toBe('ready')
        expect(['blocked', 'reauthorize']).toContain(bilibili?.nextStep)
      }
      finally {
        await closeRuntime(runtime)
      }
    }, 45_000)
  },
)
