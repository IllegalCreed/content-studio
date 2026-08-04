import { describe, expect, it } from 'vitest'
import { validateAssistedRecordingPlan } from './assisted-boundary'

const validPlan = {
  entryUrl: 'https://example.com/demo',
  observations: [{
    observationId: 'demo-page',
    observedAt: '2026-08-04T08:00:00.000Z',
    pageUrl: 'https://example.com/demo',
    title: 'Demo page',
  }],
  planVersion: 1,
  projectId: 'demo-project',
  requiresOwner: true,
  steps: [
    {
      kind: 'click',
      locator: { by: 'role', name: 'Start', value: 'button' },
    },
    { kind: 'wait', durationMs: 500 },
    {
      kind: 'capture',
      label: 'result',
      durationMs: 1000,
    },
  ],
}

describe('web-assisted recording boundary', () => {
  it('accepts an owner-gated plan with same-origin observations and semantic actions', () => {
    expect(validateAssistedRecordingPlan(validPlan)).toEqual(validPlan)
  })

  it('rejects plans that could become unattended credential or script automation', () => {
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      requiresOwner: false,
    })).toThrow(/requiresOwner/i)
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      steps: [{
        kind: 'fill',
        locator: { by: 'label', value: 'Username' },
        value: 'someone',
      }],
    })).toThrow(/not allowed/i)
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      script: 'page.click("#start")',
    })).toThrow(/unsupported field|script/i)
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      password: 'never accept this',
    })).toThrow(/sensitive field/i)
  })

  it('rejects unsafe or cross-origin page observations', () => {
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      entryUrl: 'http://example.com/demo',
    })).toThrow(/HTTPS/i)
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      observations: [{
        ...validPlan.observations[0],
        pageUrl: 'https://other.example/demo',
      }],
    })).toThrow(/same origin/i)
    expect(() => validateAssistedRecordingPlan({
      ...validPlan,
      steps: [{
        kind: 'click',
        locator: { by: 'css', value: '#start' },
      }],
    })).toThrow(/semantic locator/i)
  })
})
