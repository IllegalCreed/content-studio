// @env node

import type { StorageCleanupPreviewItem } from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listStorageRecycleEntries,
  moveToRecycleBin,
  restoreFromRecycleBin,
} from './recycle'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('storage recycle area', () => {
  it('moves a registered activity artifact into the recycle area and restores it', async () => {
    const root = `/tmp/content-studio-recycle-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
    temporaryDirectories.push(root)
    const outputRoot = join(root, 'production')
    const recycleRoot = join(root, 'recycle')
    const projectId = 'project-a'
    const relativePath = 'activity-a/draft.md'
    const content = Buffer.from('# draft\n')
    await mkdir(join(outputRoot, projectId, 'activity-a'), { recursive: true })
    await writeFile(join(outputRoot, projectId, relativePath), content)
    const item: StorageCleanupPreviewItem = {
      id: 'artifact-a',
      kind: 'article-version',
      name: 'draft.md',
      reason: '待确认',
      retentionClass: 'activity-artifact',
      relativePath,
      scope: 'activity-artifact',
      sha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.byteLength,
      status: 'review',
      version: 1,
    }

    const entry = await moveToRecycleBin({
      item,
      now: new Date('2026-08-04T00:00:00.000Z'),
      outputRoot,
      projectId,
      recycleRoot,
    })

    await expect(stat(join(outputRoot, projectId, relativePath))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(entry).toMatchObject({
      itemId: item.id,
      originalRelativePath: relativePath,
      projectId,
      sha256: item.sha256,
      sizeBytes: content.byteLength,
    })
    expect(await readFile(join(recycleRoot, entry.recycledRelativePath))).toEqual(content)
    await expect(listStorageRecycleEntries(recycleRoot, projectId)).resolves.toEqual([entry])

    await expect(restoreFromRecycleBin({
      outputRoot,
      projectId,
      recycleId: entry.recycleId,
      recycleRoot,
    })).resolves.toEqual(entry)
    await expect(readFile(join(outputRoot, projectId, relativePath))).resolves.toEqual(content)
    await expect(listStorageRecycleEntries(recycleRoot, projectId)).resolves.toEqual([])
  })

  it('does not move an artifact when the registered checksum no longer matches', async () => {
    const root = `/tmp/content-studio-recycle-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
    temporaryDirectories.push(root)
    const outputRoot = join(root, 'production')
    const recycleRoot = join(root, 'recycle')
    const projectId = 'project-a'
    const relativePath = 'activity-a/draft.md'
    await mkdir(join(outputRoot, projectId, 'activity-a'), { recursive: true })
    await writeFile(join(outputRoot, projectId, relativePath), '# changed\n')
    const item: StorageCleanupPreviewItem = {
      id: 'artifact-a',
      kind: 'article-version',
      name: 'draft.md',
      reason: '待确认',
      retentionClass: 'activity-artifact',
      relativePath,
      scope: 'activity-artifact',
      sha256: 'a'.repeat(64),
      status: 'review',
      version: 1,
    }

    await expect(moveToRecycleBin({
      item,
      outputRoot,
      projectId,
      recycleRoot,
    })).rejects.toThrow('no longer matches its checksum')
    await expect(readFile(join(outputRoot, projectId, relativePath))).resolves.toEqual(Buffer.from('# changed\n'))
  })

  it('rejects protected items and unsafe paths before touching files', async () => {
    const root = uniqueRoot()
    temporaryDirectories.push(root)
    const outputRoot = join(root, 'production')
    const recycleRoot = join(root, 'recycle')
    const projectId = 'project-a'
    const relativePath = 'activity-a/draft.md'
    await mkdir(join(outputRoot, projectId, 'activity-a'), { recursive: true })
    await writeFile(join(outputRoot, projectId, relativePath), 'draft')
    const baseItem: StorageCleanupPreviewItem = {
      id: 'artifact-a',
      kind: 'article-version',
      name: 'draft.md',
      reason: '待确认',
      retentionClass: 'activity-artifact',
      relativePath,
      scope: 'activity-artifact',
      sha256: createHash('sha256').update('draft').digest('hex'),
      status: 'protected',
      version: 1,
    }
    await expect(moveToRecycleBin({
      item: baseItem,
      outputRoot,
      projectId,
      recycleRoot,
    })).rejects.toThrow('Only reviewable')
    await expect(moveToRecycleBin({
      item: { ...baseItem, relativePath: '../escape', status: 'review' },
      outputRoot,
      projectId,
      recycleRoot,
    })).rejects.toThrow('outside the managed directory')
    await expect(listStorageRecycleEntries(recycleRoot, '../unsafe')).rejects.toThrow('projectId')
    await expect(readFile(join(outputRoot, projectId, relativePath))).resolves.toEqual(Buffer.from('draft'))
  })

  it('rejects directories and missing recycle entries', async () => {
    const root = uniqueRoot()
    temporaryDirectories.push(root)
    const outputRoot = join(root, 'production')
    const recycleRoot = join(root, 'recycle')
    const projectId = 'project-a'
    const relativePath = 'activity-a/directory'
    await mkdir(join(outputRoot, projectId, relativePath), { recursive: true })
    const item: StorageCleanupPreviewItem = {
      id: 'artifact-a',
      kind: 'article-version',
      name: 'directory',
      reason: '待确认',
      retentionClass: 'activity-artifact',
      relativePath,
      scope: 'activity-artifact',
      sha256: 'a'.repeat(64),
      status: 'review',
      version: 1,
    }
    await expect(moveToRecycleBin({
      item,
      outputRoot,
      projectId,
      recycleRoot,
    })).rejects.toThrow('Expected a file')
    await expect(restoreFromRecycleBin({
      outputRoot,
      projectId,
      recycleId: 'recycle-missing',
      recycleRoot,
    })).rejects.toThrow('was not found')
  })

  it('rejects malformed recycle manifests', async () => {
    const root = uniqueRoot()
    temporaryDirectories.push(root)
    const recycleRoot = join(root, 'recycle')
    const manifestPath = join(recycleRoot, 'project-a', 'manifest.json')
    await mkdir(join(recycleRoot, 'project-a'), { recursive: true })
    await writeFile(manifestPath, JSON.stringify({ invalid: true }))
    await expect(listStorageRecycleEntries(recycleRoot, 'project-a')).rejects.toThrow('invalid')
    await writeFile(manifestPath, JSON.stringify({ entries: [null] }))
    await expect(listStorageRecycleEntries(recycleRoot, 'project-a')).rejects.toThrow('invalid')
  })

  it('protects a restored file from overwrite and detects tampering', async () => {
    const fixture = await createFixture()
    const tamperedPath = join(fixture.recycleRoot, fixture.entry.recycledRelativePath)
    await writeFile(tamperedPath, 'tampered')
    await expect(restoreFromRecycleBin({
      outputRoot: fixture.outputRoot,
      projectId: fixture.projectId,
      recycleId: fixture.entry.recycleId,
      recycleRoot: fixture.recycleRoot,
    })).rejects.toThrow('no longer matches')
    await writeFile(tamperedPath, fixture.content)
    await mkdir(join(fixture.outputRoot, fixture.projectId, 'activity-a'), { recursive: true })
    await writeFile(join(fixture.outputRoot, fixture.projectId, fixture.relativePath), 'new file')
    await expect(restoreFromRecycleBin({
      outputRoot: fixture.outputRoot,
      projectId: fixture.projectId,
      recycleId: fixture.entry.recycleId,
      recycleRoot: fixture.recycleRoot,
    })).rejects.toThrow('existing file')
    temporaryDirectories.push(fixture.root)
  })

  it('does not restore an entry after its recovery window', async () => {
    const fixture = await createFixture()
    const manifestPath = join(fixture.recycleRoot, fixture.projectId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { entries: Array<Record<string, unknown>> }
    manifest.entries[0]!.expiresAt = '2020-01-01T00:00:00.000Z'
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(restoreFromRecycleBin({
      outputRoot: fixture.outputRoot,
      projectId: fixture.projectId,
      recycleId: fixture.entry.recycleId,
      recycleRoot: fixture.recycleRoot,
    })).rejects.toThrow('recovery window')
    temporaryDirectories.push(fixture.root)
  })
})

async function createFixture(): Promise<{
  content: string
  entry: Awaited<ReturnType<typeof moveToRecycleBin>>
  outputRoot: string
  projectId: string
  recycleRoot: string
  relativePath: string
  root: string
}> {
  const root = uniqueRoot()
  const outputRoot = join(root, 'production')
  const recycleRoot = join(root, 'recycle')
  const projectId = 'project-a'
  const relativePath = 'activity-a/draft.md'
  const content = '# draft\n'
  await mkdir(join(outputRoot, projectId, 'activity-a'), { recursive: true })
  await writeFile(join(outputRoot, projectId, relativePath), content)
  const entry = await moveToRecycleBin({
    item: {
      id: 'artifact-a',
      kind: 'article-version',
      name: 'draft.md',
      reason: '待确认',
      retentionClass: 'activity-artifact',
      relativePath,
      scope: 'activity-artifact',
      sha256: createHash('sha256').update(content).digest('hex'),
      status: 'review',
      version: 1,
    },
    outputRoot,
    projectId,
    recycleRoot,
  })
  return { content, entry, outputRoot, projectId, recycleRoot, relativePath, root }
}

function uniqueRoot(): string {
  return `/tmp/content-studio-recycle-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
