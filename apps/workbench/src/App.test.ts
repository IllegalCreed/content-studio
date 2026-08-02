import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from './App.vue'

describe('content studio workbench', () => {
  it('把规划中的模块作为可切换的功能页面展示', async () => {
    const wrapper = mount(App)

    expect(wrapper.find('[data-testid="workbench-dashboard"]').exists()).toBe(true)
    expect(wrapper.get('h1').text()).toContain('总览')
    expect(wrapper.find('.hero').exists()).toBe(false)
    expect(wrapper.find('.workspace-tabs').exists()).toBe(false)
    expect(wrapper.text()).toContain('Algorithm Visualizer')
    expect(wrapper.text()).toContain('待处理任务')

    const projectSwitcher = wrapper.get('button[aria-label="切换项目"]')
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
    await wrapper.get('button[data-module="project"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目概览')
    expect(wrapper.text()).toContain('有源项目')
    expect(wrapper.text()).toContain('项目适配器')
    expect(wrapper.text()).toContain('账号绑定')
    await wrapper.get('button[data-module="activities"]').trigger('click')

    expect(wrapper.get('h1').text()).toContain('发布活动')
    expect(wrapper.text()).toContain('内容组与渠道内容')
    expect(wrapper.text()).toContain('关联执行任务')
    await wrapper.get('button[data-campaign-id="release-notes"]').trigger('click')

    expect(wrapper.text()).toContain('版本更新发布')
    expect(wrapper.text()).toContain('等待人工')

    await wrapper.get('button[data-module="tasks"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('任务面板')
    expect(wrapper.get('[data-testid="runtime-status"]').text()).toContain(
      '运行时未连接',
    )
    expect(wrapper.text()).toContain('浏览器录制')
    expect(wrapper.text()).toContain('快速排序可视化指南')
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
    expect(wrapper.text()).toContain('项目账号')
    await wrapper.get('button[data-channel-id="github"]').trigger('click')
    expect(wrapper.text()).toContain('Algorithm Visualizer Docs')
    await wrapper.get('button[data-channel-account-id="github-algorithm-docs"]').trigger('click')
    expect(wrapper.get('.channel-account-detail').text()).toContain('项目配置')
    await wrapper.get('button[data-channel-id="dev"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('需重新授权')
    await wrapper.get('button[data-channel-id="x"]').trigger('click')
    expect(wrapper.get('.channel-detail-card').text()).toContain('尚未读取渠道快照')

    await wrapper.get('button[data-module="assets"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目素材库')
    expect(wrapper.text()).toContain('Algorithm Visualizer 主 Logo')
    await wrapper.get('button[data-asset-filter="template"]').trigger('click')
    expect(wrapper.find('[data-asset-id="quick-sort-template"]').exists()).toBe(true)

    await wrapper.get('button[data-module="project-tasks"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目任务面板')

    await wrapper.get('button[data-module="reports"]').trigger('click')
    expect(wrapper.get('h1').text()).toContain('项目报告')
    expect(wrapper.text()).toContain('演示数据')
  })
})
