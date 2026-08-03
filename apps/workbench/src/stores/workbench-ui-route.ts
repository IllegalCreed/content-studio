import type { ChannelId } from '@content-studio/core-types'
import type { LocationQuery, LocationQueryRaw, LocationQueryValue } from 'vue-router'
import type { AssetFilter, WorkbenchModuleId } from './workbench-ui'

export interface WorkbenchUiRouteState {
  assetFilter?: AssetFilter
  selectedAssetId?: string
  selectedCampaignId?: string
  selectedChannelAccountId?: string
  selectedChannelId?: ChannelId
  selectedTaskId?: string
}

const assetFilters = new Set<AssetFilter>([
  '全部',
  'audio',
  'font',
  'image',
  'logo',
  'template',
  'video',
])

const channelIds = new Set<ChannelId>([
  'bilibili',
  'bluesky',
  'dev',
  'douyin',
  'facebook',
  'github',
  'hacker-news',
  'jianshu',
  'juejin',
  'mastodon',
  'product-hunt',
  'reddit',
  'v2ex',
  'wechat',
  'weibo',
  'x',
  'xiaohongshu',
  'youtube',
  'zhihu',
])

export function parseWorkbenchUiQuery(query: LocationQuery): WorkbenchUiRouteState {
  const state: WorkbenchUiRouteState = {}
  const activityId = queryValue(query.activity)
  const taskId = queryValue(query.task)
  const assetId = queryValue(query.asset)
  const assetKind = queryValue(query.assetKind)
  const channelId = queryValue(query.channel)
  const accountId = queryValue(query.account)

  if (activityId !== undefined)
    state.selectedCampaignId = activityId
  if (taskId !== undefined)
    state.selectedTaskId = taskId
  if (assetId !== undefined)
    state.selectedAssetId = assetId
  if (assetKind !== undefined && assetFilters.has(assetKind as AssetFilter))
    state.assetFilter = assetKind as AssetFilter
  if (channelId !== undefined && channelIds.has(channelId as ChannelId))
    state.selectedChannelId = channelId as ChannelId
  if (accountId !== undefined)
    state.selectedChannelAccountId = accountId

  return state
}

export function buildWorkbenchUiQuery(
  moduleId: WorkbenchModuleId,
  state: WorkbenchUiRouteState,
): LocationQueryRaw {
  if (moduleId === 'activities') {
    return state.selectedCampaignId === undefined
      ? {}
      : { activity: state.selectedCampaignId }
  }
  if (moduleId === 'tasks' || moduleId === 'project-tasks') {
    return state.selectedTaskId === undefined
      ? {}
      : { task: state.selectedTaskId }
  }
  if (moduleId === 'assets') {
    return {
      ...(state.selectedAssetId === undefined ? {} : { asset: state.selectedAssetId }),
      ...(state.assetFilter === undefined || state.assetFilter === '全部'
        ? {}
        : { assetKind: state.assetFilter }),
    }
  }
  if (moduleId === 'channels') {
    return {
      ...(state.selectedChannelId === undefined ? {} : { channel: state.selectedChannelId }),
      ...(state.selectedChannelAccountId === undefined || state.selectedChannelAccountId === null
        ? {}
        : { account: state.selectedChannelAccountId }),
    }
  }
  return {}
}

function queryValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : undefined
}
