// @env node

import type {
  AssistedCaptureStep,
  AssistedPageObservation,
  AssistedRecordingPlan,
  SemanticLocator,
} from '../types'
import { assertNoSensitiveKeys } from '../validation'

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TEST_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MAX_OBSERVATIONS = 100
const MAX_STEPS = 100

/**
 * Validate the narrow handoff between an AI page observer and a browser host.
 * This is deliberately a data contract only; it never opens a browser.
 */
export function validateAssistedRecordingPlan(
  input: unknown,
): AssistedRecordingPlan {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'assisted recording plan')
  assertSupportedKeys(
    value,
    new Set([
      'entryUrl',
      'observations',
      'planVersion',
      'projectId',
      'requiresOwner',
      'steps',
    ]),
    'assisted recording plan',
  )
  if (value.requiresOwner !== true)
    throw new Error('Assisted recording plan requiresOwner must be true')

  const entryUrl = parseHttpsUrl(value.entryUrl, 'entryUrl')
  const projectId = parseIdentifier(value.projectId, 'projectId')
  const planVersion = parsePositiveInteger(value.planVersion, 'planVersion')
  const observations = parseObservations(value.observations, entryUrl)
  const steps = parseSteps(value.steps)
  return {
    entryUrl,
    observations,
    planVersion,
    projectId,
    requiresOwner: true,
    steps,
  }
}

function parseObservations(
  input: unknown,
  entryUrl: string,
): AssistedPageObservation[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new TypeError('assisted recording observations must be a non-empty array')
  if (input.length > MAX_OBSERVATIONS)
    throw new Error(`assisted recording observations cannot exceed ${MAX_OBSERVATIONS}`)
  const entryOrigin = new URL(entryUrl).origin
  const observations = input.map((item, index) => {
    const value = asRecord(item, `observations[${index}]`)
    assertSupportedKeys(
      value,
      new Set(['observationId', 'observedAt', 'pageUrl', 'title']),
      `observations[${index}]`,
    )
    const pageUrl = parseHttpsUrl(value.pageUrl, `observations[${index}].pageUrl`)
    if (new URL(pageUrl).origin !== entryOrigin)
      throw new Error('Assisted observation pageUrl must use the entryUrl same origin')
    const observedAt = nonEmptyString(
      value.observedAt,
      `observations[${index}].observedAt`,
    )
    if (Number.isNaN(Date.parse(observedAt)))
      throw new Error(`observations[${index}].observedAt must be an ISO date`)
    return {
      observationId: parseIdentifier(
        value.observationId,
        `observations[${index}].observationId`,
      ),
      observedAt,
      pageUrl,
      title: nonEmptyString(value.title, `observations[${index}].title`),
    }
  })
  assertUnique(
    observations.map(observation => observation.observationId),
    'observation id',
  )
  return observations
}

function parseSteps(input: unknown): AssistedCaptureStep[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new TypeError('assisted recording steps must be a non-empty array')
  if (input.length > MAX_STEPS)
    throw new Error(`assisted recording steps cannot exceed ${MAX_STEPS}`)
  return input.map((item, index) => {
    const value = asRecord(item, `steps[${index}]`)
    const kind = nonEmptyString(value.kind, `steps[${index}].kind`)
    if (kind === 'wait') {
      assertSupportedKeys(value, new Set(['durationMs', 'kind']), `steps[${index}]`)
      return {
        durationMs: parseDuration(value.durationMs, `steps[${index}].durationMs`),
        kind,
      }
    }
    if (kind === 'capture') {
      assertSupportedKeys(
        value,
        new Set(['durationMs', 'kind', 'label']),
        `steps[${index}]`,
      )
      return {
        kind,
        label: nonEmptyString(value.label, `steps[${index}].label`),
        ...(value.durationMs === undefined
          ? {}
          : { durationMs: parseDuration(value.durationMs, `steps[${index}].durationMs`) }),
      }
    }
    if (kind === 'click' || kind === 'wait-for') {
      assertSupportedKeys(
        value,
        new Set(['durationMs', 'kind', 'locator']),
        `steps[${index}]`,
      )
      return {
        kind,
        locator: parseLocator(value.locator, `steps[${index}].locator`),
        ...(value.durationMs === undefined
          ? {}
          : { durationMs: parseDuration(value.durationMs, `steps[${index}].durationMs`) }),
      }
    }
    throw new Error(
      `Assisted recording step kind is not allowed: ${kind}; owner input must stay outside the plan`,
    )
  })
}

function parseLocator(input: unknown, name: string): SemanticLocator {
  const value = asRecord(input, name)
  assertSupportedKeys(value, new Set(['by', 'name', 'value']), name)
  const by = nonEmptyString(value.by, `${name}.by`)
  if (!['label', 'role', 'test-id', 'text'].includes(by))
    throw new Error(`${name} must use a supported semantic locator`)
  const locator: SemanticLocator = {
    by: by as SemanticLocator['by'],
    value: nonEmptyString(value.value, `${name}.value`),
  }
  if (locator.by === 'test-id' && !TEST_ID_PATTERN.test(locator.value))
    throw new Error(`${name}.value test-id must use lowercase kebab-case`)
  if (value.name !== undefined)
    locator.name = nonEmptyString(value.name, `${name}.name`)
  return locator
}

function parseHttpsUrl(input: unknown, name: string): string {
  const value = nonEmptyString(input, name)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error(`${name} must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    throw new Error(`${name} must be an HTTPS URL without credentials`)
  return value
}

function parseIdentifier(input: unknown, name: string): string {
  const value = nonEmptyString(input, name)
  if (!IDENTIFIER_PATTERN.test(value))
    throw new Error(`${name} must use lowercase kebab-case`)
  return value
}

function parsePositiveInteger(input: unknown, name: string): number {
  if (!Number.isInteger(input) || (input as number) < 1)
    throw new Error(`${name} must be a positive integer`)
  return input as number
}

function parseDuration(input: unknown, name: string): number {
  if (
    !Number.isInteger(input)
    || (input as number) < 1
    || (input as number) > 60_000
  ) {
    throw new Error(`${name} must be an integer between 1 and 60000`)
  }
  return input as number
}

function nonEmptyString(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim() === '')
    throw new Error(`${name} must be a non-empty string`)
  return input
}

function asRecord(input: unknown, name: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new TypeError(`${name} must be an object`)
  return input as Record<string, unknown>
}

function assertSupportedKeys(
  value: Record<string, unknown>,
  supportedKeys: Set<string>,
  name: string,
): void {
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new Error(`${name} contains unsupported field: ${key}`)
  }
}

function assertUnique(values: string[], name: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${name}`)
}
