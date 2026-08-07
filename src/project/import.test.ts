import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateProjectManifest } from '../validation'
import {
  draftSourceOwnedProject,
  draftWebAssistedProject,
  inspectSourceDirectory,
} from './import'

describe('project import drafts', () => {
  it('drafts a valid web-assisted project manifest', () => {
    const manifest = draftWebAssistedProject({
      canonicalUrl: 'https://example.org/',
      name: 'Example Landing',
    })
    expect(validateProjectManifest(manifest)).toEqual(manifest)
    expect(manifest.sourceAccess).toBe('web-assisted')
    expect(manifest.captureMode).toBe('assisted')
    expect(manifest.repeatability).toBe('low')
    expect(manifest.facts).toEqual([])
    expect(manifest.captureFlows).toEqual([])
  })

  it('derives projectId and fills localized tagline for every supported locale', () => {
    const manifest = draftWebAssistedProject({
      canonicalUrl: 'https://example.org/',
      locales: ['en'],
      name: 'My Product',
      projectId: 'my-product',
      tagline: 'Short tagline',
    })
    expect(validateProjectManifest(manifest)).toEqual(manifest)
    expect(manifest.projectId).toBe('my-product')
    expect(manifest.tagline).toEqual({
      'en': 'Short tagline',
      'zh-CN': 'Short tagline',
    })
  })

  it('inspects a source directory and prefers package.json metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({
          name: 'quick-sort-demo',
          description: 'Interactive quick sort visualization',
          homepage: 'https://algo.example.com/',
          repository: 'https://github.com/acme/quick-sort-demo.git',
        }),
        'utf8',
      )
      await writeFile(join(directory, 'README.md'), '# Fallback README', 'utf8')
      const inspection = await inspectSourceDirectory(directory)
      expect(inspection).toEqual({
        canonicalUrl: 'https://algo.example.com/',
        name: 'quick-sort-demo',
        projectId: 'quick-sort-demo',
        repositoryUrl: 'https://github.com/acme/quick-sort-demo.git',
        tagline: 'Interactive quick sort visualization',
      })
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('drafts a valid source-owned manifest from a directory without metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      const manifest = await draftSourceOwnedProject({
        canonicalUrl: 'https://demo.example.com/',
        repositoryUrl: 'https://github.com/acme/demo.git',
        sourceDirectory: directory,
      })
      expect(validateProjectManifest(manifest)).toEqual(manifest)
      expect(manifest.sourceAccess).toBe('source-owned')
      expect(manifest.captureMode).toBe('deterministic')
      expect(manifest.name).not.toBe('')
      expect(manifest.canonicalUrl).toBe('https://demo.example.com/')
      expect(manifest.repositoryUrl).toBe('https://github.com/acme/demo.git')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('normalizes names into valid kebab-case project ids', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await writeFile(join(directory, 'README.md'), 'My Demo Project', 'utf8')
      const manifest = await draftSourceOwnedProject({
        canonicalUrl: 'https://demo.example.com/',
        repositoryUrl: 'https://example.invalid/',
        sourceDirectory: directory,
      })
      expect(validateProjectManifest(manifest)).toEqual(manifest)
      expect(manifest.projectId).toBe('my-demo-project')
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
