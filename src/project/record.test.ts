import type { ProjectManifest } from '../types'
import { describe, expect, it } from 'vitest'
import { createProjectRecord } from './record'

const manifest: ProjectManifest = {
  schemaVersion: 1,
  projectId: 'demo-project',
  name: 'Demo Project',
  canonicalUrl: 'https://example.com/',
  repositoryUrl: 'https://github.com/example/demo',
  locales: ['en', 'zh-CN'],
  tagline: {
    'en': 'Demo',
    'zh-CN': '演示',
  },
  facts: [],
  captureFlows: [],
}

describe('project record integration mode', () => {
  it('defaults legacy manifests to deterministic source-owned projects', () => {
    expect(createProjectRecord(manifest, 'demo-project-snapshot-1')).toEqual({
      captureMode: 'deterministic',
      currentSnapshotId: 'demo-project-snapshot-1',
      name: 'Demo Project',
      projectId: 'demo-project',
      repeatability: 'high',
      sourceAccess: 'source-owned',
    })
  })

  it('derives assisted low-repeatability records for web-assisted projects', () => {
    expect(createProjectRecord({
      ...manifest,
      sourceAccess: 'web-assisted',
    }, 'demo-project-snapshot-2')).toMatchObject({
      captureMode: 'assisted',
      repeatability: 'low',
      sourceAccess: 'web-assisted',
    })
  })

  it('preserves explicit capture and repeatability declarations', () => {
    expect(createProjectRecord({
      ...manifest,
      captureMode: 'assisted',
      repeatability: 'conditional',
      sourceAccess: 'source-owned',
    }, 'demo-project-snapshot-3')).toMatchObject({
      captureMode: 'assisted',
      repeatability: 'conditional',
      sourceAccess: 'source-owned',
    })
  })
})
