// @env node

/**
 * A deliberately small local worker for long-running production attempts.
 *
 * The worker owns scheduling only. It does not know how to generate content,
 * launch a browser, or publish to a channel. Callers provide one reviewed
 * execution function and keep task state/receipts in the application service.
 */

export interface ProductionWorkerJob {
  baseUrl: string
  outputDirectory: string
  projectId: string
  projectOrigin: string
  taskId: string
}

export interface ProductionWorkerRunInput extends ProductionWorkerJob {
  signal: AbortSignal
}

export interface ProductionWorkerOptions {
  onError?: (error: unknown, job: ProductionWorkerJob) => void
  run: (input: ProductionWorkerRunInput) => Promise<unknown>
}

export interface ProductionWorkerSnapshot {
  queued: number
  running: number
  started: boolean
  stopped: boolean
}

interface RunningJob {
  controller: AbortController
  job: ProductionWorkerJob
}

export class ProductionWorker {
  private readonly queue: ProductionWorkerJob[] = []

  private readonly queuedKeys = new Set<string>()

  private readonly running = new Map<string, RunningJob>()

  private readonly idleWaiters: Array<() => void> = []

  private scheduled = false

  private started = false

  private stopped = false

  constructor(private readonly options: ProductionWorkerOptions) {}

  start(): void {
    if (this.stopped || this.started)
      return
    this.started = true
    this.schedule()
  }

  enqueue(job: ProductionWorkerJob): boolean {
    if (this.stopped)
      return false
    const key = jobKey(job)
    const running = this.running.get(key)
    if (this.queuedKeys.has(key) || (running !== undefined && !running.controller.signal.aborted))
      return false
    this.queuedKeys.add(key)
    this.queue.push({ ...job })
    this.schedule()
    return true
  }

  cancel(projectId: string, taskId: string): boolean {
    const key = `${projectId}:${taskId}`
    const queuedIndex = this.queue.findIndex(job => jobKey(job) === key)
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1)
      this.queuedKeys.delete(key)
      this.notifyIdleIfNeeded()
      return true
    }
    const running = this.running.get(key)
    if (running === undefined)
      return false
    running.controller.abort()
    return true
  }

  has(projectId: string, taskId: string): boolean {
    const key = `${projectId}:${taskId}`
    return this.queuedKeys.has(key) || this.running.has(key)
  }

  snapshot(): ProductionWorkerSnapshot {
    return {
      queued: this.queue.length,
      running: this.running.size,
      started: this.started,
      stopped: this.stopped,
    }
  }

  async waitForIdle(): Promise<void> {
    if (this.queue.length === 0 && this.running.size === 0)
      return
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  async stop(): Promise<void> {
    if (this.stopped)
      return
    this.stopped = true
    this.queue.length = 0
    this.queuedKeys.clear()
    for (const running of this.running.values())
      running.controller.abort()
    await this.waitForIdle()
  }

  private schedule(): void {
    if (!this.started || this.stopped || this.scheduled || this.running.size > 0 || this.queue.length === 0)
      return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.runNext()
    })
  }

  private async runNext(): Promise<void> {
    if (!this.started || this.stopped || this.running.size > 0)
      return
    const job = this.queue.shift()
    if (job === undefined) {
      this.notifyIdleIfNeeded()
      return
    }

    const key = jobKey(job)
    this.queuedKeys.delete(key)
    const controller = new AbortController()
    this.running.set(key, { controller, job })
    try {
      await this.options.run({ ...job, signal: controller.signal })
    }
    catch (error: unknown) {
      // Cancellation is represented by the task/recording state. It is not a
      // worker fault and must not be reported as an unhandled rejection.
      if (!controller.signal.aborted)
        this.options.onError?.(error, job)
    }
    finally {
      this.running.delete(key)
      this.notifyIdleIfNeeded()
      this.schedule()
    }
  }

  private notifyIdleIfNeeded(): void {
    if (this.queue.length !== 0 || this.running.size !== 0)
      return
    const waiters = this.idleWaiters.splice(0)
    waiters.forEach(resolve => resolve())
  }
}

function jobKey(job: ProductionWorkerJob): string {
  return `${job.projectId}:${job.taskId}`
}
