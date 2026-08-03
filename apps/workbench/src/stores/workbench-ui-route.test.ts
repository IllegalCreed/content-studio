import type { LocationQuery } from 'vue-router'
import { describe, expect, it } from 'vitest'
import {
  buildWorkbenchUiQuery,
  parseWorkbenchUiQuery,
} from './workbench-ui-route'

describe('workbench UI route state', () => {
  it('从地址栏读取选择状态，并只把当前页面需要的状态写回 query', () => {
    const query: LocationQuery = {
      account: 'github-algorithm-docs',
      activity: 'quick-sort-guide',
      asset: 'algorithm-logo',
      assetKind: 'image',
      channel: 'github',
      task: 'release-notes-publish-x',
    }

    expect(parseWorkbenchUiQuery(query)).toEqual({
      selectedCampaignId: 'quick-sort-guide',
      selectedTaskId: 'release-notes-publish-x',
      selectedAssetId: 'algorithm-logo',
      assetFilter: 'image',
      selectedChannelId: 'github',
      selectedChannelAccountId: 'github-algorithm-docs',
    })
    expect(buildWorkbenchUiQuery('activities', parseWorkbenchUiQuery(query))).toEqual({
      activity: 'quick-sort-guide',
    })
    expect(buildWorkbenchUiQuery('assets', parseWorkbenchUiQuery(query))).toEqual({
      asset: 'algorithm-logo',
      assetKind: 'image',
    })
    expect(buildWorkbenchUiQuery('channels', parseWorkbenchUiQuery(query))).toEqual({
      account: 'github-algorithm-docs',
      channel: 'github',
    })
  })

  it('忽略空值和不支持的素材筛选值', () => {
    expect(parseWorkbenchUiQuery({
      activity: '',
      assetKind: 'unknown',
      task: ['task-a', 'task-b'],
    })).toEqual({
      selectedTaskId: 'task-a',
    })
  })
})
