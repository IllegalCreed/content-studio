import type {
  CampaignJobState,
  CampaignJobStatus,
  CampaignJobTransitionOptions,
} from '../types'
import { CAMPAIGN_JOB_TRANSITIONS } from '../constants'

export function createCampaignJob(): CampaignJobState {
  return {
    attempt: 1,
    status: 'queued',
  }
}

export function transitionCampaignJob(
  state: CampaignJobState,
  nextStatus: CampaignJobStatus,
  options: CampaignJobTransitionOptions = {},
): CampaignJobState {
  const allowedStatuses: readonly CampaignJobStatus[]
    = CAMPAIGN_JOB_TRANSITIONS[state.status]
  if (!allowedStatuses.includes(nextStatus)) {
    throw new Error(
      `Campaign job cannot transition from ${state.status} to ${nextStatus}`,
    )
  }
  if (nextStatus === 'published' && options.hasPublicationReceipt !== true) {
    throw new Error(
      'Campaign job requires a matching publication receipt before published',
    )
  }

  return {
    attempt: nextStatus === 'queued' ? state.attempt + 1 : state.attempt,
    status: nextStatus,
  }
}
