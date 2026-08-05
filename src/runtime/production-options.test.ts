import type { ProjectRecord, ProjectSnapshot } from '../types'
import { describe, expect, it } from 'vitest'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import { OwnerTakeoverRegistry } from '../jobs/owner-takeover'
import { InMemoryExecutionTaskStore } from '../jobs/task'
import { productionForProject } from './production-options'

function registerProject(
  service: ContentStudioApplicationService,
  projectId: string,
  ownerTakeover = false,
): void {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: projectId,
      projectId,
      repositoryUrl: `https://github.com/example/${projectId}`,
      schemaVersion: 1 as const,
      tagline: {
        'en': projectId,
        'zh-CN': projectId,
      },
      ...(ownerTakeover ? { ownerTakeover: true } : {}),
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  const record: ProjectRecord = {
    captureMode: 'deterministic',
    currentSnapshotId: snapshot.snapshotId,
    name: projectId,
    ...(ownerTakeover ? { ownerTakeover: true } : {}),
    projectId,
    repeatability: ownerTakeover ? 'conditional' : 'high',
    sourceAccess: 'source-owned',
  }
  service.registerProject(record, snapshot)
}

describe('production options for owner takeover projects', () => {
  it('injects a confirmation controller and visible browser only for takeover projects', () => {
    const service = new ContentStudioApplicationService(
      new InMemoryContentStudioRepository(),
    )
    registerProject(service, 'takeover-project', true)
    registerProject(service, 'plain-project')
    const ownerTakeovers = new OwnerTakeoverRegistry(
      new InMemoryExecutionTaskStore(),
    )
    const base = {
      record: async () => {
        throw new Error('recorder must not run in this test')
      },
    }

    const takeover = productionForProject(
      base,
      ownerTakeovers,
      service,
      'takeover-project',
    )
    expect(takeover.options?.headless).toBe(false)
    expect(takeover.options?.ownerTakeover).toBeDefined()

    expect(productionForProject(base, ownerTakeovers, service, 'plain-project'))
      .toBe(base)
  })
})
