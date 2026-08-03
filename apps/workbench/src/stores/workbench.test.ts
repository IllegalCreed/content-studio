import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
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
})
