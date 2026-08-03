// @env node

import type {
  RecorderAttemptReceipt,
  RecorderFailure,
  RecorderFailureCode,
  RecorderLogSummary,
  RecordingContext,
  RecordingJobDependencies,
  RecordingJobInput,
  RecordingJobResult,
  RecordingProgressEvent,
  RecordingProgressEventKind,
  RecordingSession,
  RecordingSessionSummary,
} from '../types'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  DEFAULT_RECORDING_MAX_ATTEMPTS,
  MAX_RECORDING_ATTEMPTS,
} from '../constants'
import { validateOutputDirectory } from '../output/write'

const EMPTY_LOG_SUMMARY: RecorderLogSummary = {
  consoleErrors: 0,
  consoleWarnings: 0,
  entries: [],
  pageErrors: 0,
}

export class RecorderError extends Error {
  readonly code: RecorderFailureCode
  readonly retryable: boolean

  constructor(
    code: RecorderFailureCode,
    message: string,
    retryable: boolean,
  ) {
    super(message)
    this.name = 'RecorderError'
    this.code = code
    this.retryable = retryable
  }
}

export async function runRecordingJob(
  input: RecordingJobInput,
  dependencies: RecordingJobDependencies,
): Promise<RecordingJobResult> {
  const validatedInput = validateRecordingJobInput(input)
  const totalActions = validatedInput.plan.scenes.reduce(
    (total, scene) => total + scene.actions.length,
    0,
  )
  const attempts: RecorderAttemptReceipt[] = []
  let sequence = 0
  const firstAttempt = validatedInput.initialAttempt ?? 1
  const lastAttempt = firstAttempt + validatedInput.maxAttempts - 1

  const emit = async (
    attempt: number,
    kind: RecordingProgressEventKind,
    completed: number,
    message: string,
    artifact?: RecordingProgressEvent['artifact'],
  ): Promise<void> => {
    sequence += 1
    await dependencies.emit?.({
      ...(artifact === undefined ? {} : { artifact }),
      attempt,
      jobId: validatedInput.jobId,
      kind,
      message,
      progress: {
        completed,
        total: totalActions,
      },
      schemaVersion: 1,
      sequence,
      stage: 'recording',
    })
  }

  for (
    let attempt = firstAttempt;
    attempt <= lastAttempt;
    attempt += 1
  ) {
    const artifactDirectory = resolve(
      validatedInput.outputDirectory,
      `attempt-${attempt}`,
    )
    let completedActions = 0
    let completedScenes = 0
    let session: RecordingSession | undefined
    let attemptPrepared = dependencies.prepareAttempt === undefined
    let summary: RecordingSessionSummary = {
      artifacts: [],
      logs: EMPTY_LOG_SUMMARY,
    }
    let failure: RecorderFailure | undefined

    await emit(attempt, 'attempt-started', completedActions, `Recording attempt ${attempt} started.`)

    try {
      throwIfAborted(validatedInput.signal)
      const attemptContext = {
        artifactDirectory,
        attempt,
        baseUrl: validatedInput.baseUrl,
        jobId: validatedInput.jobId,
        plan: validatedInput.plan,
        projectId: validatedInput.projectId,
        ...(validatedInput.recordingContext === undefined
          ? {}
          : { recordingContext: validatedInput.recordingContext }),
        ...(validatedInput.signal === undefined
          ? {}
          : { signal: validatedInput.signal }),
      }
      await dependencies.prepareAttempt?.(attemptContext)
      attemptPrepared = true
      session = await dependencies.createSession(attemptContext)

      for (
        let sceneIndex = 0;
        sceneIndex < validatedInput.plan.scenes.length;
        sceneIndex += 1
      ) {
        const scene = validatedInput.plan.scenes[sceneIndex]!
        throwIfAborted(validatedInput.signal)
        await emit(
          attempt,
          'scene-started',
          completedActions,
          `Scene ${sceneIndex + 1} started.`,
        )
        await session.beginScene(scene, {
          sceneIndex,
          ...(validatedInput.signal === undefined
            ? {}
            : { signal: validatedInput.signal }),
        })

        for (
          let actionIndex = 0;
          actionIndex < scene.actions.length;
          actionIndex += 1
        ) {
          const action = scene.actions[actionIndex]!
          throwIfAborted(validatedInput.signal)
          await emit(
            attempt,
            'action-started',
            completedActions,
            `Action ${actionIndex + 1} in scene ${sceneIndex + 1} started.`,
          )
          throwIfAborted(validatedInput.signal)
          const result = await session.runAction(action, {
            actionIndex,
            sceneIndex,
            ...(validatedInput.signal === undefined
              ? {}
              : { signal: validatedInput.signal }),
          })
          throwIfAborted(validatedInput.signal)
          completedActions += 1
          if (result.preview !== undefined) {
            summary.artifacts.push(result.preview)
            await emit(
              attempt,
              'preview-ready',
              completedActions,
              `Preview for scene ${sceneIndex + 1} is ready.`,
              result.preview,
            )
          }
          await emit(
            attempt,
            'action-completed',
            completedActions,
            `Action ${actionIndex + 1} in scene ${sceneIndex + 1} completed.`,
          )
        }

        await session.endScene(scene, {
          sceneIndex,
          ...(validatedInput.signal === undefined
            ? {}
            : { signal: validatedInput.signal }),
        })
        completedScenes += 1
        await emit(
          attempt,
          'scene-completed',
          completedActions,
          `Scene ${sceneIndex + 1} completed.`,
        )
      }
      throwIfAborted(validatedInput.signal)
    }
    catch (error) {
      failure = normalizeRecorderFailure(error, validatedInput.signal)
    }

    if (session !== undefined) {
      try {
        const closedSummary = await session.close()
        summary = {
          artifacts: [
            ...summary.artifacts,
            ...closedSummary.artifacts,
          ],
          logs: closedSummary.logs,
        }
      }
      catch (error) {
        failure ??= normalizeRecorderFailure(error, validatedInput.signal)
      }
    }

    const outcome = failure === undefined
      ? 'succeeded'
      : failure.code === 'cancelled'
        ? 'cancelled'
        : 'failed'
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory,
      artifacts: summary.artifacts,
      attempt,
      campaignId: validatedInput.plan.campaignId,
      completedActions,
      completedScenes,
      ...(failure === undefined ? {} : { failure }),
      jobId: validatedInput.jobId,
      logs: summary.logs,
      outcome,
      planSha256: hashPlan(validatedInput.plan),
      ...(attempt === 1 ? {} : { previousAttempt: attempt - 1 }),
      projectId: validatedInput.projectId,
      ...(validatedInput.recordingContext === undefined
        ? {}
        : { recordingContext: validatedInput.recordingContext }),
      receiptVersion: 1,
      totalActions,
      totalScenes: validatedInput.plan.scenes.length,
      viewport: validatedInput.plan.viewport,
    }
    attempts.push(receipt)
    if (attemptPrepared)
      await dependencies.persistReceipt?.(receipt)

    if (outcome === 'succeeded') {
      await emit(
        attempt,
        'attempt-completed',
        completedActions,
        `Recording attempt ${attempt} completed.`,
      )
      return {
        attempts,
        receipt,
      }
    }

    if (outcome === 'cancelled') {
      await emit(
        attempt,
        'attempt-cancelled',
        completedActions,
        `Recording attempt ${attempt} was cancelled.`,
      )
      return {
        attempts,
        receipt,
      }
    }

    await emit(
      attempt,
      'attempt-failed',
      completedActions,
      `Recording attempt ${attempt} failed with ${failure!.code}.`,
    )
    if (!failure!.retryable || attempt === lastAttempt) {
      return {
        attempts,
        receipt,
      }
    }
  }

  throw new Error('Recording job did not produce a receipt')
}

interface ValidatedRecordingJobInput extends RecordingJobInput {
  maxAttempts: number
  outputDirectory: string
}

function validateRecordingJobInput(
  input: RecordingJobInput,
): ValidatedRecordingJobInput {
  if (input.jobId.trim() === '')
    throw new Error('Recording jobId must not be empty')
  if (input.projectId.trim() === '')
    throw new Error('Recording projectId must not be empty')

  const baseUrl = new URL(input.baseUrl)
  if (
    !['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username !== ''
    || baseUrl.password !== ''
  ) {
    throw new Error('Recording baseUrl must be HTTP(S) without credentials')
  }

  const maxAttempts
    = input.maxAttempts ?? DEFAULT_RECORDING_MAX_ATTEMPTS
  if (
    !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > MAX_RECORDING_ATTEMPTS
  ) {
    throw new Error(
      `Recording maxAttempts must be between 1 and ${MAX_RECORDING_ATTEMPTS}`,
    )
  }

  const initialAttempt = input.initialAttempt ?? 1
  if (!Number.isInteger(initialAttempt) || initialAttempt < 1) {
    throw new Error('Recording initialAttempt must be a positive integer')
  }

  return {
    ...input,
    baseUrl: baseUrl.origin,
    initialAttempt,
    maxAttempts,
    outputDirectory: validateOutputDirectory(input.outputDirectory),
    ...(input.recordingContext === undefined
      ? {}
      : { recordingContext: validateRecordingContext(input.recordingContext) }),
  }
}

function validateRecordingContext(input: RecordingContext): RecordingContext {
  if (
    (input.sourceAccess !== 'source-owned' && input.sourceAccess !== 'web-assisted')
    || (input.captureMode !== 'deterministic' && input.captureMode !== 'assisted')
    || (input.repeatability !== 'high'
      && input.repeatability !== 'conditional'
      && input.repeatability !== 'low')
    || typeof input.humanIntervention !== 'boolean'
    || !Number.isInteger(input.planVersion)
    || input.planVersion < 1
  ) {
    throw new Error('Recording context is invalid')
  }
  if (input.sourceAccess === 'web-assisted' && input.captureMode === 'deterministic')
    throw new Error('Recording context cannot mark web-assisted capture as deterministic')
  return { ...input }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new RecorderError(
      'cancelled',
      'Recording was cancelled.',
      false,
    )
  }
}

function normalizeRecorderFailure(
  error: unknown,
  signal: AbortSignal | undefined,
): RecorderFailure {
  if (signal?.aborted === true) {
    return {
      code: 'cancelled',
      message: 'Recording was cancelled.',
      retryable: false,
    }
  }
  if (error instanceof RecorderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    }
  }
  return {
    code: 'runtime-error',
    message: 'The recording runtime failed.',
    retryable: true,
  }
}

function hashPlan(plan: RecordingJobInput['plan']): string {
  return createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex')
}
