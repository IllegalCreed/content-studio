import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'

const temporaryDirectories: string[] = []
const serverContents = 'managed marketing-ops server fixture\n'
const helperContents = 'managed marketing-ops keychain helper fixture\n'

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

async function createRuntimeAsset(
  manifestOverrides: Record<string, unknown> = {},
): Promise<{ manifestSha256: string, root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'content-studio-managed-runtime-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'dist/server.js'), serverContents, 'utf8')
  await writeFile(join(root, 'dist/keychain-helper'), helperContents, 'utf8')
  const packageJson = JSON.stringify({
    name: '@illegalcreed/marketing-ops',
    version: '0.1.0',
  })
  await writeFile(join(root, 'package.json'), packageJson, 'utf8')
  const manifest = JSON.stringify({
    contractVersion: 3,
    files: [
      { path: 'dist/keychain-helper', sha256: sha256(helperContents) },
      { path: 'dist/server.js', sha256: sha256(serverContents) },
      { path: 'package.json', sha256: sha256(packageJson) },
    ],
    runtimeName: 'marketing-ops',
    runtimeVersion: '0.1.0',
    schemaVersion: 1,
    ...manifestOverrides,
  })
  await writeFile(
    join(root, 'runtime-manifest.json'),
    manifest,
    'utf8',
  )
  return { manifestSha256: sha256(manifest), root }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('installer-owned marketing-ops runtime asset', () => {
  it('accepts only the fixed compatible runtime layout after verifying every runtime file', async () => {
    const asset = await createRuntimeAsset()
    const safeRoot = await realpath(asset.root)

    await expect(resolveManagedMarketingOpsRuntimeAsset(asset.root, asset.manifestSha256)).resolves.toEqual({
      entrypoint: join(safeRoot, 'dist/server.js'),
      runtimeRoot: safeRoot,
      runtimeVersion: '0.1.0',
    })
  })

  it('fails closed when a declared runtime file no longer matches its integrity digest', async () => {
    const asset = await createRuntimeAsset()
    await writeFile(join(asset.root, 'dist/server.js'), 'tampered server fixture\n', 'utf8')

    await expect(resolveManagedMarketingOpsRuntimeAsset(asset.root, asset.manifestSha256)).resolves.toBeNull()
  })

  it('fails closed when the installer-owned manifest digest does not match', async () => {
    const asset = await createRuntimeAsset()

    await expect(resolveManagedMarketingOpsRuntimeAsset(asset.root, '0'.repeat(64))).resolves.toBeNull()
  })

  it('rejects incompatible metadata and paths that do not match the fixed runtime layout', async () => {
    const unsupportedVersion = await createRuntimeAsset({ runtimeVersion: '1.0.0' })
    const unsupportedContract = await createRuntimeAsset({ contractVersion: 4 })
    const escapedFile = await createRuntimeAsset({
      files: [{ path: '../server.js', sha256: sha256(serverContents) }],
    })

    await expect(resolveManagedMarketingOpsRuntimeAsset(
      unsupportedVersion.root,
      unsupportedVersion.manifestSha256,
    )).resolves.toBeNull()
    await expect(resolveManagedMarketingOpsRuntimeAsset(
      unsupportedContract.root,
      unsupportedContract.manifestSha256,
    )).resolves.toBeNull()
    await expect(resolveManagedMarketingOpsRuntimeAsset(
      escapedFile.root,
      escapedFile.manifestSha256,
    )).resolves.toBeNull()
  })

  it('rejects manifest expansion and symlinked runtime files', async () => {
    const expandedManifest = await createRuntimeAsset({ command: 'untrusted-command' })
    const symlinkedFile = await createRuntimeAsset()
    const outsideFile = join(symlinkedFile.root, 'outside-server.js')
    await writeFile(outsideFile, serverContents, 'utf8')
    await rm(join(symlinkedFile.root, 'dist/server.js'))
    await symlink(outsideFile, join(symlinkedFile.root, 'dist/server.js'))

    await expect(resolveManagedMarketingOpsRuntimeAsset(
      expandedManifest.root,
      expandedManifest.manifestSha256,
    )).resolves.toBeNull()
    await expect(resolveManagedMarketingOpsRuntimeAsset(
      symlinkedFile.root,
      symlinkedFile.manifestSha256,
    )).resolves.toBeNull()
  })
})
