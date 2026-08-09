import type {
  CompositionAttemptReceipt,
  CompositionTaskEventInput,
  CreateExecutionTaskInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskEventKind,
  ExecutionTaskSkipStage,
  ExecutionTaskStatus,
  ExecutionTaskStore,
  ExecutionTaskStoreState,
  ExecutionTaskTransitionOptions,
  RecorderAttemptReceipt,
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
  private readonly compositionReceipts = new Map<string, CompositionAttemptReceipt[]>()

  private readonly events = new Map<string, ExecutionTaskEvent[]>()

  private readonly recordingReceipts = new Map<string, RecorderAttemptReceipt[]>()

  private readonly tasks = new Map<string, ExecutionTask>()

  exportState(): ExecutionTaskStoreState {
    return {
      compositionReceipts: [...this.compositionReceipts.values()]
        .flatMap(receipts => receipts)
        .map(clone),
      events: [...this.events.values()].flatMap(events => events).map(clone),
      recordingReceipts: [...this.recordingReceipts.values()]
        .flatMap(receipts => receipts)
        .map(clone),
      tasks: this.listTasks(),
    }
  }

  restoreState(state: ExecutionTaskStoreState): void {
    this.compositionReceipts.clear()
    this.events.clear()
    this.recordingReceipts.clear()
    this.tasks.clear()
    for (const task of state.tasks) {
      const restored = normalizeTask(task)
      this.tasks.set(taskKey(restored.projectId, restored.taskId), restored)
    }
    for (const event of state.events) {
      const key = taskKey(event.projectId, event.taskId)
      this.events.set(key, [
        ...(this.events.get(key) ?? []),
        clone(event),
      ])
    }
    for (const receipt of state.compositionReceipts ?? []) {
      const key = taskKey(receipt.projectId, receipt.jobId)
      this.compositionReceipts.set(key, [
        ...(this.compositionReceipts.get(key) ?? []),
        clone(receipt),
      ])
    }
    for (const receipt of state.recordingReceipts ?? []) {
      const key = taskKey(receipt.projectId, receipt.jobId)
      this.recordingReceipts.set(key, [
        ...(this.recordingReceipts.get(key) ?? []),
        clone(receipt),
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

    const createdAt = new Date().toISOString()
    const task: ExecutionTask = {
      activityId: input.activityId,
      attempt: 1,
      createdAt,
      ...(input.channel === undefined ? {} : { channel: input.channel }),
      ...(input.contentId === undefined ? {} : { contentId: input.contentId }),
      kind: input.kind,
      ...(input.productionType === undefined
        ? {}
        : { productionType: input.productionType }),
      projectId: input.projectId,
      skipStages,
      status: 'queued',
      taskId: input.taskId,
      updatedAt: createdAt,
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

  listCompositionReceipts(
    projectId: string,
    taskId: string,
  ): CompositionAttemptReceipt[] {
    this.requireTask(projectId, taskId)
    return clone(this.compositionReceipts.get(taskKey(projectId, taskId)) ?? [])
  }

  listRecordingReceipts(
    projectId: string,
    taskId: string,
  ): RecorderAttemptReceipt[] {
    this.requireTask(projectId, taskId)
    return clone(this.recordingReceipts.get(taskKey(projectId, taskId)) ?? [])
  }

  saveCompositionReceipt(
    projectId: string,
    taskId: string,
    receipt: CompositionAttemptReceipt,
  ): CompositionAttemptReceipt {
    const task = this.requireTask(projectId, taskId)
    if (task.kind !== 'production' || task.productionType !== 'video') {
      throw new TaskStateError('Only video production tasks can save composition receipts')
    }
    if (receipt.projectId !== projectId || receipt.jobId !== taskId) {
      throw new TaskStateError(
        'Composition receipt must match the project and task that produced it',
      )
    }
    if (!Number.isInteger(receipt.attempt) || receipt.attempt < 1) {
      throw new TaskStateError('Composition receipt attempt must be a positive integer')
    }
    if (receipt.outcome === 'succeeded') {
      if (receipt.failure !== undefined || receipt.artifacts.length === 0) {
        throw new TaskStateError(
          'Succeeded composition receipts require artifacts and no failure',
        )
      }
      for (const artifact of receipt.artifacts) {
        if (artifact.relativePath === undefined || !isSafeRelativePath(artifact.relativePath)) {
          throw new TaskStateError('Composition artifact paths must be safe relative paths')
        }
      }
    }
    else if (receipt.failure === undefined || receipt.artifacts.length > 0) {
      throw new TaskStateError(
        'Cancelled or failed composition receipts require a failure and no artifacts',
      )
    }
    const key = taskKey(projectId, taskId)
    const receipts = this.compositionReceipts.get(key) ?? []
    if (receipts.some(candidate => candidate.attempt === receipt.attempt)) {
      throw new TaskStateError(
        `Composition receipt attempt ${receipt.attempt} already exists for task ${taskId}`,
      )
    }
    this.compositionReceipts.set(key, [...receipts, clone(receipt)])
    return clone(receipt)
  }

  appendCompositionEvent(
    projectId: string,
    taskId: string,
    input: CompositionTaskEventInput,
  ): ExecutionTaskEvent {
    const task = this.requireTask(projectId, taskId)
    if (task.kind !== 'production' || task.productionType !== 'video') {
      throw new TaskStateError('Only video production tasks can append composition events')
    }
    const expectedStatus = input.kind === 'composition-started'
      || input.kind === 'composition-video-ready'
      || input.kind === 'composition-cover-ready'
      || input.kind === 'composition-gif-ready'
      ? 'composing'
      : input.kind === 'composition-completed'
        ? 'completed'
        : input.kind === 'composition-failed'
          ? 'failed'
          : 'cancelled'
    if (task.status !== expectedStatus) {
      throw new TaskStateError(
        `Composition event ${input.kind} requires task status ${expectedStatus}`,
      )
    }
    return this.appendEvent(task, {
      artifact: input.artifact,
      attempt: task.attempt,
      kind: input.kind,
      message: input.message,
      projectId,
      stage: 'composing',
      status: task.status,
      taskId,
    })
  }

  saveRecordingReceipt(
    projectId: string,
    taskId: string,
    receipt: RecorderAttemptReceipt,
  ): RecorderAttemptReceipt {
    const task = this.requireTask(projectId, taskId)
    if (task.kind !== 'production')
      throw new TaskStateError('Only production tasks can save recording receipts')
    if (receipt.projectId !== projectId || receipt.jobId !== taskId) {
      throw new TaskStateError(
        'Recording receipt must match the project and task that produced it',
      )
    }
    const key = taskKey(projectId, taskId)
    const receipts = this.recordingReceipts.get(key) ?? []
    if (receipts.some(candidate => candidate.attempt === receipt.attempt)) {
      throw new TaskStateError(
        `Recording receipt attempt ${receipt.attempt} already exists for task ${taskId}`,
      )
    }
    this.recordingReceipts.set(key, [...receipts, clone(receipt)])
    return clone(receipt)
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
    const isPublicationReceipt = task.kind === 'publication'
      && (nextStatus === 'failed' || nextStatus === 'published')
      && options.hasMatchingPublicationReceipt === true
    const isOwnerHandoff = task.kind === 'publication'
      && task.status === 'queued'
      && nextStatus === 'awaiting-owner'
      && options.hasMatchingOwnerHandoff === true
    const isMonitoringStart = task.kind === 'monitoring'
      && task.status === 'queued'
      && nextStatus === 'monitoring'
    if (!allowedStatuses.includes(nextStatus) && !isPublicationReceipt && !isOwnerHandoff && !isMonitoringStart) {
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
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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

function normalizeTask(task: ExecutionTask): ExecutionTask {
  if (task.createdAt !== undefined && task.updatedAt !== undefined)
    return clone(task)
  const restoredAt = new Date().toISOString()
  return {
    ...clone(task),
    createdAt: task.createdAt ?? restoredAt,
    updatedAt: task.updatedAt ?? task.createdAt ?? restoredAt,
  }
}

function isSkippableStage(stage: ExecutionTaskSkipStage): boolean {
  return stage === 'generating' || stage === 'recording'
}

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}:${taskId}`
}

function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return normalized.trim() !== ''
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:\//u.test(normalized)
    && !normalized.split('/').includes('..')
}
