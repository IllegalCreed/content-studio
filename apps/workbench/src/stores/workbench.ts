import type {
  ContentStudioProjectView,
  PublishingActivity,
  VideoViewport,
} from '@content-studio/core-types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { snapshot as snapshotSeed } from '../model'
import { createWorkbenchRuntime } from '../runtime'

export const useWorkbenchStore = defineStore('workbench', () => {
  const projectId = snapshotSeed.project.projectId
  const snapshot = ref(structuredClone(snapshotSeed))
  const projectView = ref<ContentStudioProjectView | null>(null)
  const runtimeConnected = ref(false)
  const runtimeError = ref<string | null>(null)
  const loading = ref(false)
  const runtime = createWorkbenchRuntime()

  const activities = computed(() => projectView.value?.activities ?? [])

  async function refresh(): Promise<void> {
    loading.value = true
    runtimeError.value = null
    try {
      const health = await runtime.health()
      const view = await runtime.project(projectId)
      runtimeConnected.value = health.status === 'ready'
      projectView.value = view
    }
    catch (error: unknown) {
      runtimeConnected.value = false
      runtimeError.value = error instanceof Error ? error.message : '本地运行时暂时不可用'
    }
    finally {
      loading.value = false
    }
  }

  async function confirmActivityVideoPlan(
    activityId: string,
    baseVersion: number,
  ): Promise<void> {
    await runtime.confirmActivityVideoPlan(projectId, activityId, baseVersion)
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
      projectId,
      topic: activity.topic,
      video: {
        ...activity.video,
        viewport,
      },
    })
    await refresh()
  }

  return {
    activities,
    confirmActivityVideoPlan,
    loading,
    projectId,
    projectView,
    refresh,
    reviseActivityViewport,
    runtimeConnected,
    runtimeError,
    snapshot,
  }
})
