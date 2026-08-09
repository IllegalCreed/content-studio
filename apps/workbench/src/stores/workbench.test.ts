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

  it('单独刷新 marketing-ops 状态，状态不可用时不把整个本地 runtime 标成离线', async () => {
    setActivePinia(createPinia())
    const store = useWorkbenchStore()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Marketing Ops status unavailable; publishing remains blocked',
    }), { status: 503 })))

    await expect(store.refreshMarketingOpsStatus('project-a')).resolves.toBe(null)
    expect(store.marketingOpsStatus).toBe(null)
    expect(store.marketingOpsStatusError).toBe('marketing-ops 状态未读取；发布保持阻塞')
    expect(store.runtimeConnected).toBe(false)
  })

  it('保留新鲜 marketing-ops 快照并绑定项目范围', async () => {
    setActivePinia(createPinia())
    const store = useWorkbenchStore()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authorizesExternalWrite: false,
      channels: [],
      contractVersion: 3,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      observedAt: new Date(Date.now() - 1000).toISOString(),
      projectId: 'project-a',
      runtimeVersion: '0.1.0',
    }), { status: 200 })))

    await expect(store.refreshMarketingOpsStatus('project-a')).resolves.toMatchObject({
      projectId: 'project-a',
    })
    expect(store.marketingOpsStatusError).toBe(null)
  })

  it('运行时断开后丢弃尚未返回的 marketing-ops 快照', async () => {
    setActivePinia(createPinia())
    const store = useWorkbenchStore()
    let resolveStatus: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveStatus = resolve
    })))

    const refresh = store.refreshMarketingOpsStatus('project-a')
    store.markRuntimeUnavailable(new Error('runtime offline'))
    resolveStatus?.(new Response(JSON.stringify({
      authorizesExternalWrite: false,
      channels: [],
      contractVersion: 3,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      observedAt: new Date().toISOString(),
      projectId: 'project-a',
      runtimeVersion: '0.1.0',
    }), { status: 200 }))

    await expect(refresh).resolves.toBe(null)
    expect(store.marketingOpsStatus).toBe(null)
    expect(store.marketingOpsStatusLoading).toBe(false)
  })
})
