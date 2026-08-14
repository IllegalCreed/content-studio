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
            handoffKind: 'generic',
            officialTargetUrl: 'https://x.com/compose/post',
            reason: '请完成 X 发布',
            status: 'waiting',
            taskId: 'publication-release-notes-x',
          },
          {
            accountAlias: 'Algorithm Visualizer Docs',
            campaignTitle: '版本更新发布',
            channel: 'github',
            checklist: ['检查文章内容'],
            expiresAt: '2026-08-03 19:00',
            handoffId: 'handoff-github-01',
            handoffKind: 'generic',
            officialTargetUrl: 'https://github.com/new',
            reason: '请完成 GitHub 发布',
            status: 'waiting',
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

  it('offers explicit completion and cancellation actions for pending handoffs', async () => {
    const wrapper = mount(OwnerInboxPage, {
      props: {
        ownerHandoffs: [{
          accountAlias: 'Docs',
          campaignTitle: '版本发布',
          channel: 'github',
          checklist: ['确认内容'],
          expiresAt: '2026-08-03 18:00',
          handoffId: 'handoff-a',
          handoffKind: 'generic',
          officialTargetUrl: 'https://github.com/new',
          reason: '请完成发布',
          status: 'waiting',
          taskId: 'publication-a',
        }],
      },
    })

    await wrapper.get('[data-testid="owner-handoff-complete"]').trigger('click')
    await wrapper.get('[data-testid="owner-handoff-cancel"]').trigger('click')
    expect(wrapper.emitted('complete-handoff')).toEqual([['handoff-a']])
    expect(wrapper.emitted('cancel-handoff')).toEqual([['handoff-a']])
  })

  it('keeps marketing-ops handoffs inside the managed confirmation workflow', () => {
    const wrapper = mount(OwnerInboxPage, {
      props: {
        ownerHandoffs: [{
          accountAlias: 'Bilibili Owner',
          campaignTitle: '真实活动',
          channel: 'bilibili',
          checklist: ['在官方页面完成最终发布'],
          expiresAt: '2026-08-14T08:00:00.000Z',
          handoffId: 'handoff-bilibili-a',
          handoffKind: 'marketing-ops',
          officialTargetUrl: 'https://member.bilibili.com/platform/upload/text/edit',
          reason: '等待渠道授权人完成登录、审核和最终点击',
          status: 'waiting',
          taskId: 'publication-bilibili-a',
        }],
      },
    })

    expect(wrapper.find('[data-testid="owner-handoff-complete"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="owner-handoff-cancel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="owner-handoff-official"]').attributes()).toMatchObject({
      href: 'https://member.bilibili.com/platform/upload/text/edit',
      rel: 'noreferrer',
      target: '_blank',
    })
    expect(wrapper.get('[data-testid="owner-handoff-managed-note"]').text())
      .toContain('受管发布流程')
    expect(wrapper.get('[data-testid="owner-handoff-managed-resume"]').text())
      .toContain('检查发布结果')
    expect(wrapper.find('[data-testid="owner-handoff-managed-confirm"]').exists()).toBe(false)
  })

  it('emits typed managed actions without accepting a caller-supplied public URL', async () => {
    const wrapper = mount(OwnerInboxPage, {
      props: {
        ownerHandoffs: [{
          accountAlias: 'Bilibili Owner',
          campaignTitle: '真实活动',
          channel: 'bilibili',
          checklist: ['确认严格公开地址'],
          confirmationStatus: 'pending',
          expiresAt: '2026-08-14T08:00:00.000Z',
          handoffId: 'handoff-bilibili-confirm',
          handoffKind: 'marketing-ops',
          officialTargetUrl: 'https://member.bilibili.com/platform/upload/text/edit',
          publicUrl: 'https://www.bilibili.com/opus/900000000000000005',
          reason: '等待确认回执',
          status: 'waiting',
          taskId: 'publication-bilibili-confirm',
        }],
      },
    })

    expect(wrapper.get('[data-testid="owner-handoff-public-url"]').attributes()).toMatchObject({
      href: 'https://www.bilibili.com/opus/900000000000000005',
      rel: 'noreferrer',
      target: '_blank',
    })
    expect(wrapper.find('[data-testid="owner-handoff-managed-resume"]').exists()).toBe(false)
    await wrapper.get('[data-testid="owner-handoff-managed-confirm"]').trigger('click')
    await wrapper.get('[data-testid="owner-handoff-managed-abandon"]').trigger('click')
    expect(wrapper.emitted('confirm-managed-handoff')).toEqual([['handoff-bilibili-confirm']])
    expect(wrapper.emitted('abandon-managed-handoff')).toEqual([['handoff-bilibili-confirm']])
  })
})
