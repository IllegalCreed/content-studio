// @env node

import type { PublicationReceipt } from '../types'
import { describe, expect, it } from 'vitest'
import {
  assertMatchingMarketingOpsReceipt,
  createFakeMarketingOpsClient,
} from './client'

describe('marketing-ops client boundary', () => {
  it('creates a deterministic local receipt without touching a channel', async () => {
    const client = createFakeMarketingOpsClient({
      now: () => new Date('2026-08-04T00:00:00.000Z'),
    })
    await expect(client.publish({
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      contentSha256: 'a'.repeat(64),
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).resolves.toEqual({
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      contentSha256: 'a'.repeat(64),
      externalReceiptId: 'fixture-publication-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      projectId: 'project-a',
      publicationId: 'publication-a',
      publicUrl: 'https://marketing-ops.invalid/publication-a',
      receiptId: 'marketing-ops-publication-a',
      source: 'marketing-ops',
      status: 'published',
    })
  })

  it('rejects a receipt without the marketing-ops source or matching account', () => {
    const base: PublicationReceipt = {
      activityId: 'activity-a',
      channel: 'youtube',
      externalReceiptId: 'external-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a',
      source: 'marketing-ops',
      status: 'published',
    }
    expect(() => assertMatchingMarketingOpsReceipt({ ...base, source: undefined }, {
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).toThrow(/marketing-ops/i)
    expect(() => assertMatchingMarketingOpsReceipt({ ...base, accountRef: 'other-account' }, {
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).toThrow(/account/i)
  })
})
