import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInstallerManagedRuntimeBootstrap,
  createInstallerManagedRuntimeBootstrapFromHandoff,
} from './managed-runtime-bootstrap'

const temporaryDirectories: string[] = []

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function createRuntimeAsset(): Promise<{ manifestSha256: string, root: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'content-studio-managed-bootstrap-'))
  const root = join(parent, 'runtimes', 'marketing-ops', '0.1.0')
  temporaryDirectories.push(parent)
  const server = 'managed marketing-ops server fixture\n'
  const helper = 'managed marketing-ops keychain helper fixture\n'
  const browsers = '{"browsers":[]}\n'
  const bundle = 'managed marketing-ops playwright bundle fixture\n'
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'browsers.json'), browsers, 'utf8')
  await writeFile(join(root, 'dist/server.js'), server, 'utf8')
  await writeFile(join(root, 'dist/keychain-helper'), helper, 'utf8')
  await writeFile(join(root, 'dist/playwright-core.bundle.cjs'), bundle, 'utf8')
  const packageJson = JSON.stringify({
    name: '@illegalcreed/marketing-ops',
    version: '0.1.0',
  })
  await writeFile(join(root, 'package.json'), packageJson, 'utf8')
  const manifest = JSON.stringify({
    contractVersion: 3,
    files: [
      { path: 'browsers.json', sha256: sha256(browsers) },
      { path: 'dist/keychain-helper', sha256: sha256(helper) },
      { path: 'dist/playwright-core.bundle.cjs', sha256: sha256(bundle) },
      { path: 'dist/server.js', sha256: sha256(server) },
      { path: 'package.json', sha256: sha256(packageJson) },
    ],
    runtimeName: 'marketing-ops',
    runtimeVersion: '0.1.0',
    schemaVersion: 1,
  })
  await writeFile(join(root, 'runtime-manifest.json'), manifest, 'utf8')
  return { manifestSha256: sha256(manifest), root }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('installer-owned marketing-ops bootstrap', () => {
  it('connects only after asset verification, then injects the narrow read-only runtime', async () => {
    const asset = await createRuntimeAsset()
    const session = {
      callTool: vi.fn(async () => ({
        structuredContent: {
          channels: [],
          contractVersion: 3,
          projectId: 'project-a',
        },
      })),
      close: vi.fn(async () => undefined),
      getServerVersion: vi.fn(() => ({ name: 'marketing-ops', version: '0.1.0' })),
    }
    const connector = { connect: vi.fn(async () => session) }
    const bootstrap = createInstallerManagedRuntimeBootstrap({
      connector,
      manifestSha256: asset.manifestSha256,
      runtimeRoot: asset.root,
    })

    const runtime = await bootstrap.start()

    expect(runtime).toBeDefined()
    expect(connector.connect).toHaveBeenCalledWith(expect.objectContaining({
      entrypoint: expect.stringMatching(/dist\/server\.js$/u),
      runtimeVersion: '0.1.0',
    }))
    expect(session.callTool).not.toHaveBeenCalled()
    await expect(runtime!.statusClient.getChannelsStatus('project-a')).resolves.toMatchObject({
      authorizesExternalWrite: false,
      projectId: 'project-a',
    })
    expect(session.callTool).toHaveBeenCalledWith({
      arguments: { projectId: 'project-a' },
      name: 'channels_status',
    })

    await runtime!.close()
    await runtime!.close()
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('does not connect when asset verification fails', async () => {
    const connector = { connect: vi.fn() }
    const bootstrap = createInstallerManagedRuntimeBootstrap({
      connector,
      manifestSha256: '0'.repeat(64),
      runtimeRoot: '/missing/managed-runtime',
    })

    await expect(bootstrap.start()).resolves.toBeUndefined()
    expect(connector.connect).not.toHaveBeenCalled()
  })

  it('closes an incompatible connected server and exposes no managed runtime', async () => {
    const asset = await createRuntimeAsset()
    const session = {
      callTool: vi.fn(),
      close: vi.fn(async () => undefined),
      getServerVersion: vi.fn(() => ({ name: 'untrusted-runtime', version: '1.0.0' })),
    }
    const bootstrap = createInstallerManagedRuntimeBootstrap({
      connector: { connect: vi.fn(async () => session) },
      manifestSha256: asset.manifestSha256,
      runtimeRoot: asset.root,
    })

    await expect(bootstrap.start()).resolves.toBeUndefined()
    expect(session.callTool).not.toHaveBeenCalled()
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('rejects a compatible-range server when it is not the exact pinned runtime version', async () => {
    const asset = await createRuntimeAsset()
    const session = {
      callTool: vi.fn(),
      close: vi.fn(async () => undefined),
      getServerVersion: vi.fn(() => ({ name: 'marketing-ops', version: '0.1.1' })),
    }
    const bootstrap = createInstallerManagedRuntimeBootstrap({
      connector: { connect: vi.fn(async () => session) },
      manifestSha256: asset.manifestSha256,
      runtimeRoot: asset.root,
    })

    await expect(bootstrap.start()).resolves.toBeUndefined()
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('rejects an expanded or malformed server identity before exposing a runtime', async () => {
    const asset = await createRuntimeAsset()
    const session = {
      callTool: vi.fn(),
      close: vi.fn(async () => undefined),
      getServerVersion: vi.fn(() => ({
        detail: '/private/runtime/token=secret',
        name: 'marketing-ops',
        version: '0.1.0',
      })),
    }
    const bootstrap = createInstallerManagedRuntimeBootstrap({
      connector: { connect: vi.fn(async () => session) },
      manifestSha256: asset.manifestSha256,
      runtimeRoot: asset.root,
    })

    await expect(bootstrap.start()).resolves.toBeUndefined()
    expect(session.close).toHaveBeenCalledTimes(1)
  })

  it('builds the bootstrap from a validated installer handoff without widening the options', async () => {
    const asset = await createRuntimeAsset()
    const session = {
      callTool: vi.fn(),
      close: vi.fn(async () => undefined),
      getServerVersion: vi.fn(() => ({ name: 'marketing-ops', version: '0.1.0' })),
    }
    const connector = { connect: vi.fn(async () => session) }
    const bootstrap = createInstallerManagedRuntimeBootstrapFromHandoff({
      connector,
      handoff: {
        contractVersion: 3,
        manifestSha256: asset.manifestSha256,
        runtimeName: 'marketing-ops',
        runtimeRoot: asset.root,
        runtimeVersion: '0.1.0',
      },
    })

    await expect(bootstrap.start()).resolves.toBeDefined()
    expect(connector.connect).toHaveBeenCalledTimes(1)
  })

  it('does not connect from an invalid installer handoff', async () => {
    const connector = { connect: vi.fn() }
    const bootstrap = createInstallerManagedRuntimeBootstrapFromHandoff({
      connector,
      handoff: {
        contractVersion: 3,
        manifestSha256: '0'.repeat(64),
        runtimeName: 'marketing-ops',
        runtimeRoot: dirname('/tmp/not-a-fixed-runtime-root'),
        runtimeVersion: '0.1.0',
      },
    })

    await expect(bootstrap.start()).resolves.toBeUndefined()
    expect(connector.connect).not.toHaveBeenCalled()
  })
})
