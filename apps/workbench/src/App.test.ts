import type { WorkbenchSnapshot } from './model'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createWorkbenchRouter } from './router'
import { useWorkbenchStore } from './stores/workbench'
import { useWorkbenchUiStore } from './stores/workbench-ui'
import WorkbenchApp from './WorkbenchApp.vue'
import './styles.css'

describe('content studio workbench', () => {
  it('把规划中的模块作为可切换的功能页面展示', async () => {
    const router = createWorkbenchRouter(true)
    await router.push('/overview')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(WorkbenchApp, {
      global: {
        plugins: [pinia, router],
      },
    })
    const uiStore = useWorkbenchUiStore(pinia)

    expect(wrapper.find('[data-testid="workbench-dashboard"]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toContain('总览')
    expect(wrapper.find('.hero').exists()).toBe(false)
    expect(wrapper.find('.workspace-tabs').exists()).toBe(false)
    expect(wrapper.find('.workspace-actions button').exists()).toBe(false)
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('Algorithm Visualizer')
    expect(wrapper.text()).toContain('待处理任务')
    expect(wrapper.find('[data-testid="overview-scope-note"]').exists()).toBe(false)
    expect(wrapper.get('.overview-stats').text()).toContain('发布活动')
    expect(wrapper.get('.overview-stats').text()).not.toContain('项目渠道')
    expect(wrapper.find('.overview-stat-primary').exists()).toBe(false)
    expect(wrapper.find('.project-context-card').exists()).toBe(false)
    expect(wrapper.get('[data-testid="project-rollup-scope"]').classes()).toContain('project-rollup-scope')

    const projectSwitcher = wrapper.get('button[aria-label="切换项目"]')
    expect(wrapper.get('.project-switcher-chevron').element.tagName).toBe('svg')
    expect(wrapper.find('.project-switcher-chevron path').exists()).toBe(true)
    expect(projectSwitcher.attributes('aria-expanded')).toBe('false')
    await projectSwitcher.trigger('click')
    expect(projectSwitcher.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="project-menu"]').text()).toContain(
      'Algorithm Visualizer',
    )
    expect(wrapper.get('[data-testid="project-menu"]').text()).toContain(
      '暂无其他已注册项目',
    )
    await projectSwitcher.trigger('click')
    expect(wrapper.find('[data-testid="project-menu"]').exists()).toBe(false)

    expect(wrapper.get('[data-testid="module-nav"]').text()).toContain('渠道管理')
    await wrapper.get('a[data-module="channels"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toContain('渠道管理')
    expect(wrapper.text()).toContain('账号引用项目数')
    await wrapper.get('button[data-channel-id="github"]').trigger('click')
    expect(wrapper.get('.channel-account-list').text()).toContain('1 个项目引用')
    await wrapper.get('a[data-module="project"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toContain('项目概览')
    expect(wrapper.text()).toContain('有源项目')
    expect(wrapper.text()).toContain('项目适配器')
    expect(wrapper.text()).toContain('账号绑定')
    expect(wrapper.get('[data-project-channel-id="wechat"]').text()).toContain('仅生成内容 · 无需发布账号')
    await wrapper.get('[data-project-channel-id="wechat"]').trigger('click')
    expect(wrapper.get('[data-testid="project-channel-delivery"]').text()).toContain('仅生成内容')
    await wrapper.get('a[data-module="activities"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('h1').text()).toContain('发布活动')
    expect(wrapper.find('.workspace-actions button').exists()).toBe(false)
    expect(wrapper.get('.workspace-action-status').text()).toContain('运行时未连接')
    expect(wrapper.text()).toContain('内容素材与渠道成品')
    expect(wrapper.text()).toContain('关联执行任务')
    expect(wrapper.find('.campaign-detail .status-rail').exists()).toBe(false)
    expect(wrapper.get('[data-testid="shooting-plan"]').text()).toContain('拍摄大纲')
    expect(wrapper.get('[data-testid="shooting-plan"]').text()).toContain('第 2 版')
    expect(wrapper.get('[data-testid="shooting-plan"]').text()).toContain('待确认')
    expect(wrapper.get('[data-testid="confirm-video-plan"]').attributes()).toHaveProperty('disabled')
    await wrapper.get('button[data-campaign-id="release-notes"]').trigger('click')

    expect(wrapper.text()).toContain('版本更新发布')
    expect(wrapper.text()).toContain('等待人工')

    await wrapper.get('a[data-module="tasks"]').trigger('click')
    await nextTick()
    await flushPromises()
    expect(wrapper.get('h1').text()).toContain('任务面板')
    expect(uiStore.activeModule).toBe('tasks')
    expect(uiStore.activeTaskScope).toBe('全部项目')
    expect(wrapper.find('#tasks .section-heading').exists()).toBe(false)
    expect(wrapper.find('#tasks .section-intro').exists()).toBe(false)
    expect(wrapper.get('[data-testid="task-scope-note"]').text()).toContain('1 个已接入项目')
    expect(wrapper.findAll('.task-summary-card')).toHaveLength(4)
    expect(wrapper.get('[data-testid="task-summary-owner"]').text()).toContain('待人工')
    expect(wrapper.find('[data-testid="task-attention-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="task-summary-owner"]').text()).toContain('待人工')
    expect(wrapper.find('.task-scope-switch').exists()).toBe(false)
    expect(router.currentRoute.value.query.task).toBe('quick-sort-guide-recording')
    expect(wrapper.get('[data-testid="runtime-status"]').text()).toContain(
      '运行时未连接',
    )
    expect(wrapper.get('.task-runtime-status').text()).toContain('演示任务不可操作')
    expect(wrapper.get('[data-testid="start-task"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('[data-testid="record-task"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.find('.task-detail .task-progress').exists()).toBe(false)
    expect(wrapper.find('.task-detail .status-rail').exists()).toBe(false)
    expect(wrapper.find('.task-detail .task-step-list').exists()).toBe(true)
    expect(wrapper.text()).toContain('录制中')
    expect(wrapper.text()).toContain('快速排序可视化指南')
    expect(wrapper.get('.video-job-context').text()).toContain('快速排序演示视频')
    expect(wrapper.get('.video-job-context').text()).toContain('bilibili')
    expect(wrapper.find('.video-panel').exists()).toBe(true)
    expect(wrapper.get('[data-testid="recording-action-list"]').text()).toContain('等待拒绝按钮')
    expect(wrapper.get('[data-testid="recording-action-list"]').text()).toContain('点击播放按钮')
    await wrapper.get('button[data-task-id="quick-sort-guide-monitoring"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.video-panel').exists()).toBe(false)
    await wrapper.get('button[data-task-id="quick-sort-guide-recording"]').trigger('click')
    await nextTick()
    const retryButton = wrapper.get('[data-testid="retry-task"]')
    await wrapper.get('button[data-task-id="release-notes-publish-x"]').trigger('click')
    await nextTick()
    await flushPromises()
    expect(uiStore.selectedTaskId).toBe('release-notes-publish-x')
    expect(router.currentRoute.value.query.task).toBe('release-notes-publish-x')
    expect(wrapper.text()).toContain('需要人工介入')
    expect(wrapper.text()).toContain('等待渠道授权人登录、审核和最终点击')
    expect(wrapper.find('button[aria-label="Cancel recording job"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="publication-task-panel"]').text()).toContain('发布交付')
    expect(wrapper.get('[data-testid="publication-task-panel"]').text()).toContain('打开官方页面')
    expect(wrapper.get('[data-testid="publication-task-handoff"]').text()).toContain('请在官方页面完成审核和最终发布点击。')

    await wrapper.get('a[data-module="channels"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toContain('渠道管理')
    expect(wrapper.find('#channels .section-heading').exists()).toBe(false)
    expect(wrapper.find('#channels .section-intro').exists()).toBe(false)
    expect(wrapper.get('[data-testid="channel-directory-status"]').text()).toContain('19 个全局规格')
    expect(wrapper.text()).toContain('可进入发布助手')
    expect(wrapper.text()).toContain('仅生成内容')
    expect(wrapper.findAll('button[data-channel-id]')).toHaveLength(19)
    expect(wrapper.get('button[data-channel-id="wechat"]').text()).toContain('不进入发布助手')
    expect(wrapper.get('.channel-overview-grid').text()).not.toContain('项目已启用')
    expect(wrapper.text()).toContain('全局账号')
    expect(wrapper.get('.channel-detail-grid').text()).toContain('平台支持的指标')
    expect(wrapper.get('[data-testid="channel-directory-note"]').text()).toContain('项目启用哪些渠道')
    expect(wrapper.find('[data-testid="channel-project-summary"]').exists()).toBe(false)
    await wrapper.get('button[data-channel-id="github"]').trigger('click')
    expect(wrapper.text()).toContain('Algorithm Visualizer Docs')
    await wrapper.get('button[data-channel-account-id="github-algorithm-docs"]').trigger('click')
    await nextTick()
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      account: 'github-algorithm-docs',
      channel: 'github',
    })
    expect(wrapper.get('.channel-account-detail').text()).toContain('尚未读取该账号状态')
    await wrapper.get('button[data-channel-id="dev"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('需重新授权')
    await wrapper.get('button[data-channel-id="x"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('尚未读取该渠道的 marketing-ops 状态')

    await wrapper.get('a[data-module="project"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="project-channel-config"]').text()).toContain('项目渠道配置')
    expect(wrapper.get('[data-testid="project-channel-enabled"] strong').text()).toBe('8')
    expect(wrapper.get('[data-testid="project-channel-enabled"] small').text()).toContain('个渠道已启用')
    expect(wrapper.get('[data-testid="project-channel-summary"]').text()).toContain('活动可选择')
    expect(wrapper.get('[data-testid="project-channel-config"] [data-testid="save-channel-binding"]').attributes()).toHaveProperty('disabled')
    await wrapper.get('button[data-project-channel-id="github"]').trigger('click')
    const accountSelect = wrapper.get('[data-testid="project-channel-account"]')
    expect(accountSelect.text()).toContain('IllegalCreed')
    expect(accountSelect.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="project-channel-delivery"]').text()).toContain('全自动候选')
    expect(wrapper.find('[aria-label="交付方式"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="project-channel-account-alias"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="project-view-channels"]').classes()).toContain('primary-button')
    expect(wrapper.get('[data-testid="project-view-activities"]').classes()).toContain('primary-button')
    const saveChannelButton = wrapper.get('[data-testid="save-channel-binding"]')
    expect(getComputedStyle(saveChannelButton.element).fontSize).toBe(getComputedStyle(retryButton.element).fontSize)
    expect(getComputedStyle(saveChannelButton.element).padding).toBe(getComputedStyle(retryButton.element).padding)

    await wrapper.get('a[data-module="assets"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('h1').text()).toContain('项目素材库')
    expect(wrapper.text()).toContain('Algorithm Visualizer 主 Logo')
    expect(wrapper.get('.artifact-promote-button').attributes()).toHaveProperty('disabled')
    await wrapper.get('button[data-asset-filter="template"]').trigger('click')
    await nextTick()
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({
      asset: 'algorithm-logo',
      assetKind: 'template',
    })
    expect(wrapper.find('[data-asset-id="quick-sort-template"]').exists()).toBe(true)

    await wrapper.get('a[data-module="project-tasks"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目任务面板')
    expect(wrapper.find('#tasks .section-heading').exists()).toBe(false)
    expect(wrapper.find('.task-scope-switch').exists()).toBe(false)

    await wrapper.get('a[data-module="reports"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目报告')
    expect(wrapper.text()).toContain('演示数据')
    expect(wrapper.text()).toContain('监测时间线')
    expect(wrapper.text()).toContain('2026-08-02 09:30')
  })

  it('运行时返回空项目时显示空状态而不是读取不存在的活动', async () => {
    const router = createWorkbenchRouter(true)
    await router.push('/project/activities')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(WorkbenchApp, {
      global: {
        plugins: [pinia, router],
      },
    })
    const runtimeStore = useWorkbenchStore(pinia)

    const viewModel = wrapper.vm as unknown as { snapshot: WorkbenchSnapshot }
    viewModel.snapshot.runtimeConnected = true
    viewModel.snapshot.campaigns = []
    viewModel.snapshot.tasks = []
    expect(runtimeStore.snapshot.campaigns).toEqual([])
    await nextTick()

    expect(wrapper.text()).toContain('0 个活动')
    expect(wrapper.text()).toContain('当前运行时还没有发布活动')
    expect(wrapper.text()).not.toContain('Cannot read properties of undefined')

    runtimeStore.markRuntimeReady()
    await wrapper.get('a[data-module="tasks"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-testid="tasks-empty-state"]').text()).toContain('还没有制作、发布或监测任务')
    expect(wrapper.find('.task-detail').exists()).toBe(false)
    await wrapper.get('[data-testid="tasks-empty-state"] button').trigger('click')
    expect(router.currentRoute.value.path).toBe('/project/activities')
  })

  it('根据任务路由固定全局或项目范围', async () => {
    const router = createWorkbenchRouter(true)
    await router.push('/project/tasks')
    await router.isReady()
    const wrapper = mount(WorkbenchApp, {
      global: {
        plugins: [createPinia(), router],
      },
    })

    expect(wrapper.get('h1').text()).toContain('项目任务面板')
    expect(wrapper.get('[data-testid="task-scope-note"]').text()).toContain('当前项目 · Algorithm Visualizer')
    expect(wrapper.find('.task-scope-switch').exists()).toBe(false)
  })

  it('从深链接 query 恢复素材筛选和选中素材', async () => {
    const router = createWorkbenchRouter(true)
    await router.push('/project/assets?asset=quick-sort-template&assetKind=template')
    await router.isReady()
    const pinia = createPinia()
    const wrapper = mount(WorkbenchApp, {
      global: {
        plugins: [pinia, router],
      },
    })
    const uiStore = useWorkbenchUiStore(pinia)

    await nextTick()
    expect(uiStore.selectedAssetId).toBe('quick-sort-template')
    expect(uiStore.assetFilter).toBe('template')
    expect(wrapper.get('.asset-detail-card h3').text()).toContain('算法演示视频模板')
  })
})
