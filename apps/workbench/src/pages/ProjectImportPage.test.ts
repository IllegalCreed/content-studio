import type { WorkbenchRuntime } from '../runtime'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProjectImportPage from './ProjectImportPage.vue'

const routerStub = {
  template: '<a><slot /></a>',
}

function createRuntimeMock(): WorkbenchRuntime {
  return {
    registerProject: vi.fn().mockResolvedValue({
      captureMode: 'assisted',
      currentSnapshotId: 'demo-snapshot-1',
      name: 'Demo Project',
      projectId: 'demo-project',
      repeatability: 'low',
      sourceAccess: 'web-assisted',
    }),
  } as unknown as WorkbenchRuntime
}

describe('project import page', () => {
  it('builds a manifest from the guided form and registers it after confirmation', async () => {
    const runtime = createRuntimeMock()
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime },
    })

    await wrapper.get('[data-testid="import-name"]').setValue('Demo Project')
    await wrapper.get('[data-testid="import-url"]').setValue('https://demo.example.com/')
    await wrapper.get('[data-testid="import-mode-source"]').setValue(true)

    expect(wrapper.get('[data-testid="import-preview"]').text()).toContain('demo-project')
    expect(wrapper.get('[data-testid="preview-mode"]').text()).toBe('source-owned')

    await wrapper.get('[data-testid="import-confirm"]').trigger('click')

    expect(runtime.registerProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'demo-project',
        sourceAccess: 'source-owned',
        captureMode: 'deterministic',
        canonicalUrl: 'https://demo.example.com/',
      }),
    )
    expect(wrapper.get('[data-testid="import-success"]').text()).toContain('demo-project')
  })

  it('parses a pasted project.json and shows its summary before registration', async () => {
    const runtime = createRuntimeMock()
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime },
    })

    await wrapper.get('[data-testid="import-tab-upload"]').trigger('click')
    await wrapper.get('[data-testid="import-json"]').setValue(JSON.stringify({
      canonicalUrl: 'https://pasted.example.com/',
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: 'Pasted Project',
      projectId: 'pasted-project',
      repositoryUrl: 'https://example.invalid/',
      schemaVersion: 1,
      sourceAccess: 'web-assisted',
      captureMode: 'assisted',
      repeatability: 'low',
      tagline: {
        'en': 'Pasted Project',
        'zh-CN': 'Pasted Project',
      },
    }))
    await wrapper.get('[data-testid="import-upload"]').trigger('submit')

    expect(wrapper.get('[data-testid="import-preview"]').text()).toContain('pasted-project')
    expect(wrapper.get('[data-testid="preview-mode"]').text()).toBe('web-assisted')
  })

  it('rejects invalid JSON with an inline error', async () => {
    const runtime = createRuntimeMock()
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime },
    })

    await wrapper.get('[data-testid="import-tab-upload"]').trigger('click')
    await wrapper.get('[data-testid="import-json"]').setValue('not json')
    await wrapper.get('[data-testid="import-upload"]').trigger('submit')

    expect(wrapper.get('[data-testid="import-error"]').text()).toContain('JSON')
    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(false)
  })

  it('shows the runtime error when registration fails', async () => {
    const runtime = {
      registerProject: vi.fn().mockRejectedValue(new Error('manifest invalid')),
    } as unknown as WorkbenchRuntime
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime },
    })

    await wrapper.get('[data-testid="import-name"]').setValue('Demo Project')
    await wrapper.get('[data-testid="import-url"]').setValue('https://demo.example.com/')
    await wrapper.get('[data-testid="import-confirm"]').trigger('click')

    expect(wrapper.get('[data-testid="import-submit-error"]').text()).toContain('manifest invalid')
  })
})
