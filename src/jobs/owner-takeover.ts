import type {
  ExecutionTaskStore,
  OwnerTakeoverRecord,
} from '../types'
import { TaskStateError } from './task'

export interface PendingOwnerTakeover {
  pageUrl: string
  projectId: string
  requestedAt: string
  taskId: string
}

interface PendingTakeoverEntry extends PendingOwnerTakeover {
  reject: (error: unknown) => void
  resolve: (record: OwnerTakeoverRecord) => void
}

/**
 * Runtime-only confirmation boundary for owner takeover windows. The registry
 * maps a paused recording task to a pending human confirmation, drives the
 * task through `awaiting-owner`, and never carries manual input.
 */
export class OwnerTakeoverRegistry {
  private readonly pending = new Map<string, PendingTakeoverEntry>()

  constructor(private readonly taskStore: ExecutionTaskStore) {}

  async request(
    input: { jobId: string, pageUrl: string, projectId: string },
  ): Promise<OwnerTakeoverRecord> {
    const task = this.taskStore.getTask(input.projectId, input.jobId)
    if (
      task === undefined
      || task.kind !== 'production'
      || task.status !== 'recording'
    ) {
      throw new TaskStateError(
        'Owner takeover requires a recording production task',
      )
    }
    this.taskStore.transitionTask(input.projectId, input.jobId, 'awaiting-owner')
    return new Promise<OwnerTakeoverRecord>((resolve, reject) => {
      this.pending.set(taskKey(input.projectId, input.jobId), {
        pageUrl: input.pageUrl,
        projectId: input.projectId,
        reject,
        requestedAt: new Date().toISOString(),
        resolve,
        taskId: input.jobId,
      })
    })
  }

  confirm(projectId: string, taskId: string): OwnerTakeoverRecord {
    const pending = this.requirePending(projectId, taskId)
    const confirmedAt = new Date().toISOString()
    const record = {
      confirmedAt,
      requestedAt: pending.requestedAt,
    }
    this.pending.delete(taskKey(projectId, taskId))
    try {
      this.taskStore.transitionTask(projectId, taskId, 'recording')
    }
    catch (error: unknown) {
      pending.reject(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
    pending.resolve(record)
    return record
  }

  dismiss(projectId: string, taskId: string): void {
    const pending = this.pending.get(taskKey(projectId, taskId))
    if (pending === undefined)
      return
    this.pending.delete(taskKey(projectId, taskId))
    pending.reject(new TaskStateError('Owner takeover was cancelled'))
  }

  pendingTakeover(
    projectId: string,
    taskId: string,
  ): PendingOwnerTakeover | undefined {
    const pending = this.pending.get(taskKey(projectId, taskId))
    if (pending === undefined)
      return undefined
    return {
      pageUrl: pending.pageUrl,
      projectId: pending.projectId,
      requestedAt: pending.requestedAt,
      taskId: pending.taskId,
    }
  }

  listPending(): PendingOwnerTakeover[] {
    return [...this.pending.values()].map(pending => ({
      pageUrl: pending.pageUrl,
      projectId: pending.projectId,
      requestedAt: pending.requestedAt,
      taskId: pending.taskId,
    }))
  }

  private requirePending(
    projectId: string,
    taskId: string,
  ): PendingTakeoverEntry {
    const pending = this.pending.get(taskKey(projectId, taskId))
    if (pending === undefined)
      throw new TaskStateError(`No owner takeover is pending for task ${taskId}`)
    return pending
  }
}

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}
