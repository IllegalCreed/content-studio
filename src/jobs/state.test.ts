import { describe, expect, it } from 'vitest'
import {
  createCampaignJob,
  transitionCampaignJob,
} from './state'

describe('campaign job state machine', () => {
  it('follows the production lifecycle in order', () => {
    const statuses = [
      'generating',
      'recording',
      'composing',
      'awaiting-owner',
      'published',
      'monitoring',
    ] as const
    let state = createCampaignJob()

    for (const status of statuses) {
      state = transitionCampaignJob(state, status, {
        hasPublicationReceipt: status === 'published',
      })
    }

    expect(state).toEqual({
      attempt: 1,
      status: 'monitoring',
    })
  })

  it('requires a publication receipt and rejects skipped stages', () => {
    const awaitingOwner = {
      attempt: 1,
      status: 'awaiting-owner',
    } as const

    expect(() =>
      transitionCampaignJob(awaitingOwner, 'published'),
    ).toThrow(/publication receipt/i)
    expect(() =>
      transitionCampaignJob(createCampaignJob(), 'recording'),
    ).toThrow(/queued.*recording/i)
  })

  it('supports explicit cancellation and traceable retry attempts', () => {
    const cancelled = transitionCampaignJob(
      {
        attempt: 2,
        status: 'recording',
      },
      'cancelled',
    )
    const retried = transitionCampaignJob(cancelled, 'queued')

    expect(retried).toEqual({
      attempt: 3,
      status: 'queued',
    })
    expect(() =>
      transitionCampaignJob(
        {
          attempt: 1,
          status: 'published',
        },
        'cancelled',
      ),
    ).toThrow(/published.*cancelled/i)
  })
})
