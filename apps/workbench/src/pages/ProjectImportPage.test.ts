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

  it('validates the pasted manifest shape before rendering its summary', async () => {
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime: createRuntimeMock() },
    })

    await wrapper.get('[data-testid="import-tab-upload"]').trigger('click')
    await wrapper.get('[data-testid="import-json"]').setValue('{}')
    await wrapper.get('[data-testid="import-upload"]').trigger('submit')

    expect(wrapper.get('[data-testid="import-error"]').text()).toContain('schemaVersion')
    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(false)
  })

  it('requires an explicit kebab-case project id when a Chinese name cannot be derived', async () => {
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime: createRuntimeMock() },
    })

    await wrapper.get('[data-testid="import-name"]').setValue('算法可视化器')
    await wrapper.get('[data-testid="import-url"]').setValue('https://demo.example.com/')

    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="import-form-error"]').text()).toContain('projectId')

    await wrapper.get('[data-testid="import-project-id"]').setValue('algorithm-visualizer')

    expect(wrapper.get('[data-testid="preview-project-id"]').text()).toBe('algorithm-visualizer')
  })

  it('does not carry a guided-form preview into the JSON tab', async () => {
    const wrapper = mount(ProjectImportPage, {
      global: { stubs: { RouterLink: routerStub } },
      props: { runtime: createRuntimeMock() },
    })

    await wrapper.get('[data-testid="import-name"]').setValue('Demo Project')
    await wrapper.get('[data-testid="import-url"]').setValue('https://demo.example.com/')
    expect(wrapper.find('[data-testid="import-preview"]').exists()).toBe(true)

    await wrapper.get('[data-testid="import-tab-upload"]').trigger('click')

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
