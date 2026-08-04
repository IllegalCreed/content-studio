import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchRouter } from '../router'
import { useWorkbenchStore } from '../stores/workbench'
import ActivityDetailPage from './ActivityDetailPage.vue'

describe('activity detail page', () => {
  it('在统一工作台外壳中展示活动业务对象和活动级上下文', async () => {
    const pinia = createPinia()
    const store = useWorkbenchStore(pinia)
    vi.spyOn(store, 'refresh').mockResolvedValue()
    const router = createWorkbenchRouter(true)
    await router.push('/project/activities/quick-sort-guide')
    await router.isReady()

    const wrapper = mount(ActivityDetailPage, {
      global: {
        plugins: [pinia, router],
      },
    })

    expect(wrapper.find('[data-testid="workbench-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-detail-page"]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toContain('快速排序可视化指南')
    expect(wrapper.text()).toContain('活动产物，不等于项目素材')
    expect(wrapper.text()).toContain('核心算法演示')
    expect(wrapper.find('[data-testid="activity-business-progress"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="activity-publication-results"]').exists()).toBe(true)
    expect(wrapper.get('a[data-module="activities"]').attributes('aria-current')).toBe('page')
  })

  it('从项目作用域深链接加载对应项目，而不是默认项目', async () => {
    const pinia = createPinia()
    const store = useWorkbenchStore(pinia)
    const refresh = vi.spyOn(store, 'refresh').mockResolvedValue()
    const router = createWorkbenchRouter(true)
    await router.push('/project/project-b/activities/quick-sort-guide')
    await router.isReady()

    const wrapper = mount(ActivityDetailPage, {
      global: {
        plugins: [pinia, router],
      },
    })

    expect(refresh).toHaveBeenCalledWith('project-b')
    expect(wrapper.get('.project-switcher').text()).toContain('project-b')
    expect(wrapper.get('a[data-module="activities"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('h1').text()).toBe('活动不存在')
  })
})
