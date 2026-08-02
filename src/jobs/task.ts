import type {
  CreateExecutionTaskInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskEventKind,
  ExecutionTaskSkipStage,
  ExecutionTaskStatus,
  ExecutionTaskStore,
  ExecutionTaskStoreState,
  ExecutionTaskTransitionOptions,
} from '../types'
import { CAMPAIGN_JOB_TRANSITIONS } from '../constants'

export class TaskScopeError extends Error {
  constructor(projectId: string, taskId: string) {
    super(`Task ${taskId} is not available in project ${projectId}`)
    this.name = 'TaskScopeError'
  }
}

export class TaskNotFoundError extends Error {
  constructor(projectId: string, taskId: string) {
    super(`Task ${taskId} was not found in project ${projectId}`)
    this.name = 'TaskNotFoundError'
  }
}

export class TaskConflictError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} already exists`)
    this.name = 'TaskConflictError'
  }
}

export class TaskStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskStateError'
  }
}

export class InMemoryExecutionTaskStore implements ExecutionTaskStore {
  private readonly events = new Map<string, ExecutionTaskEvent[]>()

  private readonly tasks = new Map<string, ExecutionTask>()

  exportState(): ExecutionTaskStoreState {
    return {
      events: [...this.events.values()].flatMap(events => events).map(clone),
      tasks: this.listTasks(),
    }
  }

  restoreState(state: ExecutionTaskStoreState): void {
    this.events.clear()
    this.tasks.clear()
    for (const task of state.tasks)
      this.tasks.set(taskKey(task.projectId, task.taskId), clone(task))
    for (const event of state.events) {
      const key = taskKey(event.projectId, event.taskId)
      this.events.set(key, [
        ...(this.events.get(key) ?? []),
        clone(event),
      ])
    }
  }

  createTask(input: CreateExecutionTaskInput): ExecutionTask {
    const key = taskKey(input.projectId, input.taskId)
    if (this.tasks.has(key))
      throw new TaskConflictError(input.taskId)

    const skipStages = [...new Set(input.skipStages ?? [])]
    if (skipStages.some(stage => !isSkippableStage(stage))) {
      throw new TaskStateError('Only generating and recording can be skipped')
    }

    const task: ExecutionTask = {
      activityId: input.activityId,
      attempt: 1,
      kind: input.kind,
      projectId: input.projectId,
      skipStages,
      status: 'queued',
      taskId: input.taskId,
    }
    this.tasks.set(key, clone(task))
    this.appendEvent(task, {
      attempt: task.attempt,
      kind: 'task-created',
      message: 'Task created',
      projectId: task.projectId,
      status: task.status,
      taskId: task.taskId,
    })
    return clone(task)
  }

  getTask(projectId: string, taskId: string): ExecutionTask | undefined {
    const task = this.tasks.get(taskKey(projectId, taskId))
    if (task)
      return clone(task)

    if (this.findTaskInOtherProject(projectId, taskId))
      throw new TaskScopeError(projectId, taskId)
    return undefined
  }

  listTasks(projectId?: string): ExecutionTask[] {
    return [...this.tasks.values()]
      .filter(task => projectId === undefined || task.projectId === projectId)
      .map(task => clone(task))
  }

  listEvents(projectId: string, taskId: string): ExecutionTaskEvent[] {
    this.requireTask(projectId, taskId)
    return clone(this.events.get(taskKey(projectId, taskId)) ?? [])
  }

  transitionTask(
    projectId: string,
    taskId: string,
    nextStatus: ExecutionTaskStatus,
    options: ExecutionTaskTransitionOptions = {},
  ): ExecutionTask {
    const task = this.requireTask(projectId, taskId)
    if (nextStatus === 'queued') {
      throw new TaskStateError(
        'Queued is only available through retryTask so the attempt is preserved',
      )
    }
    if (nextStatus === 'published'
      && options.hasMatchingPublicationReceipt !== true) {
      throw new TaskStateError(
        'Task requires a matching publication receipt before published',
      )
    }
    const allowedStatuses: readonly ExecutionTaskStatus[]
      = CAMPAIGN_JOB_TRANSITIONS[task.status]
    if (!allowedStatuses.includes(nextStatus)) {
      throw new TaskStateError(
        `Task cannot transition from ${task.status} to ${nextStatus}`,
      )
    }

    return this.updateStatus(task, nextStatus, 'status-changed', `Task changed from ${task.status} to ${nextStatus}`)
  }

  skipStage(
    projectId: string,
    taskId: string,
    stage: ExecutionTaskSkipStage,
  ): ExecutionTask {
    const task = this.requireTask(projectId, taskId)
    if (!task.skipStages.includes(stage)) {
      throw new TaskStateError(
        `Task is not configured to skip ${stage}`,
      )
    }

    const expectedStatus = stage === 'generating' ? 'queued' : 'generating'
    const nextStatus = stage === 'generating' ? 'recording' : 'composing'
    if (task.status !== expectedStatus) {
      throw new TaskStateError(
        `Task can skip ${stage} only from ${expectedStatus}`,
      )
    }
    const updatedTask = {
      ...task,
      status: nextStatus,
    } satisfies ExecutionTask
    this.tasks.set(taskKey(projectId, taskId), updatedTask)
    this.appendEvent(updatedTask, {
      attempt: updatedTask.attempt,
      fromStatus: task.status,
      kind: 'stage-skipped',
      message: `Task skipped ${stage}`,
      projectId,
      stage,
      status: updatedTask.status,
      taskId,
      toStatus: updatedTask.status,
    })
    return clone(updatedTask)
  }

  cancelTask(projectId: string, taskId: string): ExecutionTask {
    const task = this.requireTask(projectId, taskId)
    const allowedStatuses: readonly ExecutionTaskStatus[]
      = CAMPAIGN_JOB_TRANSITIONS[task.status]
    if (!allowedStatuses.includes('cancelled')) {
      throw new TaskStateError(
        `Task cannot transition from ${task.status} to cancelled`,
      )
    }

    return this.updateStatus(task, 'cancelled', 'attempt-cancelled', `Attempt ${task.attempt} cancelled`)
  }

  retryTask(projectId: string, taskId: string): ExecutionTask {
    const task = this.requireTask(projectId, taskId)
    if (task.status !== 'cancelled' && task.status !== 'failed') {
      throw new TaskStateError(
        `Task can only retry from cancelled or failed, not ${task.status}`,
      )
    }

    const retriedTask = {
      ...task,
      attempt: task.attempt + 1,
      status: 'queued',
    } satisfies ExecutionTask
    this.tasks.set(taskKey(projectId, taskId), retriedTask)
    this.appendEvent(retriedTask, {
      attempt: retriedTask.attempt,
      fromStatus: task.status,
      kind: 'attempt-retried',
      message: `Retry created as attempt ${retriedTask.attempt}`,
      previousAttempt: task.attempt,
      projectId,
      status: retriedTask.status,
      taskId,
      toStatus: retriedTask.status,
    })
    return clone(retriedTask)
  }

  private appendEvent(
    task: ExecutionTask,
    input: Omit<ExecutionTaskEvent, 'eventId' | 'schemaVersion' | 'sequence'>,
  ): ExecutionTaskEvent {
    const key = taskKey(task.projectId, task.taskId)
    const taskEvents = this.events.get(key) ?? []
    const event: ExecutionTaskEvent = {
      ...input,
      eventId: `${task.taskId}:${taskEvents.length + 1}`,
      schemaVersion: 1,
      sequence: taskEvents.length + 1,
    }
    this.events.set(key, [...taskEvents, clone(event)])
    return clone(event)
  }

  private findTaskInOtherProject(projectId: string, taskId: string): boolean {
    return [...this.tasks.values()].some(task =>
      task.taskId === taskId && task.projectId !== projectId)
  }

  private requireTask(projectId: string, taskId: string): ExecutionTask {
    const task = this.getTask(projectId, taskId)
    if (!task)
      throw new TaskNotFoundError(projectId, taskId)
    return task
  }

  private updateStatus(
    task: ExecutionTask,
    status: ExecutionTaskStatus,
    eventKind: ExecutionTaskEventKind,
    message: string,
  ): ExecutionTask {
    const updatedTask = {
      ...task,
      status,
    } satisfies ExecutionTask
    this.tasks.set(taskKey(task.projectId, task.taskId), updatedTask)
    this.appendEvent(updatedTask, {
      attempt: updatedTask.attempt,
      fromStatus: task.status,
      kind: eventKind,
      message,
      projectId: task.projectId,
      status: updatedTask.status,
      taskId: task.taskId,
      toStatus: updatedTask.status,
    })
    return clone(updatedTask)
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isSkippableStage(stage: ExecutionTaskSkipStage): boolean {
  return stage === 'generating' || stage === 'recording'
}

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}
