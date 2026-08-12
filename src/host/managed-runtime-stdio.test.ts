// @env node

import type { ManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import type {
  ManagedMarketingOpsStdioClient,
  ManagedMarketingOpsStdioTransport,
} from './managed-runtime-stdio'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import { createManagedMarketingOpsStdioConnector } from './managed-runtime-stdio'

const temporaryDirectories: string[] = []

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function createRuntimeAsset(
  server = 'managed marketing-ops server fixture\n',
): Promise<ManagedMarketingOpsRuntimeAsset> {
  const parent = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'content-studio-managed-stdio-')))
  temporaryDirectories.push(parent)
  const root = join(parent, 'runtimes', 'marketing-ops', '0.1.0')
  const helper = 'managed marketing-ops keychain helper fixture\n'
  const browsers = '{"browsers":[]}\n'
  const bundle = 'managed marketing-ops playwright bundle fixture\n'
  const license = 'managed playwright license fixture\n'
  const notice = 'managed playwright notice fixture\n'
  const thirdPartyNotices = 'managed playwright third-party notices fixture\n'
  const packageJson = JSON.stringify({
    name: '@illegalcreed/marketing-ops',
    private: true,
    type: 'module',
    version: '0.1.0',
  })
  await mkdir(join(root, 'dist'), { recursive: true, mode: 0o700 })
  await mkdir(join(root, 'LICENSES', 'playwright-core'), { recursive: true, mode: 0o700 })
  await writeFile(join(root, 'browsers.json'), browsers, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/LICENSE'), license, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/NOTICE'), notice, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/ThirdPartyNotices.txt'), thirdPartyNotices, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'dist/server.js'), server, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'dist/keychain-helper'), helper, { encoding: 'utf8', mode: 0o700 })
  await writeFile(join(root, 'dist/playwright-core.bundle.cjs'), bundle, { encoding: 'utf8', mode: 0o600 })
  await writeFile(join(root, 'package.json'), packageJson, { encoding: 'utf8', mode: 0o600 })
  const manifest = JSON.stringify({
    contractVersion: 3,
    files: [
      { path: 'browsers.json', sha256: sha256(browsers) },
      { path: 'LICENSES/playwright-core/LICENSE', sha256: sha256(license) },
      { path: 'LICENSES/playwright-core/NOTICE', sha256: sha256(notice) },
      { path: 'LICENSES/playwright-core/ThirdPartyNotices.txt', sha256: sha256(thirdPartyNotices) },
      { path: 'dist/keychain-helper', sha256: sha256(helper) },
      { path: 'dist/playwright-core.bundle.cjs', sha256: sha256(bundle) },
      { path: 'dist/server.js', sha256: sha256(server) },
      { path: 'package.json', sha256: sha256(packageJson) },
    ],
    runtimeName: 'marketing-ops',
    runtimeVersion: '0.1.0',
    schemaVersion: 1,
  })
  await writeFile(join(root, 'runtime-manifest.json'), manifest, { encoding: 'utf8', mode: 0o600 })
  await chmod(join(parent, 'runtimes'), 0o700)
  await chmod(join(parent, 'runtimes', 'marketing-ops'), 0o700)
  await chmod(root, 0o700)
  await chmod(join(root, 'dist'), 0o700)
  await chmod(join(root, 'LICENSES'), 0o700)
  await chmod(join(root, 'LICENSES/playwright-core'), 0o700)
  await chmod(join(root, 'dist/keychain-helper'), 0o700)
  const asset = await resolveManagedMarketingOpsRuntimeAsset(root, sha256(manifest))
  if (asset === null)
    throw new Error('fixture asset could not be verified')
  return asset
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

function createFakeConnection(): {
  client: ManagedMarketingOpsStdioClient
  transport: ManagedMarketingOpsStdioTransport
} {
  const transport: ManagedMarketingOpsStdioTransport = {
    close: vi.fn(async () => undefined),
    stderr: new PassThrough(),
  }
  const client: ManagedMarketingOpsStdioClient = {
    callTool: vi.fn(async () => ({ structuredContent: { ok: true } })),
    close: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    getServerVersion: vi.fn(() => ({ name: 'marketing-ops', version: '0.1.0' })),
  }
  return { client, transport }
}

function createMcpFixtureServer(): string {
  return String.raw`
let buffer = Buffer.alloc(0);
function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function handle(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      capabilities: { tools: {} },
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      serverInfo: { name: 'marketing-ops', version: '0.1.0' },
    }});
    return;
  }
  if (message.method === 'tools/call') {
    const projectId = message.params?.arguments?.projectId;
    send({ jsonrpc: '2.0', id: message.id, result: {
      content: [{ type: 'text', text: 'fixture' }],
      structuredContent: {
        channels: [],
        contractVersion: 3,
        projectId,
        runtimeEnvKeys: Object.keys(process.env),
        pid: process.pid,
      },
    }});
  }
}

process.stderr.write('fixture stderr '.repeat(4096));
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf('\n');
    if (separator < 0) return;
    const body = buffer.toString('utf8', 0, separator).replace(/\r$/u, '');
    buffer = buffer.subarray(separator + 1);
    handle(JSON.parse(body));
  }
});
`
}

function createOverflowServer(): string {
  return 'process.stdout.write(\'x\'.repeat(300 * 1024)); setInterval(() => undefined, 1_000);\n'
}

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    }
    catch {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return false
}

describe('managed marketing-ops stdio connector', () => {
  it('uses only fixed Node/entrypoint parameters and exposes the narrow session', async () => {
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    let parameters: Record<string, unknown> | undefined
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: (input) => {
        parameters = input
        return fake.transport
      },
    })

    const session = await connector.connect(asset)
    expect(parameters).toMatchObject({
      args: [asset.entrypoint],
      command: process.execPath,
      cwd: asset.runtimeRoot,
      maxBufferSize: 256 * 1024,
      stderr: 'pipe',
    })
    const expectedEnvironmentKeys = process.platform === 'win32'
      ? [
          'APPDATA',
          'LOCALAPPDATA',
          'PATH',
          'TEMP',
          'TMP',
          'USERPROFILE',
        ]
      : [
          'GH_CONFIG_DIR',
          'HOME',
          'PATH',
          'TMPDIR',
          'XDG_CONFIG_HOME',
        ]
    expect(Object.keys(parameters?.env ?? {}).sort()).toEqual(
      [
        ...expectedEnvironmentKeys.filter(key => process.env[key] !== undefined),
        'MARKETING_OPS_BILIBILI_ASSET_BUNDLE_ROOT',
      ].sort(),
    )
    expect(parameters?.env).toMatchObject({
      MARKETING_OPS_BILIBILI_ASSET_BUNDLE_ROOT: join(asset.runtimeRoot, 'asset-bundles'),
    })
    expect(parameters?.env).not.toHaveProperty('LOGNAME')
    expect(parameters?.env).not.toHaveProperty('SHELL')
    expect(parameters?.env).not.toHaveProperty('TERM')
    expect(parameters?.env).not.toHaveProperty('USER')
    expect(parameters?.env).not.toHaveProperty('NODE_OPTIONS')
    expect(parameters).not.toHaveProperty('shell')

    await expect(session.getServerVersion()).resolves.toEqual({
      name: 'marketing-ops',
      version: '0.1.0',
    })
    await expect(session.callTool({
      arguments: { projectId: 'project-a' },
      name: 'channels_status',
    })).resolves.toEqual({ structuredContent: { ok: true } })
    expect(fake.client.callTool).toHaveBeenCalledWith(
      {
        arguments: { projectId: 'project-a' },
        name: 'channels_status',
      },
      undefined,
      { timeout: 300_000 },
    )

    await session.close()
    await session.close()
    expect(fake.client.close).toHaveBeenCalledTimes(1)
    expect(fake.transport.close).toHaveBeenCalledTimes(1)
  })

  it('does not pass command/path or secret-like environment overrides', async () => {
    vi.stubEnv('MARKETING_OPS_COMMAND', '/tmp/attacker')
    vi.stubEnv('MARKETING_OPS_RUNTIME_PATH', '/tmp/attacker-runtime')
    vi.stubEnv('MARKETING_OPS_TOKEN', 'should-not-cross')
    vi.stubEnv('BLUESKY_PASSWORD', 'should-not-cross')
    vi.stubEnv('NODE_OPTIONS', '--require=/tmp/attacker')
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    let parameters: Record<string, unknown> | undefined
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: (input) => {
        parameters = input
        return fake.transport
      },
    })

    await expect(connector.connect({
      ...asset,
      entrypoint: '/tmp/attacker-server.js',
    })).rejects.toThrow('Managed marketing-ops connection unavailable')
    expect(parameters).toBeUndefined()

    await connector.connect(asset)
    const environment = parameters?.env as Record<string, string> | undefined
    expect(environment).toBeDefined()
    expect(Object.keys(environment ?? {}).some(key => /MARKETING_OPS_COMMAND|MARKETING_OPS_RUNTIME_PATH|MARKETING_OPS_TOKEN|BLUESKY|NODE_OPTIONS|PASSWORD|TOKEN/u.test(key))).toBe(false)
    expect(environment?.MARKETING_OPS_BILIBILI_ASSET_BUNDLE_ROOT).toBe(join(asset.runtimeRoot, 'asset-bundles'))
    expect(parameters?.command).toBe(process.execPath)
    expect(parameters?.args).toEqual([asset.entrypoint])
  })

  it('does not spawn when an installed runtime layout changes after handoff', async () => {
    const modeChanged = await createRuntimeAsset()
    await chmod(join(modeChanged.runtimeRoot, 'dist'), 0o750)
    const modeTransport = vi.fn(() => createFakeConnection().transport)
    const modeConnector = createManagedMarketingOpsStdioConnector({
      createTransport: modeTransport,
    })
    await expect(modeConnector.connect(modeChanged)).rejects.toThrow(
      'Managed marketing-ops connection unavailable',
    )
    expect(modeTransport).not.toHaveBeenCalled()

    const extraEntry = await createRuntimeAsset()
    await writeFile(join(extraEntry.runtimeRoot, 'unexpected'), 'extra\n', { mode: 0o600 })
    const extraTransport = vi.fn(() => createFakeConnection().transport)
    const extraConnector = createManagedMarketingOpsStdioConnector({
      createTransport: extraTransport,
    })
    await expect(extraConnector.connect(extraEntry)).rejects.toThrow(
      'Managed marketing-ops connection unavailable',
    )
    expect(extraTransport).not.toHaveBeenCalled()

    const symlinkEntry = await createRuntimeAsset()
    const outside = join(symlinkEntry.runtimeRoot, '..', 'outside-server.js')
    await writeFile(outside, 'outside\n', { mode: 0o600 })
    await rm(join(symlinkEntry.runtimeRoot, 'dist/server.js'))
    await symlink(outside, join(symlinkEntry.runtimeRoot, 'dist/server.js'))
    const symlinkTransport = vi.fn(() => createFakeConnection().transport)
    const symlinkConnector = createManagedMarketingOpsStdioConnector({
      createTransport: symlinkTransport,
    })
    await expect(symlinkConnector.connect(symlinkEntry)).rejects.toThrow(
      'Managed marketing-ops connection unavailable',
    )
    expect(symlinkTransport).not.toHaveBeenCalled()
  })

  it('cleans up and sanitizes connection failures and timeouts', async () => {
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    vi.mocked(fake.client.connect).mockRejectedValueOnce(new Error('/private/token=secret'))
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: () => fake.transport,
    })

    await expect(connector.connect(asset)).rejects.toThrow('Managed marketing-ops connection unavailable')
    expect(fake.client.close).toHaveBeenCalledTimes(1)

    const timeoutFake = createFakeConnection()
    vi.mocked(timeoutFake.client.connect).mockImplementation(() => new Promise(() => undefined))
    const timeoutConnector = createManagedMarketingOpsStdioConnector({
      connectTimeoutMs: 5,
      createClient: () => timeoutFake.client,
      createTransport: () => timeoutFake.transport,
    })
    await expect(timeoutConnector.connect(asset)).rejects.toThrow('Managed marketing-ops connection unavailable')
    expect(timeoutFake.client.close).toHaveBeenCalledTimes(1)
  })

  it('allows only channels_status and publish_campaign at runtime', async () => {
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: () => fake.transport,
    })
    const session = await connector.connect(asset)

    await expect(session.callTool({
      arguments: {
        authorization: {
          authorizedAt: '2026-08-10T10:00:00.000Z',
          source: 'owner-prompt',
        },
        campaignId: 'campaign-a',
        execution: { mode: 'assisted-prepare' },
        idempotencyKey: 'content-studio/12345678',
        packages: [],
        projectId: 'project-a',
        spec: {} as never,
      },
      name: 'publish_campaign',
    })).resolves.toEqual({ structuredContent: { ok: true } })
    expect(fake.client.callTool).toHaveBeenCalledWith(
      {
        arguments: expect.objectContaining({ campaignId: 'campaign-a' }),
        name: 'publish_campaign',
      },
      undefined,
      { timeout: 300_000 },
    )

    await expect(session.callTool({
      arguments: { projectId: 'project-a' },
      name: 'get_publish_status' as 'channels_status',
    })).rejects.toThrow('Unsupported marketing-ops tool')
    await expect(session.callTool({
      arguments: {
        authorization: {
          authorizedAt: '2026-08-10T10:00:00.000Z',
          source: 'owner-prompt',
        },
        campaignId: 'campaign-a',
        execution: { mode: 'assisted-prepare' },
        idempotencyKey: 'content-studio/12345678',
        packages: [],
        projectId: 'project-a',
        spec: {},
        token: 'not-allowed',
      } as never,
      name: 'publish_campaign',
    })).rejects.toThrow('Unsupported marketing-ops tool')
  })

  it('does not expose sensitive upstream tool failure details', async () => {
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    vi.mocked(fake.client.callTool).mockRejectedValueOnce(new Error('Bearer private-token'))
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: () => fake.transport,
    })
    const session = await connector.connect(asset)

    await expect(session.callTool({
      arguments: { projectId: 'project-a' },
      name: 'channels_status',
    })).rejects.toThrow(/^Marketing-ops tool unavailable$/)
  })

  it('bounds status calls and shares one shutdown promise', async () => {
    const asset = await createRuntimeAsset()
    const fake = createFakeConnection()
    vi.mocked(fake.client.callTool).mockImplementation(() => new Promise(() => undefined))
    let releaseClose: (() => void) | undefined
    vi.mocked(fake.client.close).mockImplementation(() => new Promise((resolve) => {
      releaseClose = resolve
    }))
    const connector = createManagedMarketingOpsStdioConnector({
      createClient: () => fake.client,
      createTransport: () => fake.transport,
      requestTimeoutMs: 5,
    })
    const session = await connector.connect(asset)

    await expect(session.callTool({
      arguments: { projectId: 'project-a' },
      name: 'channels_status',
    })).rejects.toThrow('Marketing-ops tool unavailable')
    const firstClose = session.close()
    const secondClose = session.close()
    expect(secondClose).toBe(firstClose)
    await vi.waitFor(() => expect(fake.client.close).toHaveBeenCalledTimes(1))
    releaseClose?.()
    await firstClose
    expect(fake.client.close).toHaveBeenCalledTimes(1)
  })

  it('connects to a real stdio child with a bounded output buffer and sanitized environment', async () => {
    const asset = await createRuntimeAsset(createMcpFixtureServer())
    const connector = createManagedMarketingOpsStdioConnector({
      requestTimeoutMs: 2_000,
    })
    const session = await connector.connect(asset)
    let pid: number | undefined
    try {
      const result = await session.callTool({
        arguments: { projectId: 'project-a' },
        name: 'channels_status',
      }) as { structuredContent?: Record<string, unknown> }
      const structured = result.structuredContent
      expect(structured).toMatchObject({
        contractVersion: 3,
        projectId: 'project-a',
      })
      pid = structured?.pid as number | undefined
      const environmentKeys = structured?.runtimeEnvKeys as string[] | undefined
      expect(environmentKeys).toEqual(expect.arrayContaining(['HOME', 'PATH']))
      expect(environmentKeys).not.toEqual(expect.arrayContaining([
        'LOGNAME',
        'SHELL',
        'TERM',
        'USER',
      ]))
      expect(environmentKeys?.some(key => /TOKEN|PASSWORD|NODE_OPTIONS|CONTENT_STUDIO_/u.test(key))).toBe(false)
    }
    finally {
      await session.close()
    }
    expect(pid).toEqual(expect.any(Number))
    await expect(waitForExit(pid!)).resolves.toBe(true)
  })

  it('fails closed when a child exceeds the bounded stdio output buffer', async () => {
    const asset = await createRuntimeAsset(createOverflowServer())
    const connector = createManagedMarketingOpsStdioConnector({
      connectTimeoutMs: 1_000,
    })

    await expect(connector.connect(asset)).rejects.toThrow('Managed marketing-ops connection unavailable')
  })
})
