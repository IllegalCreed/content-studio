import type {
  ActivityArtifact,
  ActivityRevisionInput,
  ChannelContent,
  ChannelContentMediaRevisionInput,
  ContentGroup,
  ContentStudioGlobalView,
  ContentStudioProjectIndex,
  ContentStudioProjectView,
  CreateActivityArtifactInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  ExecutionTask,
  ExecutionTaskEvent,
  MarketingOpsAssistedPublicationResult,
  MarketingOpsChannelsStatusSnapshot,
  OwnerHandoff,
  OwnerTakeoverRecord,
  ProjectAsset,
  ProjectChannelBinding,
  ProjectManifest,
  ProjectRecord,
  PromoteActivityArtifactInput,
  PublicationPlan,
  PublishingActivity,
  RecorderAttemptReceipt,
  StorageCleanupConfirmation,
  StorageCleanupPreview,
  StorageCleanupResult,
  StorageRecycleEntry,
  StorageRestoreResult,
} from '@content-studio/core-types'

export interface RuntimeHealth {
  contractVersion: 1
  projectId: string
  status: 'ready'
}

export interface RecordTaskInput {
  baseUrl: string
  projectOrigin: string
}

export interface RecordTaskResult {
  receipt: RecorderAttemptReceipt
  task: ExecutionTask
}

export interface OwnerTakeoverConfirmationResult {
  ownerTakeover: OwnerTakeoverRecord
  projectId: string
  taskId: string
}

export interface WorkbenchRuntime {
  abandonManagedPublicationHandoff: (
    projectId: string,
    handoffId: string,
  ) => Promise<MarketingOpsAssistedPublicationResult>
  cancelOwnerHandoff: (projectId: string, handoffId: string) => Promise<OwnerHandoff>
  cancelTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  confirmOwnerTakeover: (
    projectId: string,
    taskId: string,
  ) => Promise<OwnerTakeoverConfirmationResult>
  confirmStorageCleanup: (input: StorageCleanupConfirmation) => Promise<StorageCleanupResult>
  completeOwnerHandoff: (projectId: string, handoffId: string) => Promise<OwnerHandoff>
  confirmActivityVideoPlan: (
    projectId: string,
    activityId: string,
    baseVersion: number,
  ) => Promise<PublishingActivity>
  createChannelContent: (input: CreateChannelContentInput) => Promise<ChannelContent>
  reviseChannelContentMedia: (input: ChannelContentMediaRevisionInput) => Promise<ChannelContent>
  createContentGroup: (input: CreateContentGroupInput) => Promise<ContentGroup>
  createActivity: (input: CreatePublishingActivityInput) => Promise<PublishingActivity>
  createActivityArtifact: (input: CreateActivityArtifactInput) => Promise<ActivityArtifact>
  createPublicationPlan: (input: PublicationPlan) => Promise<PublicationPlan>
  health: () => Promise<RuntimeHealth>
  confirmManagedPublicationHandoff: (
    projectId: string,
    handoffId: string,
  ) => Promise<MarketingOpsAssistedPublicationResult>
  marketingOpsStatus: (projectId: string) => Promise<MarketingOpsChannelsStatusSnapshot>
  global: () => Promise<ContentStudioGlobalView>
  project: (projectId: string) => Promise<ContentStudioProjectView>
  projects: () => Promise<ContentStudioProjectIndex>
  promoteActivityArtifact: (input: PromoteActivityArtifactInput) => Promise<ProjectAsset>
  registerProject: (manifest: ProjectManifest) => Promise<ProjectRecord>
  reviseActivity: (input: ActivityRevisionInput) => Promise<PublishingActivity>
  recordTask: (
    projectId: string,
    taskId: string,
    input: RecordTaskInput,
  ) => Promise<RecordTaskResult>
  storageCleanupPreview: (projectId: string) => Promise<StorageCleanupPreview>
  storageRecycle: (projectId: string) => Promise<{ entries: StorageRecycleEntry[], projectId: string }>
  restoreStorageRecycleEntry: (projectId: string, recycleId: string) => Promise<StorageRestoreResult>
  retryTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  resumeManagedPublicationHandoff: (
    projectId: string,
    handoffId: string,
  ) => Promise<MarketingOpsAssistedPublicationResult>
  startTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  taskEvents: (projectId: string, taskId: string) => Promise<ExecutionTaskEvent[]>
  saveProjectChannelBinding: (binding: ProjectChannelBinding) => Promise<ProjectChannelBinding>
}

export function createWorkbenchRuntime(basePath = '/api/v1'): WorkbenchRuntime {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${basePath}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    })
    const payload = await response.json() as unknown
    if (!response.ok)
      throw new Error(`Runtime request failed (${response.status}): ${errorMessage(payload)}`)
    return payload as T
  }

  return {
    abandonManagedPublicationHandoff: (projectId, handoffId) => request<MarketingOpsAssistedPublicationResult>(
      `/projects/${encodeURIComponent(projectId)}/owner-handoffs/${encodeURIComponent(handoffId)}/marketing-ops/abandon`,
      { method: 'POST' },
    ),
    cancelOwnerHandoff: (projectId, handoffId) => request<OwnerHandoff>(
      `/projects/${encodeURIComponent(projectId)}/owner-handoffs/${encodeURIComponent(handoffId)}/cancel`,
      { method: 'POST' },
    ),
    cancelTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: 'POST' },
    ),
    confirmOwnerTakeover: (projectId, taskId) => request<OwnerTakeoverConfirmationResult>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/owner-confirm`,
      { method: 'POST' },
    ),
    confirmStorageCleanup: input => request<StorageCleanupResult>(
      `/projects/${encodeURIComponent(input.projectId)}/storage/cleanup/confirm`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    completeOwnerHandoff: (projectId, handoffId) => request<OwnerHandoff>(
      `/projects/${encodeURIComponent(projectId)}/owner-handoffs/${encodeURIComponent(handoffId)}/complete`,
      { method: 'POST' },
    ),
    confirmActivityVideoPlan: (projectId, activityId, baseVersion) => request<PublishingActivity>(
      `/projects/${encodeURIComponent(projectId)}/activities/${encodeURIComponent(activityId)}/video-plan/confirm`,
      {
        body: JSON.stringify({ baseVersion }),
        method: 'POST',
      },
    ),
    createChannelContent: input => request<ChannelContent>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/content-groups/${encodeURIComponent(input.contentGroupId)}/contents`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    reviseChannelContentMedia: input => request<ChannelContent>(
      `/projects/${encodeURIComponent(input.projectId)}/channel-contents/${encodeURIComponent(input.contentId)}/media`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    createContentGroup: input => request<ContentGroup>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/content-groups`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    createActivity: input => request<PublishingActivity>(
      `/projects/${encodeURIComponent(input.projectId)}/activities`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    createActivityArtifact: input => request<ActivityArtifact>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/artifacts`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    createPublicationPlan: input => request<PublicationPlan>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/publication-plans`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    health: () => request<RuntimeHealth>('/health'),
    confirmManagedPublicationHandoff: (projectId, handoffId) => request<MarketingOpsAssistedPublicationResult>(
      `/projects/${encodeURIComponent(projectId)}/owner-handoffs/${encodeURIComponent(handoffId)}/marketing-ops/confirm`,
      { method: 'POST' },
    ),
    marketingOpsStatus: projectId => request<MarketingOpsChannelsStatusSnapshot>(
      `/projects/${encodeURIComponent(projectId)}/marketing-ops/channels-status`,
    ),
    global: () => request<ContentStudioGlobalView>('/global'),
    project: projectId => request<ContentStudioProjectView>(
      `/projects/${encodeURIComponent(projectId)}`,
    ),
    projects: () => request<ContentStudioProjectIndex>('/projects'),
    promoteActivityArtifact: input => request<ProjectAsset>(
      `/projects/${encodeURIComponent(input.projectId)}/activity-artifacts/${encodeURIComponent(input.artifactId)}/promote`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    registerProject: manifest => request<ProjectRecord>(
      '/registry/projects',
      {
        body: JSON.stringify(manifest),
        method: 'POST',
      },
    ),
    reviseActivity: input => request<PublishingActivity>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/revise`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    recordTask: (projectId, taskId, input) => request<RecordTaskResult>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/record`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    storageCleanupPreview: projectId => request<StorageCleanupPreview>(
      `/projects/${encodeURIComponent(projectId)}/storage/cleanup-preview`,
    ),
    storageRecycle: projectId => request<{ entries: StorageRecycleEntry[], projectId: string }>(
      `/projects/${encodeURIComponent(projectId)}/storage/recycle`,
    ),
    restoreStorageRecycleEntry: (projectId, recycleId) => request<StorageRestoreResult>(
      `/projects/${encodeURIComponent(projectId)}/storage/recycle/${encodeURIComponent(recycleId)}/restore`,
      { method: 'POST' },
    ),
    retryTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: 'POST' },
    ),
    resumeManagedPublicationHandoff: (projectId, handoffId) => request<MarketingOpsAssistedPublicationResult>(
      `/projects/${encodeURIComponent(projectId)}/owner-handoffs/${encodeURIComponent(handoffId)}/marketing-ops/resume`,
      { method: 'POST' },
    ),
    startTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/start`,
      { method: 'POST' },
    ),
    taskEvents: (projectId, taskId) => request<{ events: ExecutionTaskEvent[] }>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events`,
    ).then(result => result.events),
    saveProjectChannelBinding: binding => request<ProjectChannelBinding>(
      `/projects/${encodeURIComponent(binding.projectId)}/channel-bindings/${encodeURIComponent(binding.channel)}`,
      {
        body: JSON.stringify(binding),
        method: 'POST',
      },
    ),
  }
}

function errorMessage(payload: unknown): string {
  if (
    typeof payload === 'object'
    && payload !== null
    && 'error' in payload
    && typeof payload.error === 'string'
  ) {
    return payload.error
  }
  return 'Unknown runtime error'
}
