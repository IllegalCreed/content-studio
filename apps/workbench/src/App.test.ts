import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'
import './styles.css'

describe('content studio workbench', () => {
  it('把规划中的模块作为可切换的功能页面展示', async () => {
    const wrapper = mount(App)

    expect(wrapper.find('[data-testid="workbench-dashboard"]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toContain('总览')
    expect(wrapper.find('.hero').exists()).toBe(false)
    expect(wrapper.find('.workspace-tabs').exists()).toBe(false)
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('Algorithm Visualizer')
    expect(wrapper.text()).toContain('待处理任务')

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
    await wrapper.get('button[data-module="channels"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('渠道管理')
    expect(wrapper.text()).toContain('账号引用项目数')
    await wrapper.get('button[data-channel-id="github"]').trigger('click')
    expect(wrapper.get('.channel-account-list').text()).toContain('1 个项目引用')
    await wrapper.get('button[data-module="project"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目概览')
    expect(wrapper.text()).toContain('有源项目')
    expect(wrapper.text()).toContain('项目适配器')
    expect(wrapper.text()).toContain('账号绑定')
    await wrapper.get('button[data-module="activities"]').trigger('click')

    expect(wrapper.get('h1').text()).toContain('发布活动')
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

    await wrapper.get('button[data-module="tasks"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('任务面板')
    expect(wrapper.get('[data-testid="runtime-status"]').text()).toContain(
      '运行时未连接',
    )
    expect(wrapper.get('[data-testid="start-task"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('[data-testid="record-task"]').attributes()).toHaveProperty('disabled')
    expect(wrapper.find('.task-detail .status-rail').exists()).toBe(true)
    expect(wrapper.text()).toContain('浏览器录制')
    expect(wrapper.text()).toContain('快速排序可视化指南')
    const retryButton = wrapper.get('[data-testid="retry-task"]')
    await wrapper.get('button[data-task-id="release-notes-publish-x"]').trigger('click')
    expect(wrapper.text()).toContain('需要人工介入')
    expect(wrapper.text()).toContain('等待渠道授权人登录、审核和最终点击')
    expect(
      wrapper.get('button[aria-label="Cancel recording job"]').attributes(),
    ).toHaveProperty('disabled')

    await wrapper.get('button[data-module="channels"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('渠道管理')
    expect(wrapper.text()).toContain('发布助手状态')
    expect(wrapper.text()).toContain('全局规格')
    expect(wrapper.text()).toContain('全局账号')
    expect(wrapper.find('[data-testid="save-channel-binding"]').exists()).toBe(false)
    await wrapper.get('button[data-channel-id="github"]').trigger('click')
    expect(wrapper.text()).toContain('Algorithm Visualizer Docs')
    await wrapper.get('button[data-channel-account-id="github-algorithm-docs"]').trigger('click')
    expect(wrapper.get('.channel-account-detail').text()).toContain('项目配置')
    await wrapper.get('button[data-channel-id="dev"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('需重新授权')
    await wrapper.get('button[data-channel-id="x"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('尚未读取渠道快照')

    await wrapper.get('button[data-module="project"]').trigger('click')
    expect(wrapper.get('[data-testid="project-channel-config"]').text()).toContain('项目渠道配置')
    expect(wrapper.get('[data-testid="project-channel-config"] [data-testid="save-channel-binding"]').attributes()).toHaveProperty('disabled')
    await wrapper.get('button[data-project-channel-id="github"]').trigger('click')
    const accountSelect = wrapper.get('[data-testid="project-channel-account"]')
    expect(accountSelect.text()).toContain('IllegalCreed')
    expect(accountSelect.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="project-channel-account-alias"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="project-view-channels"]').classes()).toContain('primary-button')
    expect(wrapper.get('[data-testid="project-view-activities"]').classes()).toContain('primary-button')
    const saveChannelButton = wrapper.get('[data-testid="save-channel-binding"]')
    expect(getComputedStyle(saveChannelButton.element).fontSize).toBe(getComputedStyle(retryButton.element).fontSize)
    expect(getComputedStyle(saveChannelButton.element).padding).toBe(getComputedStyle(retryButton.element).padding)

    await wrapper.get('button[data-module="assets"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目素材库')
    expect(wrapper.text()).toContain('Algorithm Visualizer 主 Logo')
    expect(wrapper.get('.artifact-promote-button').attributes()).toHaveProperty('disabled')
    await wrapper.get('button[data-asset-filter="template"]').trigger('click')
    expect(wrapper.find('[data-asset-id="quick-sort-template"]').exists()).toBe(true)

    await wrapper.get('button[data-module="project-tasks"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目任务面板')

    await wrapper.get('button[data-module="reports"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目报告')
    expect(wrapper.text()).toContain('演示数据')
  })
})
