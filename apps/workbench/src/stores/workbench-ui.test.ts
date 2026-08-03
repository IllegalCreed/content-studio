import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useWorkbenchUiStore } from './workbench-ui'

describe('workbench UI store', () => {
  it('集中保存页面选择和任务范围状态', () => {
    setActivePinia(createPinia())
    const store = useWorkbenchUiStore()

    store.setActiveModule('project-tasks')
    store.setTaskScope('当前项目')
    store.selectTask('production-quick-sort-guide')
    store.selectCampaign('quick-sort-guide')
    store.selectAsset('algorithm-logo')
    store.setAssetFilter('image')
    store.selectChannel('github')
    store.selectChannelAccount('github-illegalcreed')

    expect(store.activeModule).toBe('project-tasks')
    expect(store.activeTaskScope).toBe('当前项目')
    expect(store.selectedTaskId).toBe('production-quick-sort-guide')
    expect(store.selectedCampaignId).toBe('quick-sort-guide')
    expect(store.selectedAssetId).toBe('algorithm-logo')
    expect(store.assetFilter).toBe('image')
    expect(store.selectedChannelId).toBe('github')
    expect(store.selectedChannelAccountId).toBe('github-illegalcreed')
  })
})
