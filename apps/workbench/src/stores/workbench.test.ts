import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from './workbench'

describe('workbench runtime store', () => {
  it('集中管理连接中的加载状态和错误状态', () => {
    setActivePinia(createPinia())
    const store = useWorkbenchStore()

    store.beginRuntimeLoad()
    expect(store.loading).toBe(true)
    expect(store.runtimeError).toBe(null)

    store.markRuntimeReady()
    expect(store.loading).toBe(false)
    expect(store.runtimeConnected).toBe(true)
    expect(store.runtimeError).toBe(null)

    store.beginRuntimeLoad()
    store.markRuntimeUnavailable(new Error('runtime offline'))
    expect(store.loading).toBe(false)
    expect(store.runtimeConnected).toBe(false)
    expect(store.runtimeError).toBe('runtime offline')
  })

  it('切换项目时丢弃较晚返回的旧项目视图', async () => {
    setActivePinia(createPinia())
    const store = useWorkbenchStore()
    const pending = new Map<string, Array<(response: Response) => void>>()
    const fetchMock = vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => {
      const path = String(input)
      const resolvers = pending.get(path) ?? []
      resolvers.push(resolve)
      pending.set(path, resolvers)
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resolveNext = (path: string, payload: unknown): void => {
      const resolver = pending.get(path)?.shift()
      if (resolver === undefined)
        throw new Error(`No pending request for ${path}`)
      resolver(new Response(JSON.stringify(payload), { status: 200 }))
    }

    const first = store.refresh('project-a')
    const second = store.refresh('project-b')
    resolveNext('/api/v1/health', { contractVersion: 1, projectId: 'project-a', status: 'ready' })
    resolveNext('/api/v1/health', { contractVersion: 1, projectId: 'project-b', status: 'ready' })
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    resolveNext('/api/v1/projects/project-b', { project: { projectId: 'project-b' }, activities: [] })
    resolveNext('/api/v1/projects/project-a', { project: { projectId: 'project-a' }, activities: [] })
    await Promise.all([first, second])

    expect(store.projectId).toBe('project-b')
    expect(store.projectView?.project.projectId).toBe('project-b')
  })
})
