import { describe, expect, it } from 'vitest'
import { OwnerTakeoverRegistry } from './owner-takeover'
import { InMemoryExecutionTaskStore } from './task'

function createRecordingTask(
  store: InMemoryExecutionTaskStore,
  taskId = 'video-task',
): void {
  store.createTask({
    activityId: 'activity-a',
    kind: 'production',
    projectId: 'project-a',
    taskId,
  })
  store.transitionTask('project-a', taskId, 'generating')
  store.transitionTask('project-a', taskId, 'recording')
}

describe('owner takeover registry', () => {
  it('pauses a recording task into awaiting-owner and resumes on confirmation', async () => {
    const store = new InMemoryExecutionTaskStore()
    createRecordingTask(store)
    const registry = new OwnerTakeoverRegistry(store)

    const request = registry.request({
      jobId: 'video-task',
      pageUrl: 'https://project-a.example.com/login',
      projectId: 'project-a',
    })

    expect(store.getTask('project-a', 'video-task')?.status)
      .toBe('awaiting-owner')
    expect(registry.listPending()).toEqual([
      expect.objectContaining({
        pageUrl: 'https://project-a.example.com/login',
        projectId: 'project-a',
        taskId: 'video-task',
      }),
    ])

    const pendingBefore = registry.pendingTakeover('project-a', 'video-task')
    const record = registry.confirm('project-a', 'video-task')
    await expect(request).resolves.toEqual(record)
    expect(store.getTask('project-a', 'video-task')?.status).toBe('recording')
    expect(record.requestedAt).toBe(pendingBefore?.requestedAt)
    expect(record.confirmedAt).toEqual(expect.any(String))
    expect(registry.listPending()).toHaveLength(0)
  })

  it('rejects a takeover when the task is not currently recording', async () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'queued-task',
    })
    const registry = new OwnerTakeoverRegistry(store)

    await expect(registry.request({
      jobId: 'queued-task',
      pageUrl: 'https://project-a.example.com/login',
      projectId: 'project-a',
    })).rejects.toThrow(/recording production task/i)
  })

  it('fails closed when confirming a task with no pending takeover', () => {
    const store = new InMemoryExecutionTaskStore()
    createRecordingTask(store)
    const registry = new OwnerTakeoverRegistry(store)

    expect(() => registry.confirm('project-a', 'video-task'))
      .toThrow(/no owner takeover is pending/i)
  })

  it('rejects a pending takeover when the task is cancelled', async () => {
    const store = new InMemoryExecutionTaskStore()
    createRecordingTask(store)
    const registry = new OwnerTakeoverRegistry(store)

    const request = registry.request({
      jobId: 'video-task',
      pageUrl: 'https://project-a.example.com/login',
      projectId: 'project-a',
    })
    registry.dismiss('project-a', 'video-task')

    await expect(request).rejects.toThrow(/cancelled/i)
    expect(registry.listPending()).toHaveLength(0)
    store.cancelTask('project-a', 'video-task')
    expect(store.getTask('project-a', 'video-task')?.status).toBe('cancelled')
  })
})
