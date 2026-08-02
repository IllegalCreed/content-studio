// @env node

import type {
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
} from '../types'
import { describe, expect, it } from 'vitest'
import {
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import {
  createContentStudioServer,
} from './server'

function createProject(projectId = 'project-a'): {
  project: ProjectRecord
  snapshot: ProjectSnapshot
} {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: projectId,
      projectId,
      repositoryUrl: `https://github.com/example/${projectId}`,
      schemaVersion: 1,
      tagline: {
        'en': projectId,
        'zh-CN': projectId,
      },
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  return {
    project: {
      captureMode: 'deterministic',
      currentSnapshotId: snapshot.snapshotId,
      name: projectId,
      projectId,
      repeatability: 'high',
      sourceAccess: 'source-owned',
    },
    snapshot,
  }
}

async function listen(server: ReturnType<typeof createContentStudioServer>['server']): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.once('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('Expected a TCP server address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

describe('content studio local application server', () => {
  it('serves a project-scoped view and creates an activity through the application service', async () => {
    const { project, snapshot } = createProject()
    const binding: ProjectChannelBinding = {
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: project.projectId,
    }
    const handle = createContentStudioServer({
      project,
      projectChannelBindings: [binding],
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const healthResponse = await fetch(`${running.baseUrl}/api/v1/health`)
      expect(healthResponse.status).toBe(200)
      expect(await healthResponse.json()).toEqual({
        contractVersion: 1,
        projectId: 'project-a',
        status: 'ready',
      })

      const optionsResponse = await fetch(
        `${running.baseUrl}/api/v1/health`,
        { method: 'OPTIONS' },
      )
      expect(optionsResponse.status).toBe(204)
      const missingRouteResponse = await fetch(
        `${running.baseUrl}/not-an-api-route`,
      )
      expect(missingRouteResponse.status).toBe(404)
      const missingProjectResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-b`,
      )
      expect(missingProjectResponse.status).toBe(404)

      const beforeResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect(beforeResponse.status).toBe(200)
      expect((await beforeResponse.json()).activities).toEqual([])

      const createResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            campaignId: 'campaign-a',
            channels: [{ id: 'github', locale: 'en' }],
            goal: 'education',
            projectId: 'project-a',
            projectSnapshotId: snapshot.snapshotId,
            status: 'draft',
            targetUrl: 'https://project-a.example.com/guide',
            topic: {
              'en': 'A guide',
              'zh-CN': '一篇指南',
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(createResponse.status).toBe(201)
      expect(await createResponse.json()).toMatchObject({
        activityId: 'activity-a',
        projectId: 'project-a',
        version: 1,
      })

      const conflictResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({
            activityId: 'activity-a',
            campaignId: 'campaign-a',
            channels: [{ id: 'github', locale: 'en' }],
            goal: 'education',
            projectId: 'project-a',
            projectSnapshotId: snapshot.snapshotId,
            status: 'draft',
            targetUrl: 'https://project-a.example.com/guide',
            topic: {
              'en': 'A guide',
              'zh-CN': '一篇指南',
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(conflictResponse.status).toBe(409)

      const afterResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a`,
      )
      expect((await afterResponse.json()).activities).toHaveLength(1)
    }
    finally {
      await running.close()
    }
  })

  it('rejects a body that attempts to carry credentials', async () => {
    const { project, snapshot } = createProject()
    const handle = createContentStudioServer({
      project,
      repository: new InMemoryContentStudioRepository(),
      snapshot,
    })
    const running = await listen(handle.server)

    try {
      const response = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: JSON.stringify({ password: 'never-accept-this' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Sensitive field')

      const malformedResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        {
          body: '{',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      )
      expect(malformedResponse.status).toBe(400)
      expect(await malformedResponse.text()).toContain('valid JSON')

      const emptyResponse = await fetch(
        `${running.baseUrl}/api/v1/projects/project-a/activities`,
        { method: 'POST' },
      )
      expect(emptyResponse.status).toBe(400)
      expect(await emptyResponse.text()).toContain('must be JSON')
    }
    finally {
      await running.close()
    }
  })

  it('does not register the same project twice when a runtime is reopened', async () => {
    const { project, snapshot } = createProject()
    const repository = new InMemoryContentStudioRepository()
    const first = createContentStudioServer({ project, repository, snapshot })
    const second = createContentStudioServer({ project, repository, snapshot })

    await first.close()
    await second.close()
  })
})
