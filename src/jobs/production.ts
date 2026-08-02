// @env node

import type {
  ExecutionTask,
  ExecutionTaskStore,
  PlaywrightRecordingOptions,
  RecorderAttemptReceipt,
  RecordingContext,
  RecordingJobInput,
  RecordingJobResult,
} from '../types'
import {
  DEFAULT_RECORDING_MAX_ATTEMPTS,
  MAX_RECORDING_ATTEMPTS,
} from '../constants'
import { validateOutputDirectory } from '../output/write'
import { recordWithPlaywright } from '../recording/playwright'
import {
  TaskNotFoundError,
  TaskStateError,
} from './task'

export interface ProductionTaskInput {
  baseUrl: string
  maxAttempts?: number
  outputDirectory: string
  plan: RecordingJobInput['plan']
  projectId: string
  projectOrigin: string
  recordingContext?: RecordingContext
  signal?: AbortSignal
  taskId: string
}

export interface ProductionTaskDependencies {
  options?: Pick<
    PlaywrightRecordingOptions,
    'actionTimeoutMs' | 'emit' | 'headless'
  >
  record: (
    input: RecordingJobInput,
    options?: Pick<
      PlaywrightRecordingOptions,
      'actionTimeoutMs' | 'emit' | 'headless'
    >,
  ) => Promise<RecordingJobResult>
}

export interface ProductionTaskResult {
  receipt: RecorderAttemptReceipt
  task: ExecutionTask
}

/**
 * Runs one validated production task through the recording boundary.
 *
 * The executor deliberately accepts the recorder as a dependency. This keeps
 * task state transitions testable and lets the runtime choose either the
 * Playwright recorder or a future reviewed project adapter without exposing
 * arbitrary scripts through the control plane.
 */
export async function runProductionTask(
  store: ExecutionTaskStore,
  input: ProductionTaskInput,
  dependencies: ProductionTaskDependencies,
): Promise<ProductionTaskResult> {
  const task = store.getTask(input.projectId, input.taskId)
  if (task === undefined)
    throw new TaskNotFoundError(input.projectId, input.taskId)
  if (task.kind !== 'production') {
    throw new TaskStateError(
      `Task ${input.taskId} is not a production task`,
    )
  }
  if (task.status !== 'generating') {
    throw new TaskStateError(
      `Production task ${input.taskId} must be generating before recording`,
    )
  }

  const baseUrl = validateProjectOrigin(input.baseUrl, input.projectOrigin)
  const outputDirectory = validateOutputDirectory(input.outputDirectory)
  const maxAttempts = validateMaxAttempts(input.maxAttempts)

  store.transitionTask(input.projectId, input.taskId, 'recording')

  let result: RecordingJobResult
  try {
    result = await dependencies.record(
      {
        baseUrl,
        jobId: input.taskId,
        maxAttempts,
        outputDirectory,
        plan: input.plan,
        projectId: input.projectId,
        ...(input.recordingContext === undefined
          ? {}
          : { recordingContext: input.recordingContext }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
      dependencies.options,
    )
  }
  catch (error) {
    store.transitionTask(input.projectId, input.taskId, 'failed')
    throw error
  }

  const nextStatus = result.receipt.outcome === 'succeeded'
    ? 'composing'
    : result.receipt.outcome
  const finalTask = store.transitionTask(
    input.projectId,
    input.taskId,
    nextStatus,
  )

  return {
    receipt: result.receipt,
    task: finalTask,
  }
}

/**
 * Runs a production task with the built-in semantic Playwright recorder.
 *
 * The caller still has to provide an explicit preview URL and compiled plan;
 * this helper does not discover projects, launch arbitrary code, or infer
 * credentials. A project-specific preview adapter can keep using
 * `recordProjectWithPlaywright` to obtain that URL before calling this helper.
 */
export function runProductionTaskWithPlaywright(
  store: ExecutionTaskStore,
  input: ProductionTaskInput,
  options: ProductionTaskDependencies['options'] = {},
): Promise<ProductionTaskResult> {
  return runProductionTask(store, input, {
    options,
    record: recordWithPlaywright,
  })
}

function validateProjectOrigin(baseUrlInput: string, projectOriginInput: string): string {
  let baseUrl: URL
  let projectOrigin: URL
  try {
    baseUrl = new URL(baseUrlInput)
    projectOrigin = new URL(projectOriginInput)
  }
  catch {
    throw new TaskStateError('Production task requires a valid project origin')
  }

  if (
    !['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.username !== ''
    || baseUrl.password !== ''
    || !['http:', 'https:'].includes(projectOrigin.protocol)
    || projectOrigin.username !== ''
    || projectOrigin.password !== ''
    || baseUrl.origin !== projectOrigin.origin
  ) {
    throw new TaskStateError(
      'Production task base URL must match the project origin without credentials',
    )
  }
  return baseUrl.origin
}

function validateMaxAttempts(input: number | undefined): number {
  const maxAttempts = input ?? DEFAULT_RECORDING_MAX_ATTEMPTS
  if (
    !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > MAX_RECORDING_ATTEMPTS
  ) {
    throw new TaskStateError(
      `Production task maxAttempts must be between 1 and ${MAX_RECORDING_ATTEMPTS}`,
    )
  }
  return maxAttempts
}
