import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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
    expect(wrapper.text()).toContain('按业务结果更新')
    expect(wrapper.text()).not.toContain('不等同于任务内部阶段')
    expect(wrapper.get('.activity-progress-list').attributes('style')).toMatch(/--activity-progress: 0(?:\.\d+)?/u)
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

  it('读取运行时期间只显示详情加载状态，不显示演示活动内容', async () => {
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

    store.beginRuntimeLoad()
    await nextTick()

    expect(wrapper.get('[data-testid="activity-detail-runtime-state"]').text()).toContain('正在读取活动详情')
    expect(wrapper.find('[data-testid="activity-business-progress"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="activity-publication-results"]').exists()).toBe(false)
  })

  it('在发布前完整展示渠道正文和已登记图片，而不是只显示文件名', async () => {
    const pinia = createPinia()
    const store = useWorkbenchStore(pinia)
    vi.spyOn(store, 'refresh').mockResolvedValue()
    const campaign = store.snapshot.campaigns.find(item => item.campaignId === 'quick-sort-guide')!
    const content = campaign.contentGroups[0]!.contents[0]!
    content.body = '第一段解释分区不变量。\n\n第二段解释复杂度。'
    content.artifactIds = ['quick-sort-preview-frame']
    campaign.activityArtifacts[0] = {
      ...campaign.activityArtifacts[0]!,
      previewKind: 'image',
      previewUrl: '/api/v1/projects/algorithm-visualizer/activity-artifacts/quick-sort-preview-frame/preview',
    }
    const router = createWorkbenchRouter(true)
    await router.push('/project/activities/quick-sort-guide')
    await router.isReady()

    const wrapper = mount(ActivityDetailPage, {
      global: {
        plugins: [pinia, router],
      },
    })

    expect(wrapper.get('[data-testid="channel-content-body"]').text())
      .toBe('第一段解释分区不变量。\n\n第二段解释复杂度。')
    expect(wrapper.get('[data-testid="channel-content-detail"]').attributes('open')).toBe('')
    expect(wrapper.get('[data-testid="channel-content-detail"] summary').text()).toContain('查看成品')
    expect(wrapper.get('[data-testid="channel-content-media"] img').attributes())
      .toMatchObject({
        alt: '分区动画 · 第 20 帧',
        height: '3',
        src: '/api/v1/projects/algorithm-visualizer/activity-artifacts/quick-sort-preview-frame/preview',
        width: '4',
      })
  })
})
