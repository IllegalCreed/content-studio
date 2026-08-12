// @env node

import type { ActivityArtifact, MarketingOpsPublicationPackage } from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, link, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageMarketingOpsAssetBundle } from './assets'

const temporaryRoots: string[] = []

async function temporaryRoot(prefix = 'content-studio-assets-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

function packageValue(hash: string): MarketingOpsPublicationPackage {
  return {
    activityId: 'bilibili-live-quick-sort-20260810',
    artifactRefs: [{
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      mediaKind: 'image',
      sha256: hash,
      version: 2,
    }],
    body: '正文 #算法可视化 https://algo.illegalscreed.cn/docs/quick-sort/',
    campaignId: 'bilibili-mcp-live-20260810',
    channel: 'bilibili',
    contentFormat: 'image-text',
    contentHash: 'b'.repeat(64),
    contentId: 'bilibili-image-text-content',
    contentVersion: 2,
    locale: 'zh-CN',
    packageId: 'bilibili-image-text-publication',
    projectId: 'algorithm-visualizer',
    publicationId: 'bilibili-image-text-publication',
    renderer: {
      canonicalUrl: 'https://algo.illegalscreed.cn/docs/quick-sort/',
      format: 'manual-package',
      links: ['https://algo.illegalscreed.cn/docs/quick-sort/'],
      media: ['image'],
      utmMedium: 'social',
    },
    schemaVersion: 1,
    title: '快速排序',
  }
}

describe('marketing-ops asset bundle bridge', () => {
  it('copies and re-hashes only locked artifacts into a private opaque bundle', async () => {
    const root = await temporaryRoot()
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    const bytes = Buffer.from('locked-image')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const source = join(sourceRoot, 'algorithm-visualizer', 'images', 'cover.png')
    await mkdir(join(sourceRoot, 'algorithm-visualizer', 'images'), { recursive: true, mode: 0o700 })
    await writeFile(source, bytes, { mode: 0o600 })
    const artifact: ActivityArtifact = {
      activityId: 'bilibili-live-quick-sort-20260810',
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      projectId: 'algorithm-visualizer',
      relativePath: 'images/cover.png',
      sha256: hash,
      version: 2,
    }
    const first = await stageMarketingOpsAssetBundle({ bundleRoot, sourceRoot, artifacts: [artifact], package: packageValue(hash) })
    const second = await stageMarketingOpsAssetBundle({ bundleRoot, sourceRoot, artifacts: [artifact], package: packageValue(hash) })
    expect(second.bundleKey).toBe(first.bundleKey)
    expect(first.manifest.artifacts[0]?.relativeFile).toBe('cover-zh-2.png')
    const staged = await readFile(join(bundleRoot, 'bundles', first.bundleKey, 'cover-zh-2.png'))
    expect(staged).toEqual(bytes)
  })

  it('fails closed when a registered artifact is changed or publicly accessible', async () => {
    const root = await temporaryRoot('content-studio-assets-invalid-')
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    const bytes = Buffer.from('changed')
    const source = join(sourceRoot, 'algorithm-visualizer', 'cover.png')
    await mkdir(join(sourceRoot, 'algorithm-visualizer'), { recursive: true, mode: 0o700 })
    await writeFile(source, bytes, { mode: 0o644 })
    const hash = 'a'.repeat(64)
    const artifact: ActivityArtifact = {
      activityId: 'bilibili-live-quick-sort-20260810',
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      projectId: 'algorithm-visualizer',
      relativePath: 'cover.png',
      sha256: hash,
      version: 2,
    }
    await expect(stageMarketingOpsAssetBundle({ bundleRoot, sourceRoot, artifacts: [artifact], package: packageValue(hash) })).rejects.toThrow(/private|checksum/i)
    await chmod(source, 0o600)
  })

  it('rejects relative roots and every mismatched package lock before copying', async () => {
    const root = await temporaryRoot('content-studio-assets-lock-')
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    const bytes = Buffer.from('locked-image')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const source = join(sourceRoot, 'algorithm-visualizer', 'images', 'cover.png')
    await mkdir(join(sourceRoot, 'algorithm-visualizer', 'images'), { recursive: true, mode: 0o700 })
    await writeFile(source, bytes, { mode: 0o600 })
    const artifact: ActivityArtifact = {
      activityId: 'bilibili-live-quick-sort-20260810',
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      projectId: 'algorithm-visualizer',
      relativePath: 'images/cover.png',
      sha256: hash,
      version: 2,
    }
    const valid = packageValue(hash)

    await expect(stageMarketingOpsAssetBundle({
      artifacts: [artifact],
      bundleRoot: 'relative-bundle',
      package: valid,
      sourceRoot,
    })).rejects.toThrow(/root is invalid/i)
    await expect(stageMarketingOpsAssetBundle({
      artifacts: [artifact],
      bundleRoot,
      package: valid,
      sourceRoot: 'relative-source',
    })).rejects.toThrow(/root is invalid/i)

    const cases: Array<[string, readonly ActivityArtifact[], MarketingOpsPublicationPackage]> = [
      ['missing artifact', [], valid],
      ['wrong project', [{ ...artifact, projectId: 'other-project' }], valid],
      ['wrong activity', [{ ...artifact, activityId: 'other-activity' }], valid],
      ['wrong version', [{ ...artifact, version: 3 }], valid],
      ['wrong hash', [{ ...artifact, sha256: 'c'.repeat(64) }], valid],
    ]
    for (const [_name, artifacts, packageInput] of cases) {
      await expect(stageMarketingOpsAssetBundle({
        artifacts,
        bundleRoot,
        package: packageInput,
        sourceRoot,
      })).rejects.toThrow(/not locked/i)
    }
  })

  it('supports both fixed source layouts and locks video, GIF, and implicit image extensions', async () => {
    const root = await temporaryRoot('content-studio-assets-kinds-')
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 })
    const definitions = [
      { artifactId: 'clip', kind: 'video' as const, mediaKind: 'video' as const, relativePath: 'clip.webm' },
      { artifactId: 'preview', kind: 'image' as const, mediaKind: 'gif' as const, relativePath: 'preview.bin' },
      { artifactId: 'cover', kind: 'image' as const, mediaKind: undefined, relativePath: 'cover.bin' },
    ]
    const artifacts: ActivityArtifact[] = []
    const references: MarketingOpsPublicationPackage['artifactRefs'] = []
    for (const [index, definition] of definitions.entries()) {
      const bytes = Buffer.from(`artifact-${index}`)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await writeFile(join(sourceRoot, definition.relativePath), bytes, { mode: 0o600 })
      artifacts.push({
        activityId: 'bilibili-live-quick-sort-20260810',
        artifactId: definition.artifactId,
        kind: definition.kind,
        locale: 'zh-CN',
        projectId: 'algorithm-visualizer',
        relativePath: definition.relativePath,
        sha256,
        version: 2,
      })
      references.push({
        artifactId: definition.artifactId,
        kind: definition.kind,
        locale: 'zh-CN',
        ...(definition.mediaKind === undefined ? {} : { mediaKind: definition.mediaKind }),
        sha256,
        version: 2,
      })
    }
    const result = await stageMarketingOpsAssetBundle({
      artifacts: [...artifacts, { ...artifacts[0]!, version: 1 }],
      bundleRoot,
      package: { ...packageValue(references[0]!.sha256), artifactRefs: references },
      sourceRoot,
    })

    expect(result.manifest.artifacts.map(artifact => artifact.relativeFile)).toEqual([
      'clip-2.mp4',
      'preview-2.gif',
      'cover-2.png',
    ])
    expect(result.manifest.artifacts[2]).not.toHaveProperty('mediaKind')
  })

  it('rejects unavailable, changed, oversized, multiply linked, and escaping artifacts', async () => {
    const root = await temporaryRoot('content-studio-assets-files-')
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    await mkdir(join(sourceRoot, 'algorithm-visualizer'), { recursive: true, mode: 0o700 })
    const bytes = Buffer.from('locked')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const baseArtifact: ActivityArtifact = {
      activityId: 'bilibili-live-quick-sort-20260810',
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      projectId: 'algorithm-visualizer',
      relativePath: 'cover.png',
      sha256: hash,
      version: 2,
    }
    const valid = packageValue(hash)

    await expect(stageMarketingOpsAssetBundle({ artifacts: [baseArtifact], bundleRoot, package: valid, sourceRoot }))
      .rejects
      .toThrow(/unavailable/i)

    const source = join(sourceRoot, 'algorithm-visualizer', 'cover.png')
    await writeFile(source, Buffer.from('changed'), { mode: 0o600 })
    await expect(stageMarketingOpsAssetBundle({ artifacts: [baseArtifact], bundleRoot, package: valid, sourceRoot }))
      .rejects
      .toThrow(/checksum/i)

    await writeFile(source, bytes, { mode: 0o600 })
    await link(source, join(sourceRoot, 'hard-link.png'))
    await expect(stageMarketingOpsAssetBundle({ artifacts: [baseArtifact], bundleRoot, package: valid, sourceRoot }))
      .rejects
      .toThrow(/private regular file/i)
    await rm(join(sourceRoot, 'hard-link.png'))

    await truncate(source, 512 * 1024 * 1024 + 1)
    await expect(stageMarketingOpsAssetBundle({ artifacts: [baseArtifact], bundleRoot, package: valid, sourceRoot }))
      .rejects
      .toThrow(/private regular file/i)

    const escaping = {
      ...baseArtifact,
      artifactId: '../escape',
      relativePath: '../outside.png',
    }
    await expect(stageMarketingOpsAssetBundle({
      artifacts: [escaping],
      bundleRoot,
      package: {
        ...valid,
        artifactRefs: [{ ...valid.artifactRefs[0]!, artifactId: '../escape' }],
      },
      sourceRoot,
    })).rejects.toThrow(/unavailable|destination/i)
  })

  it('fails closed when an existing private bundle file is corrupted or conflicts', async () => {
    const root = await temporaryRoot('content-studio-assets-existing-')
    const sourceRoot = join(root, 'production')
    const bundleRoot = join(root, 'runtime', 'asset-bundles')
    const bytes = Buffer.from('locked-image')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const source = join(sourceRoot, 'algorithm-visualizer', 'cover.png')
    await mkdir(join(sourceRoot, 'algorithm-visualizer'), { recursive: true, mode: 0o700 })
    await writeFile(source, bytes, { mode: 0o600 })
    const artifact: ActivityArtifact = {
      activityId: 'bilibili-live-quick-sort-20260810',
      artifactId: 'cover-zh',
      kind: 'image',
      locale: 'zh-CN',
      projectId: 'algorithm-visualizer',
      relativePath: 'cover.png',
      sha256: hash,
      version: 2,
    }
    const input = { artifacts: [artifact], bundleRoot, package: packageValue(hash), sourceRoot }
    const staged = await stageMarketingOpsAssetBundle(input)
    const destination = join(bundleRoot, 'bundles', staged.bundleKey, 'cover-zh-2.png')

    await chmod(destination, 0o644)
    await expect(stageMarketingOpsAssetBundle(input)).rejects.toThrow(/corrupted/i)
    await chmod(destination, 0o600)
    await writeFile(destination, 'different', { mode: 0o600 })
    await expect(stageMarketingOpsAssetBundle(input)).rejects.toThrow(/conflicts/i)
  })
})
