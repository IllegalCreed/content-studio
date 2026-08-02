// @env node

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
    first.close()

    const second = new SqliteExecutionTaskStore(databasePath)
    expect(second.getTask('project-a', 'task-a')).toMatchObject({
      attempt: 1,
      status: 'generating',
    })
    expect(second.listEvents('project-a', 'task-a').map(event => event.kind))
      .toEqual(['task-created', 'status-changed'])
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
