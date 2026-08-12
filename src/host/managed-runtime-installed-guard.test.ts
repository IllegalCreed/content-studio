// @env node

import { createHash } from 'node:crypto'
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyInstalledManagedMarketingOpsRuntime } from './managed-runtime-installed-guard'

const temporaryDirectories: string[] = []

const SERVER = 'installed marketing-ops server fixture\n'
const HELPER = 'installed marketing-ops keychain helper fixture\n'
const BROWSERS = '{"browsers":[]}\n'
const BUNDLE = 'installed marketing-ops playwright bundle fixture\n'
const PACKAGE_JSON = JSON.stringify({
  name: '@illegalcreed/marketing-ops',
  private: true,
  type: 'module',
  version: '0.1.0',
})

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function createInstalledRuntime(includeAssetBundles = false): Promise<string> {
  const parent = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'content-studio-installed-guard-')))
  temporaryDirectories.push(parent)
  const root = join(parent, 'runtimes', 'marketing-ops', '0.1.0')
  await mkdir(join(root, 'dist'), { recursive: true, mode: 0o700 })
  await writeFile(join(root, 'browsers.json'), BROWSERS, { mode: 0o600 })
  await writeFile(join(root, 'dist/server.js'), SERVER, { mode: 0o600 })
  await writeFile(join(root, 'dist/keychain-helper'), HELPER, { mode: 0o700 })
  await writeFile(join(root, 'dist/playwright-core.bundle.cjs'), BUNDLE, { mode: 0o600 })
  await writeFile(join(root, 'package.json'), PACKAGE_JSON, { mode: 0o600 })
  const manifest = JSON.stringify({
    contractVersion: 3,
    files: [
      { path: 'browsers.json', sha256: sha256(BROWSERS) },
      { path: 'dist/keychain-helper', sha256: sha256(HELPER) },
      { path: 'dist/playwright-core.bundle.cjs', sha256: sha256(BUNDLE) },
      { path: 'dist/server.js', sha256: sha256(SERVER) },
      { path: 'package.json', sha256: sha256(PACKAGE_JSON) },
    ],
    runtimeName: 'marketing-ops',
    runtimeVersion: '0.1.0',
    schemaVersion: 1,
  })
  await writeFile(join(root, 'runtime-manifest.json'), manifest, { mode: 0o600 })
  // mkdtemp and recursive mkdir do not guarantee the installed private modes.
  await chmod(parent, 0o700)
  await chmod(join(parent, 'runtimes'), 0o700)
  await chmod(join(parent, 'runtimes', 'marketing-ops'), 0o700)
  await chmod(root, 0o700)
  await chmod(join(root, 'dist'), 0o700)
  if (includeAssetBundles) {
    await mkdir(join(root, 'asset-bundles'), { mode: 0o700 })
    await chmod(join(root, 'asset-bundles'), 0o700)
  }
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe.runIf(process.platform !== 'win32')('installed marketing-ops runtime guard', () => {
  it('accepts a complete private installed runtime', async () => {
    const root = await createInstalledRuntime(true)

    await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(true)
  })

  it('rejects a changed directory or file mode', async () => {
    const root = await createInstalledRuntime()
    await chmod(join(root, 'dist'), 0o750)
    await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)

    await chmod(join(root, 'dist'), 0o700)
    await chmod(join(root, 'dist/server.js'), 0o640)
    await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)
  })

  it('rejects symlinks, extra entries, and hard-linked fixed files', async () => {
    const symlinkRoot = await createInstalledRuntime()
    const outside = join(symlinkRoot, '..', 'outside-server.js')
    await writeFile(outside, SERVER, { mode: 0o600 })
    await rm(join(symlinkRoot, 'dist/server.js'))
    await symlink(outside, join(symlinkRoot, 'dist/server.js'))
    await expect(verifyInstalledManagedMarketingOpsRuntime(symlinkRoot)).resolves.toBe(false)

    const extraRoot = await createInstalledRuntime()
    await writeFile(join(extraRoot, 'unexpected'), 'extra\n', { mode: 0o600 })
    await expect(verifyInstalledManagedMarketingOpsRuntime(extraRoot)).resolves.toBe(false)

    const hardlinkRoot = await createInstalledRuntime()
    const outsideHardlink = join(hardlinkRoot, '..', 'outside-hardlink.js')
    await writeFile(outsideHardlink, SERVER, { mode: 0o600 })
    await rm(join(hardlinkRoot, 'dist/server.js'))
    await linkIfSupported(outsideHardlink, join(hardlinkRoot, 'dist/server.js'))
    if ((await lstat(outsideHardlink)).nlink > 1)
      await expect(verifyInstalledManagedMarketingOpsRuntime(hardlinkRoot)).resolves.toBe(false)
  })

  it('rejects an unsafe owner or parent directory', async () => {
    const root = await createInstalledRuntime()
    const uid = (await lstat(root)).uid
    await chmod(root, 0o777)
    await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)

    await chmod(root, 0o700)
    if (await tryChangeOwner(root, uid + 1))
      await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)

    await chmod(join(root, '..', '..'), 0o750)
    await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)

    // Keep the fixture cleanup and the owner assertion deterministic on hosts
    // where changing ownership is unavailable to the test user.
    expect(uid).toEqual(expect.any(Number))
  })
})

describe('installed marketing-ops runtime guard portability', () => {
  it('fails closed for a non-canonical or missing path', async () => {
    await expect(verifyInstalledManagedMarketingOpsRuntime('relative/runtime')).resolves.toBe(false)
    await expect(verifyInstalledManagedMarketingOpsRuntime('/missing/runtime')).resolves.toBe(false)
  })
})

async function linkIfSupported(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination)
  }
  catch {
    // Some filesystems do not permit hard links; the rest of this test still
    // covers the symlink and exact-entry checks.
  }
}

async function tryChangeOwner(path: string, uid: number): Promise<boolean> {
  try {
    const metadata = await lstat(path)
    await chown(path, uid, metadata.gid)
    return true
  }
  catch {
    return false
  }
}
