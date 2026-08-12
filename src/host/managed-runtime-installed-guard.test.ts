// @env node

import { createHash } from 'node:crypto'
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
const LICENSE = 'installed playwright license fixture\n'
const NOTICE = 'installed playwright notice fixture\n'
const THIRD_PARTY_NOTICES = 'installed playwright third-party notices fixture\n'
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
  await mkdir(join(root, 'LICENSES', 'playwright-core'), { recursive: true, mode: 0o700 })
  await writeFile(join(root, 'browsers.json'), BROWSERS, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/LICENSE'), LICENSE, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/NOTICE'), NOTICE, { mode: 0o600 })
  await writeFile(join(root, 'LICENSES/playwright-core/ThirdPartyNotices.txt'), THIRD_PARTY_NOTICES, { mode: 0o600 })
  await writeFile(join(root, 'dist/server.js'), SERVER, { mode: 0o600 })
  await writeFile(join(root, 'dist/keychain-helper'), HELPER, { mode: 0o700 })
  await writeFile(join(root, 'dist/playwright-core.bundle.cjs'), BUNDLE, { mode: 0o600 })
  await writeFile(join(root, 'package.json'), PACKAGE_JSON, { mode: 0o600 })
  const manifest = JSON.stringify({
    contractVersion: 3,
    files: [
      { path: 'browsers.json', sha256: sha256(BROWSERS) },
      { path: 'LICENSES/playwright-core/LICENSE', sha256: sha256(LICENSE) },
      { path: 'LICENSES/playwright-core/NOTICE', sha256: sha256(NOTICE) },
      { path: 'LICENSES/playwright-core/ThirdPartyNotices.txt', sha256: sha256(THIRD_PARTY_NOTICES) },
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
  await chmod(join(root, 'LICENSES'), 0o700)
  await chmod(join(root, 'LICENSES', 'playwright-core'), 0o700)
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

    const licenseRoot = await createInstalledRuntime()
    await chmod(join(licenseRoot, 'LICENSES', 'playwright-core'), 0o750)
    await expect(verifyInstalledManagedMarketingOpsRuntime(licenseRoot)).resolves.toBe(false)

    const licenseFileRoot = await createInstalledRuntime()
    await chmod(join(licenseFileRoot, 'LICENSES/playwright-core/NOTICE'), 0o640)
    await expect(verifyInstalledManagedMarketingOpsRuntime(licenseFileRoot)).resolves.toBe(false)
  })

  it('rejects browser runtime sidecars that are no longer private files', async () => {
    for (const relativePath of ['browsers.json', 'dist/playwright-core.bundle.cjs']) {
      const root = await createInstalledRuntime()
      await chmod(join(root, relativePath), 0o640)

      await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)
    }
  })

  it('rejects hard-linked browser runtime sidecars', async () => {
    for (const relativePath of ['browsers.json', 'dist/playwright-core.bundle.cjs']) {
      const root = await createInstalledRuntime()
      const source = join(root, relativePath)
      const outside = join(root, '..', `${relativePath.replaceAll('/', '-')}.outside`)
      await writeFile(outside, await readFile(source), {
        mode: 0o600,
      })
      await rm(source)
      await linkIfSupported(outside, source)
      if ((await lstat(outside)).nlink > 1)
        await expect(verifyInstalledManagedMarketingOpsRuntime(root)).resolves.toBe(false)
    }
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

  it('requires the exact private Playwright license tree', async () => {
    const missingFileRoot = await createInstalledRuntime()
    await rm(join(missingFileRoot, 'LICENSES/playwright-core/NOTICE'))
    await expect(verifyInstalledManagedMarketingOpsRuntime(missingFileRoot)).resolves.toBe(false)

    const extraFileRoot = await createInstalledRuntime()
    await writeFile(join(extraFileRoot, 'LICENSES/playwright-core/extra'), 'extra\n', { mode: 0o600 })
    await expect(verifyInstalledManagedMarketingOpsRuntime(extraFileRoot)).resolves.toBe(false)

    const wrongTypeRoot = await createInstalledRuntime()
    await rm(join(wrongTypeRoot, 'LICENSES/playwright-core/NOTICE'))
    await mkdir(join(wrongTypeRoot, 'LICENSES/playwright-core/NOTICE'), { mode: 0o700 })
    await expect(verifyInstalledManagedMarketingOpsRuntime(wrongTypeRoot)).resolves.toBe(false)
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
