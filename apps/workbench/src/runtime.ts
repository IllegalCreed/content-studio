import type {
  ContentStudioProjectView,
  CreatePublishingActivityInput,
  PublishingActivity,
} from '@content-studio/core-types'

export interface RuntimeHealth {
  contractVersion: 1
  projectId: string
  status: 'ready'
}

export interface WorkbenchRuntime {
  createActivity: (input: CreatePublishingActivityInput) => Promise<PublishingActivity>
  health: () => Promise<RuntimeHealth>
  project: (projectId: string) => Promise<ContentStudioProjectView>
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
