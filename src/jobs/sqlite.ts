// @env node

import type {
  CreateExecutionTaskInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskSkipStage,
  ExecutionTaskStatus,
  ExecutionTaskStore,
  ExecutionTaskStoreState,
  ExecutionTaskTransitionOptions,
  RecorderAttemptReceipt,
} from '../types'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { InMemoryExecutionTaskStore } from './task'

interface PersistedTaskRow {
  payload: string
}

interface PersistedTaskEventRow {
  payload: string
}

interface PersistedRecordingReceiptRow {
  payload: string
}

export class SqliteExecutionTaskStore implements ExecutionTaskStore {
  readonly databasePath: string

  private readonly database: DatabaseSync

  private readonly memory = new InMemoryExecutionTaskStore()

  private isClosed = false

  constructor(databasePath: string) {
    if (databasePath !== ':memory:')
      mkdirSync(dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS content_studio_tasks (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS content_studio_task_events (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS content_studio_task_recording_receipts (
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id, attempt)
      );
    `)
    this.loadState()
  }

  createTask(input: CreateExecutionTaskInput): ExecutionTask {
    const task = this.memory.createTask(input)
    this.persistState()
    return task
  }

  getTask(projectId: string, taskId: string): ExecutionTask | undefined {
    return this.memory.getTask(projectId, taskId)
  }

  listTasks(projectId?: string): ExecutionTask[] {
    return this.memory.listTasks(projectId)
  }

  listEvents(projectId: string, taskId: string): ExecutionTaskEvent[] {
    return this.memory.listEvents(projectId, taskId)
  }

  listRecordingReceipts(
    projectId: string,
    taskId: string,
  ): RecorderAttemptReceipt[] {
    return this.memory.listRecordingReceipts(projectId, taskId)
  }

  saveRecordingReceipt(
    projectId: string,
    taskId: string,
    receipt: RecorderAttemptReceipt,
  ): RecorderAttemptReceipt {
    const saved = this.memory.saveRecordingReceipt(projectId, taskId, receipt)
    this.persistState()
    return saved
  }

  transitionTask(
    projectId: string,
    taskId: string,
    nextStatus: ExecutionTaskStatus,
    options: ExecutionTaskTransitionOptions = {},
  ): ExecutionTask {
    const task = this.memory.transitionTask(projectId, taskId, nextStatus, options)
    this.persistState()
    return task
  }

  skipStage(
    projectId: string,
    taskId: string,
    stage: ExecutionTaskSkipStage,
  ): ExecutionTask {
    const task = this.memory.skipStage(projectId, taskId, stage)
    this.persistState()
    return task
  }

  cancelTask(projectId: string, taskId: string): ExecutionTask {
    const task = this.memory.cancelTask(projectId, taskId)
    this.persistState()
    return task
  }

  retryTask(projectId: string, taskId: string): ExecutionTask {
    const task = this.memory.retryTask(projectId, taskId)
    this.persistState()
    return task
  }

  close(): void {
    if (this.isClosed)
      return
    this.database.close()
    this.isClosed = true
  }

  private loadState(): void {
    const tasks = this.database
      .prepare('SELECT payload FROM content_studio_tasks ORDER BY project_id, task_id')
      .all() as unknown as PersistedTaskRow[]
    const events = this.database
      .prepare('SELECT payload FROM content_studio_task_events ORDER BY project_id, task_id, sequence')
      .all() as unknown as PersistedTaskEventRow[]
    const recordingReceipts = this.database
      .prepare('SELECT payload FROM content_studio_task_recording_receipts ORDER BY project_id, task_id, attempt')
      .all() as unknown as PersistedRecordingReceiptRow[]
    this.memory.restoreState({
      events: events.map(row => JSON.parse(row.payload) as ExecutionTaskEvent),
      recordingReceipts: recordingReceipts.map(row => JSON.parse(row.payload) as RecorderAttemptReceipt),
      tasks: tasks.map(row => JSON.parse(row.payload) as ExecutionTask),
    })
  }

  private persistState(): void {
    this.assertOpen()
    const state: ExecutionTaskStoreState = this.memory.exportState()
    this.database.exec('BEGIN')
    try {
      this.database.exec('DELETE FROM content_studio_tasks; DELETE FROM content_studio_task_events; DELETE FROM content_studio_task_recording_receipts;')
      const taskStatement = this.database.prepare(`
        INSERT INTO content_studio_tasks (project_id, task_id, payload)
        VALUES (?, ?, ?)
      `)
      for (const task of state.tasks)
        taskStatement.run(task.projectId, task.taskId, JSON.stringify(task))
      const eventStatement = this.database.prepare(`
        INSERT INTO content_studio_task_events
          (project_id, task_id, sequence, payload)
        VALUES (?, ?, ?, ?)
      `)
      for (const event of state.events)
        eventStatement.run(event.projectId, event.taskId, event.sequence, JSON.stringify(event))
      const receiptStatement = this.database.prepare(`
        INSERT INTO content_studio_task_recording_receipts
          (project_id, task_id, attempt, payload)
        VALUES (?, ?, ?, ?)
      `)
      for (const receipt of state.recordingReceipts)
        receiptStatement.run(receipt.projectId, receipt.jobId, receipt.attempt, JSON.stringify(receipt))
      this.database.exec('COMMIT')
    }
    catch (error: unknown) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private assertOpen(): void {
    if (this.isClosed)
      throw new Error('Task store is closed')
  }
}
