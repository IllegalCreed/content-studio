// @env node

import type { ProductionWorkerJob } from './worker'
import { describe, expect, it, vi } from 'vitest'
import { ProductionWorker } from './worker'

function job(taskId: string): ProductionWorkerJob {
  return {
    baseUrl: 'https://project.example.com',
    outputDirectory: `/tmp/content-studio/${taskId}`,
    projectId: 'project-a',
    projectOrigin: 'https://project.example.com',
    taskId,
  }
}

describe('production worker', () => {
  it('runs queued jobs one at a time and ignores duplicate enqueues', async () => {
    const order: string[] = []
    let active = 0
    let maxActive = 0
    const worker = new ProductionWorker({
      run: async (input) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        order.push(`start:${input.taskId}`)
        await Promise.resolve()
        order.push(`finish:${input.taskId}`)
        active -= 1
      },
    })

    expect(worker.enqueue(job('task-a'))).toBe(true)
    expect(worker.enqueue(job('task-a'))).toBe(false)
    expect(worker.enqueue(job('task-b'))).toBe(true)
    expect(worker.has('project-a', 'task-a')).toBe(true)
    expect(worker.snapshot()).toMatchObject({ queued: 2, running: 0, started: false })

    worker.start()
    await worker.waitForIdle()

    expect(order).toEqual([
      'start:task-a',
      'finish:task-a',
      'start:task-b',
      'finish:task-b',
    ])
    expect(maxActive).toBe(1)
    expect(worker.snapshot()).toMatchObject({ queued: 0, running: 0, started: true })
    expect(worker.has('project-a', 'task-a')).toBe(false)
  })

  it('aborts a running job and reports failures without rejecting the worker loop', async () => {
    let started: ((value: void) => void) | undefined
    let observedSignal: AbortSignal | undefined
    const onError = vi.fn()
    const worker = new ProductionWorker({
      onError,
      run: async (input) => {
        observedSignal = input.signal
        await new Promise<void>((resolve) => {
          started = resolve
        })
        if (input.signal.aborted)
          throw new Error('cancelled by owner')
      },
    })
    worker.start()
    expect(worker.enqueue(job('task-a'))).toBe(true)

    await vi.waitFor(() => expect(started).toBeTypeOf('function'))
    expect(worker.cancel('project-a', 'task-a')).toBe(true)
    expect(observedSignal?.aborted).toBe(true)
    started?.()
    await worker.waitForIdle()

    expect(onError).not.toHaveBeenCalled()
    expect(worker.cancel('project-a', 'missing-task')).toBe(false)
  })

  it('queues a retry behind a running attempt that has already been cancelled', async () => {
    let releaseFirst: (() => void) | undefined
    let runCount = 0
    const worker = new ProductionWorker({
      run: async (input) => {
        runCount += 1
        if (runCount === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
          return
        }
        expect(input.taskId).toBe('task-a')
      },
    })
    worker.start()
    worker.enqueue(job('task-a'))
    await vi.waitFor(() => expect(runCount).toBe(1))

    expect(worker.cancel('project-a', 'task-a')).toBe(true)
    expect(worker.enqueue(job('task-a'))).toBe(true)
    releaseFirst?.()
    await worker.waitForIdle()
    expect(runCount).toBe(2)
  })

  it('stops queued work and does not accept new jobs', async () => {
    const run = vi.fn(async () => {})
    const worker = new ProductionWorker({ run })
    worker.enqueue(job('task-a'))
    await worker.stop()

    expect(run).not.toHaveBeenCalled()
    expect(worker.enqueue(job('task-b'))).toBe(false)
    expect(worker.snapshot()).toMatchObject({ queued: 0, running: 0, stopped: true })
  })
})
