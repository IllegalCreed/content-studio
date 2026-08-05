import type {
  CompiledCaptureAction,
  RecorderArtifact,
  RecordingSession,
  VideoPlan,
} from '../types'
import { describe, expect, it } from 'vitest'
import {
  RecorderError,
  runRecordingJob,
} from './run'

const plan: VideoPlan = {
  campaignId: 'quick-sort-launch',
  durationMs: 1600,
  format: 'landscape',
  recordingConfig: {
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en',
    outputSize: {
      height: 1080,
      width: 1920,
    },
    viewport: {
      height: 1080,
      width: 1920,
    },
  },
  scenes: [
    {
      actions: [
        {
          durationMs: 600,
          kind: 'click',
          locator: {
            by: 'role',
            name: 'Start',
            value: 'button',
          },
          startMs: 0,
        },
        {
          durationMs: 1000,
          kind: 'capture',
          label: 'partition',
          startMs: 600,
        },
      ],
      id: 'quick-sort',
      startMs: 0,
      startPath: '/quick-sort',
      title: 'Quick sort',
    },
  ],
}

const preview: RecorderArtifact = {
  id: 'preview-1',
  kind: 'preview-frame',
  relativePath: 'previews/preview-1.png',
  sha256: 'abc123',
  sizeBytes: 42,
}

describe('recording job runner', () => {
  it('rejects an invalid initial attempt number', async () => {
    await expect(runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        initialAttempt: 0,
        jobId: 'recording-job-invalid-attempt',
        outputDirectory: '/tmp/content-studio-recording-job-invalid-attempt',
        plan,
        projectId: 'algorithm-visualizer',
      },
      { createSession: async () => createSession(() => ({})) },
    )).rejects.toThrow(/initialAttempt/i)
  })

  it('rejects owner takeover without an explicit human intervention expectation', async () => {
    await expect(runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-invalid-takeover',
        outputDirectory: '/tmp/content-studio-recording-job-invalid-takeover',
        plan,
        projectId: 'algorithm-visualizer',
        recordingContext: {
          captureMode: 'deterministic',
          humanIntervention: false,
          ownerTakeover: true,
          planVersion: 1,
          repeatability: 'conditional',
          sourceAccess: 'source-owned',
        },
      },
      { createSession: async () => createSession(() => ({})) },
    )).rejects.toThrow(/ownerTakeover/i)
  })

  it('can continue task attempt numbering without reusing an output directory', async () => {
    const attempts: number[] = []
    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        initialAttempt: 3,
        jobId: 'recording-job-continue',
        maxAttempts: 1,
        outputDirectory: '/tmp/content-studio-recording-job-continue',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async (context) => {
          attempts.push(context.attempt)
          return createSession(() => ({}))
        },
      },
    )

    expect(attempts).toEqual([3])
    expect(result.receipt).toMatchObject({
      attempt: 3,
      previousAttempt: 2,
    })
  })

  it('stops at the configured retry limit after a continued attempt', async () => {
    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        initialAttempt: 3,
        jobId: 'recording-job-continued-failure',
        maxAttempts: 1,
        outputDirectory: '/tmp/content-studio-recording-job-continued-failure',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async () => {
          throw new Error('browser process exited')
        },
      },
    )

    expect(result.receipt).toMatchObject({
      attempt: 3,
      outcome: 'failed',
    })
  })

  it('retries a retryable isolated attempt and emits ordered progress', async () => {
    const attempts: number[] = []
    const events: Array<{ attempt: number, kind: string, sequence: number }> = []
    const persistedAttempts: number[] = []

    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-1',
        maxAttempts: 2,
        outputDirectory: '/tmp/content-studio-recording-job-1',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async (context) => {
          attempts.push(context.attempt)
          return createSession((action) => {
            if (context.attempt === 1 && action.kind === 'click') {
              throw new RecorderError(
                'runtime-error',
                'Browser process exited.',
                true,
              )
            }
            return action.kind === 'capture' ? { preview } : {}
          })
        },
        emit: (event) => {
          events.push(event)
        },
        persistReceipt: (receipt) => {
          persistedAttempts.push(receipt.attempt)
        },
      },
    )

    expect(attempts).toEqual([1, 2])
    expect(result.receipt).toMatchObject({
      attempt: 2,
      completedActions: 2,
      completedScenes: 1,
      outcome: 'succeeded',
      previousAttempt: 1,
      totalActions: 2,
      totalScenes: 1,
    })
    expect(result.attempts.map(attempt => attempt.outcome)).toEqual([
      'failed',
      'succeeded',
    ])
    expect(events.map(event => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    )
    expect(events.filter(event => event.kind === 'attempt-started')).toHaveLength(2)
    expect(events.some(event => event.kind === 'preview-ready')).toBe(true)
    expect(persistedAttempts).toEqual([1, 2])
  })

  it('cancels before the next action without retrying', async () => {
    const controller = new AbortController()
    let performedActions = 0

    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-2',
        maxAttempts: 3,
        outputDirectory: '/tmp/content-studio-recording-job-2',
        plan,
        projectId: 'algorithm-visualizer',
        signal: controller.signal,
      },
      {
        createSession: async () =>
          createSession(() => {
            performedActions += 1
            return {}
          }),
        emit: (event) => {
          if (event.kind === 'action-started')
            controller.abort()
        },
      },
    )

    expect(performedActions).toBe(0)
    expect(result.attempts).toHaveLength(1)
    expect(result.receipt).toMatchObject({
      completedActions: 0,
      outcome: 'cancelled',
    })
  })

  it('does not retry fail-closed policy violations', async () => {
    let sessions = 0
    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-3',
        maxAttempts: 3,
        outputDirectory: '/tmp/content-studio-recording-job-3',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async () => {
          sessions += 1
          return createSession(() => {
            throw new RecorderError(
              'cross-origin-navigation',
              'Navigation left the project origin.',
              false,
            )
          })
        },
      },
    )

    expect(sessions).toBe(1)
    expect(result.receipt).toMatchObject({
      failure: {
        code: 'cross-origin-navigation',
        retryable: false,
      },
      outcome: 'failed',
    })
  })

  it('validates job boundaries before creating a recording session', async () => {
    const createSession = async (): Promise<RecordingSession> =>
      createSessionWithNoop()
    const baseInput = {
      baseUrl: 'http://127.0.0.1:11000',
      jobId: 'recording-job',
      outputDirectory: '/tmp/content-studio-recording-validation',
      plan,
      projectId: 'algorithm-visualizer',
    }

    for (const input of [
      {
        ...baseInput,
        jobId: ' ',
      },
      {
        ...baseInput,
        projectId: ' ',
      },
      {
        ...baseInput,
        baseUrl: 'ftp://example.com',
      },
      {
        ...baseInput,
        baseUrl: 'https://identity@example.com',
      },
      {
        ...baseInput,
        maxAttempts: 0,
      },
      {
        ...baseInput,
        maxAttempts: 4,
      },
      {
        ...baseInput,
        maxAttempts: 1.5,
      },
      {
        ...baseInput,
        recordingContext: {
          captureMode: 'deterministic' as const,
          humanIntervention: false,
          planVersion: 0,
          repeatability: 'high' as const,
          sourceAccess: 'source-owned' as const,
        },
      },
      {
        ...baseInput,
        recordingContext: {
          captureMode: 'deterministic' as const,
          humanIntervention: false,
          planVersion: 1,
          repeatability: 'high' as const,
          sourceAccess: 'web-assisted' as const,
        },
      },
    ]) {
      await expect(
        runRecordingJob(input, {
          createSession,
        }),
      ).rejects.toThrow()
    }
  })

  it('reports preparation and cleanup failures without overwriting receipts', async () => {
    let sessions = 0
    let persisted = 0
    const preparationFailure = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-4',
        outputDirectory: '/tmp/content-studio-recording-job-4',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async () => {
          sessions += 1
          return createSessionWithNoop()
        },
        persistReceipt: () => {
          persisted += 1
        },
        prepareAttempt: () => {
          throw new RecorderError(
            'runtime-error',
            'Attempt directory exists.',
            false,
          )
        },
      },
    )

    expect(preparationFailure.receipt.outcome).toBe('failed')
    expect(sessions).toBe(0)
    expect(persisted).toBe(0)

    const cleanupFailure = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-5',
        outputDirectory: '/tmp/content-studio-recording-job-5',
        plan,
        projectId: 'algorithm-visualizer',
      },
      {
        createSession: async () => ({
          ...createSessionWithNoop(),
          close: async () => {
            throw new Error('browser cleanup failed')
          },
        }),
      },
    )

    expect(cleanupFailure.receipt).toMatchObject({
      failure: {
        code: 'runtime-error',
        retryable: true,
      },
      outcome: 'failed',
    })
  })

  it('keeps project integration context on every attempt receipt', async () => {
    const result = await runRecordingJob(
      {
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'recording-job-context',
        outputDirectory: '/tmp/content-studio-recording-job-context',
        plan,
        projectId: 'algorithm-visualizer',
        recordingContext: {
          captureMode: 'deterministic',
          humanIntervention: false,
          planVersion: 3,
          repeatability: 'high',
          sourceAccess: 'source-owned',
        },
      },
      {
        createSession: async () => createSessionWithNoop(),
      },
    )

    expect(result.receipt.recordingContext).toEqual({
      captureMode: 'deterministic',
      humanIntervention: false,
      planVersion: 3,
      repeatability: 'high',
      sourceAccess: 'source-owned',
    })
    expect(result.attempts[0]?.recordingContext).toEqual(result.receipt.recordingContext)
    expect(result.receipt.recordingConfig).toEqual(plan.recordingConfig)
  })
})

function createSession(
  runAction: (
    action: CompiledCaptureAction,
  ) => Promise<{ preview?: RecorderArtifact }> | { preview?: RecorderArtifact },
): RecordingSession {
  return {
    beginScene: async () => {},
    close: async () => ({
      artifacts: [],
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
    }),
    endScene: async () => {},
    runAction: async action => runAction(action),
  }
}

function createSessionWithNoop(): RecordingSession {
  return createSession(() => ({}))
}
