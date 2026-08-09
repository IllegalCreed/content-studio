import type { MarketingOpsChannelsStatusSnapshot } from '@content-studio/core-types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { snapshot as snapshotSeed } from '../model'
import ChannelManagementPage from './ChannelManagementPage.vue'

describe('channelManagementPage', () => {
  it('shows the runtime contract and freshness window without implying write authority', () => {
    const snapshot = structuredClone(snapshotSeed)
    const selectedChannel = snapshot.channels.find(channel => channel.channel === 'github')!
    const marketingOpsStatus: MarketingOpsChannelsStatusSnapshot = {
      authorizesExternalWrite: false,
      channels: [],
      contractVersion: 3,
      expiresAt: '2026-08-10T00:01:00.000Z',
      observedAt: '2026-08-10T00:00:00.000Z',
      projectId: snapshot.project.projectId,
      runtimeVersion: '0.1.0',
    }

    const wrapper = mount(ChannelManagementPage, {
      props: {
        accountReferenceCount: () => 0,
        channelSnapshotCount: 1,
        marketingOpsStatus,
        marketingOpsStatusError: null,
        marketingOpsStatusLoading: false,
        selectedChannel,
        selectedChannelAccount: selectedChannel.accounts[0] ?? null,
        snapshot,
      },
    })

    expect(wrapper.get('[data-testid="marketing-ops-status-summary"]').text())
      .toContain('runtime 0.1.0 · contract v3')
    expect(wrapper.get('[data-testid="marketing-ops-status-summary"]').text())
      .toContain('不授予外部写入权限')
  })

  it('shows a fail-closed status message when marketing-ops is unavailable', () => {
    const snapshot = structuredClone(snapshotSeed)
    const selectedChannel = snapshot.channels.find(channel => channel.channel === 'github')!
    const wrapper = mount(ChannelManagementPage, {
      props: {
        accountReferenceCount: () => 0,
        channelSnapshotCount: 0,
        marketingOpsStatus: null,
        marketingOpsStatusError: 'marketing-ops 状态未读取；发布保持阻塞',
        marketingOpsStatusLoading: false,
        selectedChannel,
        selectedChannelAccount: selectedChannel.accounts[0] ?? null,
        snapshot,
      },
    })

    expect(wrapper.get('[data-testid="marketing-ops-status-summary"]').text())
      .toContain('状态未读取；发布保持阻塞')
  })
})
