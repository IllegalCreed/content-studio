// @env node

import type {
  CompositionAttemptReceipt,
  RecorderAttemptReceipt,
} from '../types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteExecutionTaskStore } from './sqlite'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { force: true, recursive: true }),
  ))
})

describe('sqlite execution task store', () => {
  it('restores tasks and append-only events after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-task-store-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'tasks.sqlite')
    const first = new SqliteExecutionTaskStore(databasePath)

    first.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'task-a',
    })
    first.transitionTask('project-a', 'task-a', 'generating')
    const persistedTask = first.getTask('project-a', 'task-a')
    first.close()

    const second = new SqliteExecutionTaskStore(databasePath)
    expect(second.getTask('project-a', 'task-a')).toMatchObject({
      attempt: 1,
      createdAt: persistedTask?.createdAt,
      status: 'generating',
      updatedAt: persistedTask?.updatedAt,
    })
    expect(second.listEvents('project-a', 'task-a').map(event => event.kind))
      .toEqual(['task-created', 'status-changed'])
    second.close()
  })

  it('restores recording receipts and their artifact metadata after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-task-store-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'tasks.sqlite')
    const first = new SqliteExecutionTaskStore(databasePath)
    first.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'task-a',
    })
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/narrow/output/attempt-1',
      artifacts: [{
        id: 'preview-1',
        kind: 'preview-frame',
        relativePath: 'previews/preview-1.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
      }],
      attempt: 1,
      campaignId: 'activity-a',
      completedActions: 2,
      completedScenes: 1,
      jobId: 'task-a',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: ['preview-ready'],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'b'.repeat(64),
      projectId: 'project-a',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 1920, width: 1080 },
        viewport: { height: 1920, width: 1080 },
      },
      receiptVersion: 1,
      totalActions: 2,
      totalScenes: 1,
    }
    first.saveRecordingReceipt('project-a', 'task-a', receipt)
    first.close()

    const second = new SqliteExecutionTaskStore(databasePath)
    expect(second.listRecordingReceipts('project-a', 'task-a')).toEqual([receipt])
    second.close()
  })

  it('restores composition receipts and progress events after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-task-store-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'tasks.sqlite')
    const first = new SqliteExecutionTaskStore(databasePath)
    first.createTask({
      activityId: 'activity-a',
      kind: 'production',
      productionType: 'video',
      projectId: 'project-a',
      taskId: 'task-a',
    })
    first.transitionTask('project-a', 'task-a', 'generating')
    first.transitionTask('project-a', 'task-a', 'recording')
    first.transitionTask('project-a', 'task-a', 'composing')
    first.appendCompositionEvent('project-a', 'task-a', {
      kind: 'composition-started',
      message: 'Composition started',
    })
    const receipt: CompositionAttemptReceipt = {
      artifacts: [],
      attempt: 1,
      failure: {
        code: 'cancelled',
        message: 'Composition cancelled',
        retryable: true,
      },
      jobId: 'task-a',
      outcome: 'cancelled',
      projectId: 'project-a',
      receiptVersion: 1,
    }
    first.saveCompositionReceipt('project-a', 'task-a', receipt)
    first.close()

    const second = new SqliteExecutionTaskStore(databasePath)
    expect(second.listCompositionReceipts('project-a', 'task-a'))
      .toEqual([receipt])
    expect(second.listEvents('project-a', 'task-a').at(-1)).toMatchObject({
      kind: 'composition-started',
      message: 'Composition started',
    })
    second.close()
  })

  it('persists skip, cancel and retry operations and guards a closed store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'content-studio-task-store-'))
    temporaryDirectories.push(directory)
    const store = new SqliteExecutionTaskStore(join(directory, 'tasks.sqlite'))

    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      skipStages: ['generating', 'recording'],
      taskId: 'task-a',
    })
    expect(store.listTasks()).toHaveLength(1)
    expect(store.listTasks('project-a')).toHaveLength(1)
    expect(store.skipStage('project-a', 'task-a', 'generating').status).toBe('recording')
    expect(store.cancelTask('project-a', 'task-a').status).toBe('cancelled')
    expect(store.retryTask('project-a', 'task-a').attempt).toBe(2)
    store.close()
    store.close()

    expect(() => store.createTask({
      activityId: 'activity-b',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'task-b',
    })).toThrow('Task store is closed')
  })
})
