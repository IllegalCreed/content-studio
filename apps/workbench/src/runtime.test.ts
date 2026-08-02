import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchRuntime } from './runtime'

describe('workbench runtime client', () => {
  it('reads health and a project view through the local application service', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        contractVersion: 1,
        projectId: 'project-a',
        status: 'ready',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        activities: [],
        project: { projectId: 'project-a' },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const runtime = createWorkbenchRuntime('/api/v1')
    await expect(runtime.health()).resolves.toEqual({
      contractVersion: 1,
      projectId: 'project-a',
      status: 'ready',
    })
    await expect(runtime.project('project-a')).resolves.toMatchObject({
      project: { projectId: 'project-a' },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/health',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('turns a non-success response into a readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'blocked' }), { status: 403 }),
    ))

    await expect(createWorkbenchRuntime().health()).rejects.toThrow(
      'Runtime request failed (403): blocked',
    )
  })
})
