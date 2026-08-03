import type { ChannelId } from '@content-studio/core-types'
import type { AssetProjection } from '../model'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { snapshot as snapshotSeed } from '../model'

export type WorkbenchModuleId
  = | 'overview'
    | 'project'
    | 'activities'
    | 'tasks'
    | 'project-tasks'
    | 'channels'
    | 'assets'
    | 'owner'
    | 'reports'

export type TaskScope = '全部项目' | '当前项目'
export type AssetFilter = '全部' | AssetProjection['kind']

const initialCampaignId = snapshotSeed.campaigns[0]?.campaignId ?? ''
const initialTaskId = snapshotSeed.tasks[0]?.taskId ?? ''
const initialAssetId = snapshotSeed.projectAssets[0]?.assetId ?? ''
const initialChannelId: ChannelId = snapshotSeed.channels[0]?.channel ?? 'github'

export const useWorkbenchUiStore = defineStore('workbench-ui', () => {
  const activeModule = ref<WorkbenchModuleId>('overview')
  const activeTaskScope = ref<TaskScope>('全部项目')
  const selectedCampaignId = ref(initialCampaignId)
  const selectedTaskId = ref(initialTaskId)
  const selectedAssetId = ref(initialAssetId)
  const assetFilter = ref<AssetFilter>('全部')
  const selectedChannelId = ref<ChannelId>(initialChannelId)
  const selectedChannelAccountId = ref<string | null>(snapshotSeed.channels[0]?.projectAccountId ?? null)

  function setActiveModule(moduleId: WorkbenchModuleId): void {
    activeModule.value = moduleId
  }

  function setTaskScope(scope: TaskScope): void {
    activeTaskScope.value = scope
  }

  function selectCampaign(campaignId: string): void {
    selectedCampaignId.value = campaignId
  }

  function selectTask(taskId: string): void {
    selectedTaskId.value = taskId
  }

  function selectAsset(assetId: string): void {
    selectedAssetId.value = assetId
  }

  function setAssetFilter(filter: AssetFilter): void {
    assetFilter.value = filter
  }

  function selectChannel(channelId: ChannelId, accountId: string | null = null): void {
    selectedChannelId.value = channelId
    selectedChannelAccountId.value = accountId
  }

  function selectChannelAccount(accountId: string): void {
    selectedChannelAccountId.value = accountId
  }

  function $reset(): void {
    activeModule.value = 'overview'
    activeTaskScope.value = '全部项目'
    selectedCampaignId.value = initialCampaignId
    selectedTaskId.value = initialTaskId
    selectedAssetId.value = initialAssetId
    assetFilter.value = '全部'
    selectedChannelId.value = initialChannelId
    selectedChannelAccountId.value = snapshotSeed.channels[0]?.projectAccountId ?? null
  }

  return {
    $reset,
    activeModule,
    activeTaskScope,
    assetFilter,
    selectAsset,
    selectCampaign,
    selectChannel,
    selectChannelAccount,
    selectTask,
    selectedAssetId,
    selectedCampaignId,
    selectedChannelAccountId,
    selectedChannelId,
    selectedTaskId,
    setActiveModule,
    setAssetFilter,
    setTaskScope,
  }
})
