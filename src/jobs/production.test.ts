import type {
  RecorderAttemptReceipt,
  RecordingJobInput,
  RecordingJobResult,
  VideoPlan,
} from '../types'
import { describe, expect, it } from 'vitest'
import { runProductionTask } from './production'
import { InMemoryExecutionTaskStore } from './task'

const projectId = 'algorithm-visualizer'
const taskId = 'production-demo'

const plan: VideoPlan = {
  campaignId: 'demo-campaign',
  durationMs: 100,
  format: 'landscape',
  scenes: [],
  viewport: {
    height: 1080,
    width: 1920,
  },
}

function createReceipt(
  outcome: RecorderAttemptReceipt['outcome'],
): RecordingJobResult {
  return {
    attempts: [],
    receipt: {
      artifactDirectory: '/tmp/content-studio-test/attempt-1',
      artifacts: [],
      attempt: 1,
      campaignId: plan.campaignId,
      completedActions: outcome === 'succeeded' ? 0 : 0,
      completedScenes: 0,
      ...(outcome === 'failed'
        ? {
            failure: {
              code: 'runtime-error' as const,
              message: 'test failure',
              retryable: false,
            },
          }
        : {}),
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome,
      planSha256: 'plan-sha',
      projectId,
      receiptVersion: 1,
      totalActions: 0,
      totalScenes: 0,
    },
  }
}

function createStore() {
  const store = new InMemoryExecutionTaskStore()
  store.createTask({
    activityId: 'activity-demo',
    kind: 'production',
    projectId,
    taskId,
  })
  store.transitionTask(projectId, taskId, 'generating')
  return store
}

function createInput(overrides: Partial<Parameters<typeof runProductionTask>[1]> = {}) {
  return {
    baseUrl: 'https://example.com/',
    maxAttempts: 1,
    outputDirectory: '/tmp/content-studio-test',
    plan,
    projectId,
    projectOrigin: 'https://example.com',
    taskId,
    ...overrides,
  }
}

describe('production task executor', () => {
  it('runs a recording attempt and advances a task to composing', async () => {
    const store = createStore()
    const inputs: RecordingJobInput[] = []
    const result = await runProductionTask(
      store,
      createInput(),
      {
        record: async (input) => {
          inputs.push(input)
          return createReceipt('succeeded')
        },
      },
    )

    expect(inputs[0]).toMatchObject({
      baseUrl: 'https://example.com',
      jobId: taskId,
      maxAttempts: 1,
      projectId,
    })
    expect(result).toMatchObject({
      receipt: { outcome: 'succeeded' },
      task: { status: 'composing' },
    })
    expect(store.listEvents(projectId, taskId).map(event => event.kind))
      .toEqual(['task-created', 'status-changed', 'status-changed', 'status-changed'])
  })

  it('maps cancellation and failure receipts to task state', async () => {
    const cancelledStore = createStore()
    await expect(runProductionTask(
      cancelledStore,
      createInput(),
      { record: async () => createReceipt('cancelled') },
    )).resolves.toMatchObject({
      receipt: { outcome: 'cancelled' },
      task: { status: 'cancelled' },
    })

    const failedStore = createStore()
    await expect(runProductionTask(
      failedStore,
      createInput(),
      { record: async () => createReceipt('failed') },
    )).resolves.toMatchObject({
      receipt: { outcome: 'failed' },
      task: { status: 'failed' },
    })
  })

  it('fails closed before changing state for an invalid project origin or task', async () => {
    const store = createStore()
    await expect(runProductionTask(
      store,
      createInput({ baseUrl: 'https://other.example.com/' }),
      { record: async () => createReceipt('succeeded') },
    )).rejects.toThrow(/project origin/i)
    expect(store.getTask(projectId, taskId)?.status).toBe('generating')

    await expect(runProductionTask(
      store,
      createInput({ taskId: 'missing-task' }),
      { record: async () => createReceipt('succeeded') },
    )).rejects.toThrow(/not found/i)
  })

  it('fails a task when the recorder runtime throws', async () => {
    const store = createStore()
    await expect(runProductionTask(
      store,
      createInput(),
      { record: async () => { throw new Error('runtime failed') } },
    )).rejects.toThrow('runtime failed')
    expect(store.getTask(projectId, taskId)?.status).toBe('failed')
  })

  it('rejects invalid retry limits before recording starts', async () => {
    const store = createStore()
    const record = async () => createReceipt('succeeded')
    await expect(runProductionTask(
      store,
      createInput({ maxAttempts: 4 }),
      { record },
    )).rejects.toThrow(/maxAttempts/i)
    expect(store.getTask(projectId, taskId)?.status).toBe('generating')
  })
})
