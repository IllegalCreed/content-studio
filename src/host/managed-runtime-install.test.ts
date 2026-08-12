// @env node

import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import {
  installManagedMarketingOpsRuntime,
  isOwnedPrivatePosixEntry,
} from './managed-runtime-install'

const temporaryDirectories: string[] = []

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix))
  const safeRoot = await realpath(root)
  temporaryDirectories.push(safeRoot)
  await chmod(safeRoot, 0o700)
  return safeRoot
}

async function createRuntimeStaging(): Promise<{
  manifestSha256: string
  root: string
  server: string
}> {
  const root = await createTemporaryDirectory('content-studio-runtime-staging-')
  const server = 'managed marketing-ops staging server\n'
  const helper = 'managed marketing-ops staging keychain helper\n'
  const browsers = '{"browsers":[]}\n'
  const bundle = 'managed marketing-ops staging playwright bundle\n'
  const license = 'managed playwright license fixture\n'
  const notice = 'managed playwright notice fixture\n'
  const thirdPartyNotices = 'managed playwright third-party notices fixture\n'
  const packageJson = JSON.stringify({
    name: '@illegalcreed/marketing-ops',
    private: true,
    type: 'module',
    version: '0.1.0',
  })
  await mkdir(join(root, 'dist'), { mode: 0o700 })
  await mkdir(join(root, 'LICENSES', 'playwright-core'), { mode: 0o700, recursive: true })
  await chmod(join(root, 'dist'), 0o700)
  await chmod(join(root, 'LICENSES'), 0o700)
  await chmod(join(root, 'LICENSES/playwright-core'), 0o700)
  await writeFile(join(root, 'browsers.json'), browsers, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/LICENSE'), license, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/NOTICE'), notice, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/ThirdPartyNotices.txt'), thirdPartyNotices, { mode: 0o600 })
  await writeFile(join(root, 'dist/server.js'), server, { mode: 0o600 })
  await writeFile(join(root, 'dist/keychain-helper'), helper, { mode: 0o700 })
  await chmod(join(root, 'dist/keychain-helper'), 0o700)
  await writeFile(join(root, 'dist/playwright-core.bundle.cjs'), bundle, { mode: 0o600 })
  await writeFile(join(root, 'package.json'), packageJson, { mode: 0o600 })
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
  await writeFile(join(root, 'runtime-manifest.json'), manifest, { mode: 0o600 })
  return { manifestSha256: sha256(manifest), root, server }
}

function runtimeRoot(installerRoot: string): string {
  return join(installerRoot, 'runtimes', 'marketing-ops', '0.1.0')
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe.runIf(process.platform !== 'win32')('installer-owned marketing-ops runtime installation', () => {
  it('claims the fixed version directory atomically, writes the manifest last, and returns a handoff', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const destination = runtimeRoot(installerRoot)

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toEqual({
      contractVersion: 3,
      manifestSha256: staging.manifestSha256,
      runtimeName: 'marketing-ops',
      runtimeRoot: destination,
      runtimeVersion: '0.1.0',
    })

    await expect(readdir(destination)).resolves.toEqual([
      'LICENSES',
      'browsers.json',
      'dist',
      'package.json',
      'runtime-manifest.json',
    ])
    await expect(readdir(join(destination, 'LICENSES'))).resolves.toEqual(['playwright-core'])
    await expect(readdir(join(destination, 'LICENSES', 'playwright-core'))).resolves.toEqual([
      'LICENSE',
      'NOTICE',
      'ThirdPartyNotices.txt',
    ])
    await expect(readdir(join(destination, 'dist'))).resolves.toEqual([
      'keychain-helper',
      'playwright-core.bundle.cjs',
      'server.js',
    ])
    await expect(readFile(join(destination, 'browsers.json'), 'utf8')).resolves.toBe(
      await readFile(join(staging.root, 'browsers.json'), 'utf8'),
    )
    await expect(readFile(join(destination, 'dist/server.js'), 'utf8')).resolves.toBe(staging.server)
    await expect(lstat(destination)).resolves.toMatchObject({ mode: expect.any(Number) })
    expect((await lstat(destination)).mode & 0o777).toBe(0o700)
    expect((await lstat(join(destination, 'dist'))).mode & 0o777).toBe(0o700)
    expect((await lstat(join(destination, 'LICENSES'))).mode & 0o777).toBe(0o700)
    expect((await lstat(join(destination, 'LICENSES/playwright-core'))).mode & 0o777).toBe(0o700)
    expect((await lstat(join(destination, 'browsers.json'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'LICENSES/playwright-core/LICENSE'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'LICENSES/playwright-core/NOTICE'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'LICENSES/playwright-core/ThirdPartyNotices.txt'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'dist/server.js'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'dist/keychain-helper'))).mode & 0o777).toBe(0o700)
    expect((await lstat(join(destination, 'dist/playwright-core.bundle.cjs'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'package.json'))).mode & 0o777).toBe(0o600)
    expect((await lstat(join(destination, 'runtime-manifest.json'))).mode & 0o777).toBe(0o600)
  })

  it('rejects an external digest mismatch before creating the fixed runtime destination', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const destination = runtimeRoot(installerRoot)

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: '0'.repeat(64),
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toBeNull()
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not overwrite an existing fixed runtime destination', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const destination = runtimeRoot(installerRoot)
    await mkdir(destination, { mode: 0o700, recursive: true })
    await chmod(destination, 0o700)
    await writeFile(join(destination, 'keep-me'), 'existing runtime data\n', { mode: 0o600 })

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toBeNull()
    await expect(readFile(join(destination, 'keep-me'), 'utf8')).resolves.toBe('existing runtime data\n')
  })

  it('rejects an existing partial destination without treating it as installed', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const destination = runtimeRoot(installerRoot)
    await mkdir(join(destination, 'dist'), { mode: 0o700, recursive: true })
    await chmod(destination, 0o700)
    await chmod(join(destination, 'dist'), 0o700)
    await writeFile(join(destination, 'dist/server.js'), 'partial\n', { mode: 0o600 })

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toBeNull()
    await expect(readFile(join(destination, 'dist/server.js'), 'utf8')).resolves.toBe('partial\n')
    await expect(lstat(join(destination, 'runtime-manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(resolveManagedMarketingOpsRuntimeAsset(destination, staging.manifestSha256)).resolves.toBeNull()
  })

  it('allows only one concurrent installer to claim the fixed version directory', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const input = {
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    }

    const results = await Promise.all([
      installManagedMarketingOpsRuntime(input),
      installManagedMarketingOpsRuntime(input),
    ])
    expect(results.filter(result => result !== null)).toHaveLength(1)
    expect(results.filter(result => result === null)).toHaveLength(1)
  })

  it('fails closed when the installer-owned root is writable by group or other users', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    await chmod(installerRoot, 0o777)

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toBeNull()
    await expect(lstat(join(installerRoot, 'runtimes'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symlinked staging file even when the fixed source root is explicit', async () => {
    const staging = await createRuntimeStaging()
    const installerRoot = await createTemporaryDirectory('content-studio-installer-root-')
    const outside = join(staging.root, 'outside-server.js')
    await writeFile(outside, staging.server, { mode: 0o600 })
    await rm(join(staging.root, 'dist/server.js'))
    await symlink(outside, join(staging.root, 'dist/server.js'))

    await expect(installManagedMarketingOpsRuntime({
      expectedManifestSha256: staging.manifestSha256,
      installerRoot,
      sourceRoot: staging.root,
    })).resolves.toBeNull()
    await expect(lstat(runtimeRoot(installerRoot))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('posix private installer entry checks', () => {
  it('requires the active uid and no group/world write bit', () => {
    expect(isOwnedPrivatePosixEntry({ mode: 0o40700, uid: 501 }, 501)).toBe(true)
    expect(isOwnedPrivatePosixEntry({ mode: 0o40750, uid: 501 }, 501)).toBe(true)
    expect(isOwnedPrivatePosixEntry({ mode: 0o40720, uid: 501 }, 501)).toBe(false)
    expect(isOwnedPrivatePosixEntry({ mode: 0o40702, uid: 501 }, 501)).toBe(false)
    expect(isOwnedPrivatePosixEntry({ mode: 0o40700, uid: 502 }, 501)).toBe(false)
    expect(isOwnedPrivatePosixEntry({ mode: 0o44700, uid: 501 }, 501)).toBe(false)
  })
})
