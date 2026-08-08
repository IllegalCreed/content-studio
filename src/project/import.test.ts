import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateProjectManifest } from '../validation'
import {
  draftSourceOwnedProject,
  draftWebAssistedProject,
  extractCaptureFlowsFromMarkdown,
  extractCaptureFlowsFromSourceFiles,
  extractCaptureTargets,
  inspectSourceDirectory,
  scanSourceTestIds,
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

  it('drafts capture flows from internal markdown links and targets from data-testid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await writeFile(
        join(directory, 'README.md'),
        '# Demo\n- [快速排序演示](/docs/quick-sort)\n- [分区过程](/docs/partition)\n',
        'utf8',
      )
      await mkdir(join(directory, 'src'), { recursive: true })
      await writeFile(
        join(directory, 'src', 'Player.vue'),
        '<button data-testid="animation-play">Play</button>\n<div data-testid="result-panel" />\n',
        'utf8',
      )
      const manifest = await draftSourceOwnedProject({
        canonicalUrl: 'https://demo.example.com/',
        repositoryUrl: 'https://example.invalid/',
        sourceDirectory: directory,
      })
      expect(validateProjectManifest(manifest)).toEqual(manifest)
      expect(manifest.captureFlows).toEqual([
        {
          id: 'docs-quick-sort',
          startPath: '/docs/quick-sort',
          steps: [{
            kind: 'capture',
            label: 'capture-start',
          }],
          title: {
            'en': '快速排序演示',
            'zh-CN': '快速排序演示',
          },
        },
        {
          id: 'docs-partition',
          startPath: '/docs/partition',
          steps: [{
            kind: 'capture',
            label: 'capture-start',
          }],
          title: {
            'en': '分区过程',
            'zh-CN': '分区过程',
          },
        },
      ])
      expect(manifest.captureTargets).toEqual([
        {
          id: 'animation-play',
          label: {
            'en': 'Animation play',
            'zh-CN': 'Animation play',
          },
          locator: {
            by: 'test-id',
            value: 'animation-play',
          },
          purpose: 'control',
        },
        {
          id: 'result-panel',
          label: {
            'en': 'Result panel',
            'zh-CN': 'Result panel',
          },
          locator: {
            by: 'test-id',
            value: 'result-panel',
          },
          purpose: 'control',
        },
      ])
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('skips invalid test-id names and keeps the README tagline when name is overridden', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await writeFile(
        join(directory, 'README.md'),
        '# Demo Project\n真实的产品定位描述。\n',
        'utf8',
      )
      await mkdir(join(directory, 'src'), { recursive: true })
      await writeFile(
        join(directory, 'src', 'App.vue'),
        '<div data-testid="PlayButton" />\n',
        'utf8',
      )
      const manifest = await draftSourceOwnedProject({
        canonicalUrl: 'https://demo.example.com/',
        name: 'Renamed Project',
        repositoryUrl: 'https://example.invalid/',
        sourceDirectory: directory,
      })
      expect(validateProjectManifest(manifest)).toEqual(manifest)
      expect(manifest.name).toBe('Renamed Project')
      expect(manifest.projectId).toBe('renamed-project')
      expect(manifest.tagline).toEqual({
        'en': '真实的产品定位描述。',
        'zh-CN': '真实的产品定位描述。',
      })
      expect(manifest.captureTargets).toBeUndefined()
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('bounds, dedupes and skips relative capture flow links', () => {
    const flows = extractCaptureFlowsFromMarkdown(
      Array.from({ length: 10 }, (_, index) => `[t${index}](/docs/p${index})`)
        .join('\n'),
      8,
    )
    expect(flows).toHaveLength(8)
    expect(extractCaptureFlowsFromMarkdown(
      '[first](/docs/x)\n[second](/docs/x)\n[relative](docs/x)\n[](/docs/empty)',
    )).toEqual([
      {
        id: 'docs-x',
        startPath: '/docs/x',
        steps: [{
          kind: 'capture',
          label: 'capture-start',
        }],
        title: {
          'en': 'first',
          'zh-CN': 'first',
        },
      },
    ])
  })

  it('dedupes and bounds capture targets', () => {
    const ids = [
      'target-0',
      'target-0',
      ...Array.from({ length: 13 }, (_, index) => `target-${index + 1}`),
    ]
    const targets = extractCaptureTargets(ids, 12)
    expect(targets).toHaveLength(12)
    expect(targets[0]?.id).toBe('target-0')
  })

  it('scans only source files and ignores dependency directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await mkdir(join(directory, 'src'), { recursive: true })
      await mkdir(join(directory, 'node_modules', 'pkg'), { recursive: true })
      await mkdir(join(directory, 'dist'), { recursive: true })
      await writeFile(
        join(directory, 'src', 'App.vue'),
        '<div data-testid="keep-target" />\n',
        'utf8',
      )
      await writeFile(
        join(directory, 'src', 'style.css'),
        '/* data-testid="skip-css" */\n',
        'utf8',
      )
      await writeFile(
        join(directory, 'node_modules', 'pkg', 'index.js'),
        'const x = "data-testid=skip-dep";\n',
        'utf8',
      )
      await writeFile(
        join(directory, 'dist', 'bundle.js'),
        'const y = "data-testid=skip-dist";\n',
        'utf8',
      )
      await expect(scanSourceTestIds(directory)).resolves.toEqual(['keep-target'])
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails when the source directory does not exist', async () => {
    const missing = join(tmpdir(), `content-studio-missing-${Date.now()}`)
    await expect(scanSourceTestIds(missing)).rejects.toThrow(/source directory/i)
    await expect(draftSourceOwnedProject({
      canonicalUrl: 'https://demo.example.com/',
      repositoryUrl: 'https://example.invalid/',
      sourceDirectory: missing,
    })).rejects.toThrow(/source directory/i)
  })

  it('extracts capture flows from route definitions and prefers shallow paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-import-'))
    try {
      await mkdir(join(directory, 'src', 'router'), { recursive: true })
      await writeFile(
        join(directory, 'src', 'router', 'index.ts'),
        [
          `const routes = [`,
          `  { path: '/', component: Home },`,
          `  { path: '/en' },`,
          `  { path: '/docs/quick-sort', name: 'quick-sort' },`,
          `  { path: '/en/docs/quick-sort' },`,
          `  { path: '/docs/:id', component: Detail },`,
          `  { path: \`/docs/\${definition.key}\` },`,
          `  { path: '/playground', component: Playground },`,
          `]`,
        ].join('\n'),
        'utf8',
      )
      const manifest = await draftSourceOwnedProject({
        canonicalUrl: 'https://demo.example.com/',
        repositoryUrl: 'https://example.invalid/',
        sourceDirectory: directory,
      })
      expect(validateProjectManifest(manifest)).toEqual(manifest)
      expect(manifest.captureFlows.map(flow => flow.startPath)).toEqual([
        '/playground',
        '/docs/quick-sort',
        '/en/docs/quick-sort',
      ])
      expect(manifest.captureFlows[1]?.title).toEqual({
        'en': 'Quick sort',
        'zh-CN': 'Quick sort',
      })
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('bounds route-derived capture flows', () => {
    const files = [Array.from(
      { length: 10 },
      (_, index) => `{ path: '/docs/page-${index}' }`,
    ).join('\n')]
    const flows = extractCaptureFlowsFromSourceFiles(files)
    expect(flows).toHaveLength(8)
  })
})
