import type {
  ContentStudioProjectView,
  MarketingOpsChannelsStatusSnapshot,
  PublishingActivity,
  VideoViewport,
} from '@content-studio/core-types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { snapshot as snapshotSeed } from '../model'
import { createWorkbenchRuntime } from '../runtime'

export const useWorkbenchStore = defineStore('workbench', () => {
  const projectId = ref(snapshotSeed.project.projectId)
  const snapshot = ref(structuredClone(snapshotSeed))
  const projectView = ref<ContentStudioProjectView | null>(null)
  const runtimeConnected = ref(false)
  const runtimeError = ref<string | null>(null)
  const marketingOpsStatus = ref<MarketingOpsChannelsStatusSnapshot | null>(null)
  const marketingOpsStatusError = ref<string | null>(null)
  const marketingOpsStatusLoading = ref(false)
  const loading = ref(false)
  const runtime = createWorkbenchRuntime()
  let refreshRequestId = 0
  let marketingOpsStatusRequestId = 0

  const activities = computed(() => projectView.value?.activities ?? [])

  function beginRuntimeLoad(): void {
    loading.value = true
    runtimeError.value = null
  }

  function markRuntimeReady(): void {
    loading.value = false
    runtimeConnected.value = true
    runtimeError.value = null
  }

  function markRuntimeUnavailable(error: unknown): void {
    marketingOpsStatusRequestId += 1
    loading.value = false
    runtimeConnected.value = false
    runtimeError.value = error instanceof Error ? error.message : '本地运行时暂时不可用'
    marketingOpsStatus.value = null
    marketingOpsStatusError.value = null
    marketingOpsStatusLoading.value = false
  }

  async function refreshMarketingOpsStatus(
    requestedProjectId = projectId.value,
  ): Promise<MarketingOpsChannelsStatusSnapshot | null> {
    const requestId = ++marketingOpsStatusRequestId
    projectId.value = requestedProjectId
    marketingOpsStatusLoading.value = true
    marketingOpsStatusError.value = null
    try {
      const status = await runtime.marketingOpsStatus(requestedProjectId)
      if (
        requestId !== marketingOpsStatusRequestId
        || projectId.value !== requestedProjectId
      ) {
        return marketingOpsStatus.value
      }
      marketingOpsStatus.value = status
      return status
    }
    catch {
      if (
        requestId === marketingOpsStatusRequestId
        && projectId.value === requestedProjectId
      ) {
        marketingOpsStatus.value = null
        marketingOpsStatusError.value = 'marketing-ops 状态未读取；发布保持阻塞'
      }
      return null
    }
    finally {
      if (requestId === marketingOpsStatusRequestId)
        marketingOpsStatusLoading.value = false
    }
  }

  async function refresh(requestedProjectId = projectId.value): Promise<void> {
    const requestId = ++refreshRequestId
    projectId.value = requestedProjectId
    beginRuntimeLoad()
    projectView.value = null
    try {
      const health = await runtime.health()
      const view = await runtime.project(requestedProjectId)
      if (requestId !== refreshRequestId || projectId.value !== requestedProjectId)
        return
      if (health.status === 'ready')
        markRuntimeReady()
      projectView.value = view
    }
    catch (error: unknown) {
      if (requestId === refreshRequestId && projectId.value === requestedProjectId)
        markRuntimeUnavailable(error)
    }
  }

  async function confirmActivityVideoPlan(
    activityId: string,
    baseVersion: number,
  ): Promise<void> {
    await runtime.confirmActivityVideoPlan(projectId.value, activityId, baseVersion)
    await refresh()
  }

  async function reviseActivityViewport(
    activity: PublishingActivity,
    viewport: VideoViewport,
  ): Promise<void> {
    if (activity.video === undefined)
      throw new Error('当前活动没有视频制作计划')
    await runtime.reviseActivity({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: projectId.value,
      topic: activity.topic,
      video: {
        ...activity.video,
        recordingProfile: {
          ...activity.video.recordingProfile,
          defaults: {
            ...activity.video.recordingProfile?.defaults,
            viewport,
          },
        },
      },
    })
    await refresh()
  }

  return {
    activities,
    beginRuntimeLoad,
    confirmActivityVideoPlan,
    loading,
    marketingOpsStatus,
    marketingOpsStatusError,
    marketingOpsStatusLoading,
    markRuntimeReady,
    markRuntimeUnavailable,
    projectId,
    projectView,
    refresh,
    refreshMarketingOpsStatus,
    reviseActivityViewport,
    runtimeConnected,
    runtimeError,
    snapshot,
  }
})
