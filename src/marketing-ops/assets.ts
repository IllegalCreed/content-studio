// @env node

import type { ActivityArtifact, MarketingOpsPublicationPackage } from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import process from 'node:process'

const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024
const MAX_MANIFEST_BYTES = 128 * 1024

export interface MarketingOpsAssetBundleManifest {
  artifacts: Array<{
    artifactId: string
    mediaKind?: 'image' | 'gif' | 'video'
    relativeFile: string
    sha256: string
    version: number
  }>
  campaignId: string
  contentHash: string
  packageId: string
  projectId: string
  schemaVersion: 1
}

export interface StageMarketingOpsAssetBundleInput {
  bundleRoot: string
  sourceRoot: string
  artifacts: readonly ActivityArtifact[]
  package: MarketingOpsPublicationPackage
}

export interface StageMarketingOpsAssetBundleResult {
  bundleKey: string
  manifest: MarketingOpsAssetBundleManifest
}

/**
 * Copies only the already-registered, hash-locked activity artifacts into the
 * installer-owned runtime directory. The returned MCP package remains
 * path-free; the child runtime resolves this opaque bundle key internally.
 */
export async function stageMarketingOpsAssetBundle(
  input: StageMarketingOpsAssetBundleInput,
): Promise<StageMarketingOpsAssetBundleResult> {
  const root = resolve(input.bundleRoot)
  const sourceRoot = resolve(input.sourceRoot)
  if (root !== input.bundleRoot || sourceRoot !== input.sourceRoot || root.includes('\u0000') || sourceRoot.includes('\u0000'))
    throw new Error('Marketing-ops asset root is invalid')
  const bundleKey = marketingOpsAssetBundleKey(
    input.package.projectId,
    input.package.campaignId,
    input.package.packageId,
    input.package.contentHash,
  )
  const bundleRoot = resolve(root, 'bundles', bundleKey)
  const manifestPath = resolve(root, 'bundles', `${bundleKey}.json`)
  if (!isInside(root, bundleRoot) || !isInside(root, manifestPath))
    throw new Error('Marketing-ops asset root is invalid')
  await mkdir(bundleRoot, { recursive: true, mode: 0o700 })
  await chmod(bundleRoot, 0o700)
  await mkdir(join(root, 'bundles'), { recursive: true, mode: 0o700 })
  await chmod(join(root, 'bundles'), 0o700)

  const latest = latestArtifacts(input.artifacts)
  const manifestArtifacts: MarketingOpsAssetBundleManifest['artifacts'] = []
  for (const reference of input.package.artifactRefs) {
    const artifact = latest.get(reference.artifactId)
    if (
      artifact === undefined
      || artifact.projectId !== input.package.projectId
      || artifact.activityId !== input.package.activityId
      || artifact.version !== reference.version
      || artifact.sha256 !== reference.sha256
    ) {
      throw new Error('Marketing-ops artifact is not locked to the package')
    }
    const source = await resolveRegisteredArtifactPath(sourceRoot, artifact)
    const metadata = await lstat(source)
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.nlink !== 1
      || (metadata.mode & 0o077) !== 0
      || metadata.size > MAX_ARTIFACT_BYTES
    ) {
      throw new Error('Marketing-ops artifact is not a private regular file')
    }
    const contents = await readFile(source)
    const digest = createHash('sha256').update(contents).digest('hex')
    if (digest !== reference.sha256)
      throw new Error('Marketing-ops artifact checksum does not match the package')
    const mediaKind = reference.mediaKind
    const relativeFile = `${reference.artifactId}-${reference.version}${extensionFor(reference, artifact)}`
    const destination = resolve(bundleRoot, relativeFile)
    if (!isInside(bundleRoot, destination))
      throw new Error('Marketing-ops artifact destination is invalid')
    await writePrivateIfAbsent(destination, contents)
    manifestArtifacts.push({
      artifactId: reference.artifactId,
      ...(mediaKind === undefined ? {} : { mediaKind }),
      relativeFile,
      sha256: reference.sha256,
      version: reference.version,
    })
  }
  const manifest: MarketingOpsAssetBundleManifest = {
    artifacts: manifestArtifacts,
    campaignId: input.package.campaignId,
    contentHash: input.package.contentHash,
    packageId: input.package.packageId,
    projectId: input.package.projectId,
    schemaVersion: 1,
  }
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
  if (bytes.byteLength > MAX_MANIFEST_BYTES)
    throw new Error('Marketing-ops asset manifest is too large')
  await writePrivateIfAbsent(manifestPath, bytes)
  return { bundleKey, manifest }
}

export function marketingOpsAssetBundleKey(
  projectId: string,
  campaignId: string,
  packageId: string,
  contentHash: string,
): string {
  return createHash('sha256')
    .update(`${projectId}\u0000${campaignId}\u0000${packageId}\u0000${contentHash}`)
    .digest('hex')
}

function latestArtifacts(artifacts: readonly ActivityArtifact[]): Map<string, ActivityArtifact> {
  const latest = new Map<string, ActivityArtifact>()
  for (const artifact of artifacts) {
    const current = latest.get(artifact.artifactId)
    if (current === undefined || current.version < artifact.version)
      latest.set(artifact.artifactId, artifact)
  }
  return latest
}

async function resolveRegisteredArtifactPath(
  artifactRoot: string,
  artifact: ActivityArtifact,
): Promise<string> {
  const candidates = [
    resolve(artifactRoot, artifact.projectId, artifact.relativePath),
    resolve(artifactRoot, artifact.relativePath),
  ]
  for (const candidate of candidates) {
    if (!isInside(artifactRoot, candidate))
      continue
    try {
      const metadata = await lstat(candidate)
      if (metadata.isFile() && !metadata.isSymbolicLink())
        return candidate
    }
    catch {
      // Try the other fixed layout, then fail closed.
    }
  }
  throw new Error('Registered Marketing-ops artifact file is unavailable')
}

function extensionFor(
  reference: MarketingOpsPublicationPackage['artifactRefs'][number],
  artifact: ActivityArtifact,
): string {
  if (reference.mediaKind === 'video' || artifact.kind === 'video')
    return '.mp4'
  if (reference.mediaKind === 'gif' || extname(artifact.relativePath).toLowerCase() === '.gif')
    return '.gif'
  return '.png'
}

async function writePrivateIfAbsent(path: string, contents: Uint8Array): Promise<void> {
  const existing = await lstat(path).catch(() => null)
  if (existing !== null) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1 || (existing.mode & 0o077) !== 0)
      throw new Error('Marketing-ops asset bundle is corrupted')
    const current = await readFile(path)
    if (!current.equals(Buffer.from(contents)))
      throw new Error('Marketing-ops asset bundle conflicts with the locked package')
    return
  }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' })
  try {
    await rename(temporary, path)
    await chmod(path, 0o600)
  }
  finally {
    await unlink(temporary).catch(() => undefined)
  }
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate))
  return value !== '' && !value.startsWith('..') && !value.startsWith('/')
}
