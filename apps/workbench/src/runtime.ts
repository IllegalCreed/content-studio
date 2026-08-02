import type {
  ChannelContent,
  ContentGroup,
  ContentStudioProjectView,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  ExecutionTask,
  ExecutionTaskEvent,
  PublishingActivity,
  RecorderAttemptReceipt,
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

export interface WorkbenchRuntime {
  cancelTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  createChannelContent: (input: CreateChannelContentInput) => Promise<ChannelContent>
  createContentGroup: (input: CreateContentGroupInput) => Promise<ContentGroup>
  createActivity: (input: CreatePublishingActivityInput) => Promise<PublishingActivity>
  health: () => Promise<RuntimeHealth>
  project: (projectId: string) => Promise<ContentStudioProjectView>
  recordTask: (
    projectId: string,
    taskId: string,
    input: RecordTaskInput,
  ) => Promise<RecordTaskResult>
  retryTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  startTask: (projectId: string, taskId: string) => Promise<ExecutionTask>
  taskEvents: (projectId: string, taskId: string) => Promise<ExecutionTaskEvent[]>
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
    cancelTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: 'POST' },
    ),
    createChannelContent: input => request<ChannelContent>(
      `/projects/${encodeURIComponent(input.projectId)}/activities/${encodeURIComponent(input.activityId)}/content-groups/${encodeURIComponent(input.contentGroupId)}/contents`,
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
    health: () => request<RuntimeHealth>('/health'),
    project: projectId => request<ContentStudioProjectView>(
      `/projects/${encodeURIComponent(projectId)}`,
    ),
    recordTask: (projectId, taskId, input) => request<RecordTaskResult>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/record`,
      {
        body: JSON.stringify(input),
        method: 'POST',
      },
    ),
    retryTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: 'POST' },
    ),
    startTask: (projectId, taskId) => request<ExecutionTask>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/start`,
      { method: 'POST' },
    ),
    taskEvents: (projectId, taskId) => request<{ events: ExecutionTaskEvent[] }>(
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/events`,
    ).then(result => result.events),
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
