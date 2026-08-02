import { describe, expect, it, vi } from 'vitest'
import {
  createAttachedPreviewAdapter,
  withProjectPreview,
} from './preview'

describe('project preview adapter', () => {
  it('attaches to an explicit base URL and closes the handoff', async () => {
    const close = vi.fn(async () => {})
    const adapter = {
      adapterId: 'test-preview',
      open: vi.fn(async () => ({
        baseUrl: 'http://127.0.0.1:11000',
        close,
      })),
    }

    await expect(
      withProjectPreview(
        adapter,
        {
          projectId: 'algorithm-visualizer',
        },
        async baseUrl => `recorded:${baseUrl}`,
      ),
    ).resolves.toBe('recorded:http://127.0.0.1:11000')
    expect(adapter.open).toHaveBeenCalledWith({
      projectId: 'algorithm-visualizer',
    })
    expect(close).toHaveBeenCalledOnce()

    await expect(
      withProjectPreview(
        createAttachedPreviewAdapter('http://127.0.0.1:11000/path'),
        {
          projectId: 'algorithm-visualizer',
        },
        async baseUrl => baseUrl,
      ),
    ).resolves.toBe('http://127.0.0.1:11000')
  })

  it('closes a preview when recording fails and rejects credentialed URLs', async () => {
    const close = vi.fn(async () => {})
    await expect(
      withProjectPreview(
        {
          adapterId: 'test-preview',
          open: async () => ({
            baseUrl: 'http://127.0.0.1:11000',
            close,
          }),
        },
        {
          projectId: 'algorithm-visualizer',
        },
        async () => {
          throw new Error('recording failed')
        },
      ),
    ).rejects.toThrow(/recording failed/)
    expect(close).toHaveBeenCalledOnce()

    expect(() =>
      createAttachedPreviewAdapter(
        'https://identity@example.com',
      ),
    ).toThrow(/credentials/i)
    expect(() =>
      createAttachedPreviewAdapter('not-a-url'),
    ).toThrow(/valid HTTP/)
    expect(() =>
      createAttachedPreviewAdapter('file:///tmp/preview.html'),
    ).toThrow(/HTTP/)

    await expect(
      withProjectPreview(
        {
          adapterId: ' ',
          open: async () => ({
            baseUrl: 'http://127.0.0.1:11000',
            close,
          }),
        },
        {
          projectId: 'algorithm-visualizer',
        },
        async baseUrl => baseUrl,
      ),
    ).rejects.toThrow(/adapterId/)
  })
})
