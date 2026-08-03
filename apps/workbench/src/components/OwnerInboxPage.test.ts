import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OwnerInboxPage from './OwnerInboxPage.vue'

describe('ownerInboxPage', () => {
  it('renders every owner handoff instead of hiding all but the first one', async () => {
    const wrapper = mount(OwnerInboxPage, {
      props: {
        ownerHandoffs: [
          {
            accountAlias: 'Algorithm Visualizer',
            campaignTitle: '版本更新发布',
            channel: 'x',
            checklist: ['确认账号已登录'],
            expiresAt: '2026-08-03 18:00',
            handoffId: 'handoff-x-01',
            officialTargetUrl: 'https://x.com/compose/post',
            reason: '请完成 X 发布',
            taskId: 'publication-release-notes-x',
          },
          {
            accountAlias: 'Algorithm Visualizer Docs',
            campaignTitle: '版本更新发布',
            channel: 'github',
            checklist: ['检查文章内容'],
            expiresAt: '2026-08-03 19:00',
            handoffId: 'handoff-github-01',
            officialTargetUrl: 'https://github.com/new',
            reason: '请完成 GitHub 发布',
          },
        ],
      },
    })

    expect(wrapper.findAll('[data-testid="owner-handoff-card"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('请完成 X 发布')
    expect(wrapper.text()).toContain('请完成 GitHub 发布')
    const taskButton = wrapper.get('[data-testid="owner-handoff-task"]')
    await taskButton.trigger('click')
    expect(wrapper.emitted('open-task')).toEqual([['publication-release-notes-x']])
  })
})
