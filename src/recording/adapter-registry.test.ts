import { describe, expect, it } from 'vitest'
import { ProjectPreviewAdapterRegistry } from './adapter-registry'
import { createAttachedPreviewAdapter } from './preview'

describe('project preview adapter registry', () => {
  it('resolves only an explicitly owner-approved adapter for its project', () => {
    const adapter = createAttachedPreviewAdapter('http://127.0.0.1:11000')
    const registry = new ProjectPreviewAdapterRegistry([{
      adapter,
      adapterId: 'attached-preview',
      adapterVersion: '1.0.0',
      ownerApproved: true,
      projectId: 'algorithm-visualizer',
    }])

    expect(registry.resolve('algorithm-visualizer', 'attached-preview')).toBe(adapter)
    expect(registry.resolve('other-project', 'attached-preview')).toBeUndefined()
    expect(registry.resolve('algorithm-visualizer', undefined)).toBeUndefined()
  })

  it('fails closed for missing owner approval, invalid ids, versions, and duplicates', () => {
    const adapter = createAttachedPreviewAdapter('http://127.0.0.1:11000')

    expect(() => new ProjectPreviewAdapterRegistry([{
      adapter,
      adapterId: 'attached-preview',
      adapterVersion: '1.0.0',
      ownerApproved: false,
      projectId: 'algorithm-visualizer',
    }])).toThrow(/owner approval/i)

    expect(() => new ProjectPreviewAdapterRegistry([{
      adapter,
      adapterId: 'attached-preview',
      adapterVersion: '1.0.0',
      ownerApproved: true,
      projectId: 'Algorithm Visualizer',
    }])).toThrow(/projectId/i)

    expect(() => new ProjectPreviewAdapterRegistry([{
      adapter,
      adapterId: 'attached-preview',
      adapterVersion: '',
      ownerApproved: true,
      projectId: 'algorithm-visualizer',
    }])).toThrow(/adapterVersion/i)

    expect(() => new ProjectPreviewAdapterRegistry([{
      adapter: createAttachedPreviewAdapter('http://127.0.0.1:11001'),
      adapterId: 'attached-preview',
      adapterVersion: '1.0.0',
      ownerApproved: true,
      projectId: 'algorithm-visualizer',
    }, {
      adapter,
      adapterId: 'attached-preview',
      adapterVersion: '1.0.1',
      ownerApproved: true,
      projectId: 'algorithm-visualizer',
    }])).toThrow(/already registered/i)
  })

  it('rejects a registration whose descriptor does not match the implementation', () => {
    const adapter = createAttachedPreviewAdapter('http://127.0.0.1:11000')
    expect(() => new ProjectPreviewAdapterRegistry([{
      adapter: { ...adapter, adapterId: 'different-adapter' },
      adapterId: 'registered-adapter',
      adapterVersion: '1.0.0',
      ownerApproved: true,
      projectId: 'algorithm-visualizer',
    }])).toThrow(/adapterId/i)
  })
})
