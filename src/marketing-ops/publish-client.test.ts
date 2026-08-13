// @env node

import type {
  MarketingOpsCampaignRequest,
} from '../types'
import { describe, expect, it, vi } from 'vitest'
import { createMarketingOpsPublishClient } from './publish-client'

const request: MarketingOpsCampaignRequest = {
  authorization: {
    authorizedAt: '2026-08-10T10:00:00.000Z',
    source: 'owner-prompt',
  },
  campaignId: 'quick-sort-launch',
  execution: { mode: 'assisted-prepare' },
  idempotencyKey: 'campaign-v4/algorithm-visualizer/quick-sort-launch/12345678',
  packages: [{
    canonicalUrl: 'https://algo.example/zh/quick-sort/',
    channel: 'bilibili',
    contentStudio: {
      activityId: 'activity-quick-sort',
      artifactRefs: [{
        artifactId: 'cover-zh',
        kind: 'image',
        locale: 'zh-CN',
        mediaKind: 'image',
        sha256: 'a'.repeat(64),
        version: 1,
      }],
      contentFormat: 'image-text',
      contentHash: 'b'.repeat(64),
      contentId: 'bilibili-image-text-zh-content',
      contentVersion: 1,
      packageId: 'bilibili-image-text-zh',
      projectId: 'algorithm-visualizer',
      publicationId: 'bilibili-image-text-zh',
      schemaVersion: 1,
    },
    format: 'manual-package',
    utmMedium: 'social',
    variants: [{
      body: '正文 https://algo.example/zh/quick-sort/',
      links: ['https://algo.example/zh/quick-sort/'],
      locale: 'zh-CN',
      media: ['image'],
      title: '快速排序可视化',
    }],
  }],
  projectId: 'algorithm-visualizer',
  spec: {
    campaign: 'quick-sort-launch',
    channels: ['bilibili'],
    content: {
      media: ['image'],
      variants: {
        'zh-CN': {
          angle: '演示排序过程',
          callToAction: '打开演示',
          title: '快速排序可视化',
        },
      },
    },
    failureMode: 'continue-supported',
    id: 'quick-sort-launch',
    locales: ['zh-CN'],
    publishAt: '2026-08-10T10:00:00.000Z',
    replies: { createBugIssues: false, mode: 'off' },
    schemaVersion: 1,
    targetUrls: ['https://algo.example/zh/quick-sort/'],
    topic: '快速排序可视化',
  },
}

function resultEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    campaignId: request.campaignId,
    failures: [],
    handoffs: [],
    limitations: [],
    projectId: request.projectId,
    receipts: [],
    ...overrides,
  }
}

function receiptEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityId: 'activity-quick-sort',
    campaignId: request.campaignId,
    channel: 'bilibili',
    contentFormat: 'image-text',
    contentHash: 'c'.repeat(64),
    contentStudioContentHash: 'b'.repeat(64),
    idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
    packageId: 'bilibili-image-text-zh',
    postId: '123456789',
    projectId: request.projectId,
    publicUrl: 'https://www.bilibili.com/opus/123456789',
    publicationId: 'bilibili-image-text-zh',
    publishedAt: '2026-08-10T10:01:00.000Z',
    status: 'published',
    ...overrides,
  }
}

function handoffEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: 'bilibili',
    contentHash: 'c'.repeat(64),
    contentStudioContentHash: 'b'.repeat(64),
    form: 'image-text',
    idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
    packageId: 'bilibili-image-text-zh',
    publicationId: 'bilibili-image-text-zh',
    status: 'awaiting-owner',
    ...overrides,
  }
}

async function publishReturned(value: unknown, input = request): Promise<unknown> {
  return createMarketingOpsPublishClient({ publishCampaign: async () => value })
    .publishCampaign(input)
}

describe('marketing-ops publish client', () => {
  it('passes only the validated campaign request to the transport and parses handoffs', async () => {
    const publishCampaign = vi.fn(async () => ({
      campaignId: 'quick-sort-launch',
      failures: [],
      handoffs: [{
        action: 'assisted-confirm',
        channel: 'bilibili',
        contentHash: 'c'.repeat(64),
        contentStudioContentHash: 'b'.repeat(64),
        form: 'image-text',
        idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
        nextAction: 'Publish this package in the official UI, then confirm its public URL.',
        packageId: 'bilibili-image-text-zh',
        publicUrl: 'https://www.bilibili.com/opus/123456789',
        publicationId: 'bilibili-image-text-zh',
        status: 'awaiting-owner',
      }],
      limitations: ['publication-is-owner-confirmed-not-remotely-created'],
      projectId: 'algorithm-visualizer',
      receipts: [],
    }))
    const client = createMarketingOpsPublishClient({ publishCampaign })
    const result = await client.publishCampaign(request)
    expect(publishCampaign).toHaveBeenCalledWith(request)
    expect(result).toMatchObject({
      campaignId: 'quick-sort-launch',
      handoffs: [{
        action: 'assisted-confirm',
        form: 'image-text',
        packageId: 'bilibili-image-text-zh',
        publicUrl: 'https://www.bilibili.com/opus/123456789',
        publicationId: 'bilibili-image-text-zh',
        status: 'awaiting-owner',
      }],
      projectId: 'algorithm-visualizer',
    })
  })

  it('parses only an identity-bound abandoned handoff without a public reference', async () => {
    const abandonedRequest: MarketingOpsCampaignRequest = {
      ...request,
      execution: { mode: 'assisted-abandon' },
    }
    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({
        nextAction: 'Local owner handoff was abandoned without a remote action.',
        reused: false,
        status: 'abandoned',
      })],
    }), abandonedRequest)).resolves.toMatchObject({
      handoffs: [{
        packageId: 'bilibili-image-text-zh',
        publicationId: 'bilibili-image-text-zh',
        reused: false,
        status: 'abandoned',
      }],
    })

    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({
        action: 'final-confirmation',
        reused: false,
        status: 'abandoned',
      })],
    }), abandonedRequest)).rejects.toThrow(/abandoned.*action|handoff.*action/i)
  })

  it('rejects observed Bilibili handoff references that are not strict canonical form URLs', async () => {
    for (const publicUrl of [
      'https://www.bilibili.com/opus/123456789?spm_id_from=333.1.0.0',
      'https://www.bilibili.com/opus/123456789/',
      'https://t.bilibili.com/123456789',
      'https://www.bilibili.com/video/BV1WrongForm',
      'https://www.bilibili.com/opus/12345',
      `https://www.bilibili.com/opus/${'1'.repeat(31)}`,
      'https://www.bilibili.com/read/cv12345',
      `https://www.bilibili.com/read/cv${'1'.repeat(31)}`,
    ]) {
      await expect(publishReturned(resultEnvelope({
        handoffs: [handoffEnvelope({
          action: 'assisted-confirm',
          publicUrl,
        })],
      }))).rejects.toThrow(/handoff.*URL|reference/i)
    }
  })

  it('requires observed handoff references to be paired with assisted confirmation', async () => {
    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({
        action: 'final-confirmation',
        publicUrl: 'https://www.bilibili.com/opus/123456789',
      })],
    }))).rejects.toThrow(/handoff.*action|reference/i)

    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({ action: 'assisted-confirm' })],
    }))).rejects.toThrow(/handoff.*URL|reference/i)

    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({ action: 'unexpected' })],
    }))).rejects.toThrow(/handoff.*action/i)
  })

  it('rejects a receipt that cannot be mapped to one Content Studio package', async () => {
    const publishCampaign = vi.fn(async () => ({
      campaignId: 'quick-sort-launch',
      failures: [],
      handoffs: [],
      limitations: [],
      projectId: 'algorithm-visualizer',
      receipts: [{
        adapterVersion: 'assisted-owner-confirmed@1.0.0',
        campaignId: 'quick-sort-launch',
        channel: 'bilibili',
        contentHash: 'c'.repeat(64),
        idempotencyKey: 'idempotency',
        packageId: 'unknown-package',
        postId: '123',
        projectId: 'algorithm-visualizer',
        publicUrl: 'https://www.bilibili.com/opus/123456789',
        publishedAt: '2026-08-10T10:01:00.000Z',
        status: 'published',
      }],
    }))
    const client = createMarketingOpsPublishClient({ publishCampaign })
    await expect(client.publishCampaign(request)).rejects.toThrow(/package/i)
  })

  it('requires marketing-ops to return the exact Content Studio receipt provenance', async () => {
    const client = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [{
          campaignId: 'quick-sort-launch',
          channel: 'bilibili',
          contentHash: 'c'.repeat(64),
          idempotencyKey: 'idempotency',
          postId: '123',
          projectId: 'algorithm-visualizer',
          publicUrl: 'https://www.bilibili.com/opus/123456789',
          publishedAt: '2026-08-10T10:01:00.000Z',
          status: 'published',
        }],
      }),
    })
    await expect(client.publishCampaign(request)).rejects.toThrow(/identity|provenance/i)
  })

  it('parses a complete published receipt with the bound account', async () => {
    const requestWithAccount: MarketingOpsCampaignRequest = {
      ...request,
      packages: [{
        ...request.packages[0]!,
        contentStudio: {
          ...request.packages[0]!.contentStudio,
          accountRef: 'bilibili-main',
        },
      }],
    }
    const client = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [],
        limitations: ['owner-confirmed'],
        projectId: 'algorithm-visualizer',
        receipts: [{
          accountRef: 'bilibili-main',
          activityId: 'activity-quick-sort',
          campaignId: 'quick-sort-launch',
          channel: 'bilibili',
          contentFormat: 'image-text',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
          packageId: 'bilibili-image-text-zh',
          postId: '123',
          projectId: 'algorithm-visualizer',
          publicUrl: 'https://www.bilibili.com/opus/123456789',
          publicationId: 'bilibili-image-text-zh',
          publishedAt: '2026-08-10T10:01:00.000Z',
          receiptId: 'marketing-ops-receipt-1',
          status: 'published',
        }],
      }),
    })

    await expect(client.publishCampaign(requestWithAccount)).resolves.toMatchObject({
      limitations: ['owner-confirmed'],
      receipts: [{
        accountRef: 'bilibili-main',
        activityId: 'activity-quick-sort',
        publicUrl: 'https://www.bilibili.com/opus/123456789',
        receiptId: 'marketing-ops-receipt-1',
      }],
    })
  })

  it('requires and preserves Bilibili video orientation in handoffs and receipts', async () => {
    const videoRequest: MarketingOpsCampaignRequest = {
      ...request,
      execution: { mode: 'assisted-prepare' },
      packages: [{
        ...request.packages[0]!,
        contentStudio: {
          ...request.packages[0]!.contentStudio,
          artifactRefs: [{
            artifactId: 'video-zh',
            kind: 'video',
            locale: 'zh-CN',
            mediaKind: 'video',
            sha256: 'd'.repeat(64),
            version: 1,
          }],
          contentFormat: 'video',
          contentId: 'bilibili-video-zh-content',
          packageId: 'bilibili-video-zh',
          publicationId: 'bilibili-video-zh',
          videoOrientation: 'portrait',
        },
        variants: [{
          ...request.packages[0]!.variants[0]!,
          media: ['video'],
        }],
      }],
      spec: {
        ...request.spec,
        content: { ...request.spec.content, media: ['video'] },
      },
    }
    const prepareClient = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [{
          channel: 'bilibili',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          form: 'video',
          idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
          packageId: 'bilibili-video-zh',
          publicationId: 'bilibili-video-zh',
          status: 'awaiting-owner',
          videoOrientation: 'portrait',
        }],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [],
      }),
    })
    const prepared = await prepareClient.publishCampaign(videoRequest)
    expect(prepared.handoffs[0]?.videoOrientation).toBe('portrait')

    const confirmClient = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [{
          activityId: 'activity-quick-sort',
          campaignId: 'quick-sort-launch',
          channel: 'bilibili',
          contentFormat: 'video',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          idempotencyKey: 'idempotency',
          packageId: 'bilibili-video-zh',
          postId: 'BV1orientation',
          projectId: 'algorithm-visualizer',
          publicationId: 'bilibili-video-zh',
          publicUrl: 'https://www.bilibili.com/video/BV1orientation',
          publishedAt: '2026-08-10T10:01:00.000Z',
          receiptId: 'receipt-video-1',
          status: 'published',
          videoOrientation: 'portrait',
        }],
      }),
    })
    const confirmed = await confirmClient.publishCampaign({
      ...videoRequest,
      execution: {
        confirmations: [{
          channel: 'bilibili',
          form: 'video',
          packageId: 'bilibili-video-zh',
          publicationId: 'bilibili-video-zh',
          publicUrl: 'https://www.bilibili.com/video/BV1orientation',
        }],
        mode: 'assisted-confirm',
      },
    })
    expect(confirmed.receipts[0]?.videoOrientation).toBe('portrait')

    const mismatchedClient = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [{
          activityId: 'activity-quick-sort',
          campaignId: 'quick-sort-launch',
          channel: 'bilibili',
          contentFormat: 'video',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          idempotencyKey: 'idempotency',
          packageId: 'bilibili-video-zh',
          postId: 'BV1orientation',
          projectId: 'algorithm-visualizer',
          publicationId: 'bilibili-video-zh',
          publicUrl: 'https://www.bilibili.com/video/BV1orientation',
          publishedAt: '2026-08-10T10:01:00.000Z',
          receiptId: 'receipt-video-1',
          status: 'published',
          videoOrientation: 'landscape',
        }],
      }),
    })
    await expect(mismatchedClient.publishCampaign({
      ...videoRequest,
      execution: { mode: 'assisted-prepare' },
    })).rejects.toThrow(/orientation/i)
  })

  it('rejects a receipt or handoff whose account or Bilibili form differs from the locked package', async () => {
    const mismatchedReceipt = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [{
          accountRef: 'account-other',
          activityId: 'activity-quick-sort',
          campaignId: 'quick-sort-launch',
          channel: 'bilibili',
          contentFormat: 'image-text',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          idempotencyKey: 'idempotency',
          packageId: 'bilibili-image-text-zh',
          postId: '123',
          projectId: 'algorithm-visualizer',
          publicUrl: 'https://www.bilibili.com/opus/123456789',
          publicationId: 'bilibili-image-text-zh',
          publishedAt: '2026-08-10T10:01:00.000Z',
          status: 'published',
        }],
      }),
    })
    await expect(mismatchedReceipt.publishCampaign({
      ...request,
      packages: [{
        ...request.packages[0]!,
        contentStudio: {
          ...request.packages[0]!.contentStudio,
          accountRef: 'account-bilibili-main',
        },
      }],
    })).rejects.toThrow(/account/i)

    const mismatchedHandoff = createMarketingOpsPublishClient({
      publishCampaign: async () => ({
        campaignId: 'quick-sort-launch',
        failures: [],
        handoffs: [{
          channel: 'bilibili',
          contentHash: 'c'.repeat(64),
          contentStudioContentHash: 'b'.repeat(64),
          form: 'video',
          idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
          packageId: 'bilibili-image-text-zh',
          publicationId: 'bilibili-image-text-zh',
          status: 'awaiting-owner',
        }],
        limitations: [],
        projectId: 'algorithm-visualizer',
        receipts: [],
      }),
    })
    await expect(mismatchedHandoff.publishCampaign(request)).rejects.toThrow(/form/i)
  })

  it('never accepts text errors as a successful structured result', async () => {
    const publishCampaign = vi.fn(async () => ({
      isError: true,
      content: [{ type: 'text', text: 'failure' }],
    }))
    const client = createMarketingOpsPublishClient({ publishCampaign })
    await expect(client.publishCampaign(request)).rejects.toThrow(/failure/)
  })

  it('preserves transport failure details for assisted browser diagnostics', async () => {
    const client = createMarketingOpsPublishClient({
      publishCampaign: async () => {
        throw new Error('image paste timed out')
      },
    })
    await expect(client.publishCampaign(request)).rejects.toThrow(/image paste timed out/)

    const sensitiveClient = createMarketingOpsPublishClient({
      publishCampaign: async () => {
        throw new Error('Bearer private-token')
      },
    })
    await expect(sensitiveClient.publishCampaign(request)).rejects.toThrow(
      /^Marketing-ops publish failed$/,
    )
  })

  it('rejects malformed result envelopes and normalizes non-text failures safely', async () => {
    for (const content of [
      undefined,
      [null, [], { type: 'image', text: 'ignored' }, { type: 'text', text: '' }],
    ]) {
      await expect(publishReturned({ content, isError: true }))
        .rejects
        .toThrow(/^Marketing-ops publish failed$/)
    }
    await expect(publishReturned({
      content: [{ type: 'text', text: ' first ' }, { type: 'text', text: 'second' }],
      isError: true,
    })).rejects.toThrow(/first second/u)

    for (const malformed of [
      null,
      [],
      resultEnvelope({ unexpected: true }),
      resultEnvelope({ projectId: 'other-project' }),
      resultEnvelope({ campaignId: 'other-campaign' }),
      resultEnvelope({ receipts: null }),
      resultEnvelope({ failures: null }),
      resultEnvelope({ handoffs: null }),
    ]) {
      await expect(publishReturned(malformed)).rejects.toThrow(/schema|scope/i)
    }
    await expect(publishReturned(resultEnvelope({ limitations: null }))).resolves.toMatchObject({
      limitations: [],
    })
    await expect(publishReturned(resultEnvelope({ limitations: ['kept', 1, null] }))).resolves.toMatchObject({
      limitations: ['kept'],
    })
  })

  it('validates every locked receipt boundary and accepts a failed receipt without a public URL', async () => {
    const invalidCases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['project', { projectId: 'other-project' }, /scope/i],
      ['campaign', { campaignId: 'other-campaign' }, /scope/i],
      ['channel', { channel: 'youtube' }, /channel|package/i],
      ['status', { status: 'pending' }, /status/i],
      ['URL type', { publicUrl: 1 }, /URL/i],
      ['URL syntax', { publicUrl: 'not-a-url' }, /URL/i],
      ['URL protocol', { publicUrl: 'http://www.bilibili.com/opus/123456789' }, /URL/i],
      ['URL credentials', { publicUrl: 'https://owner:secret@www.bilibili.com/opus/123456789' }, /sensitive|URL/i],
      ['URL fragment', { publicUrl: 'https://www.bilibili.com/opus/123456789#secret' }, /URL/i],
      ['timestamp missing', { publishedAt: undefined }, /timestamp/i],
      ['timestamp invalid', { publishedAt: 'not-a-date' }, /timestamp/i],
      ['post identity', { postId: undefined, idempotencyKey: undefined }, /identity/i],
      ['package', { packageId: 'other-package' }, /package/i],
      ['publication', { publicationId: 'other-publication' }, /provenance/i],
      ['activity', { activityId: 'other-activity' }, /provenance/i],
      ['content hash missing', { contentHash: undefined }, /content hash/i],
      ['content hash malformed', { contentHash: 'bad' }, /content hash/i],
      ['source hash missing', { contentStudioContentHash: undefined }, /source content hash/i],
      ['source hash mismatch', { contentStudioContentHash: 'd'.repeat(64) }, /source content hash/i],
      ['form', { contentFormat: 'video' }, /form/i],
      ['orientation syntax', { videoOrientation: 'diagonal' }, /orientation/i],
      ['unexpected orientation', { videoOrientation: 'landscape' }, /orientation/i],
      ['account type', { accountRef: 1 }, /account/i],
      ['account mismatch', { accountRef: 'other-account' }, /account/i],
    ]
    for (const [_name, override, message] of invalidCases) {
      await expect(publishReturned(resultEnvelope({ receipts: [receiptEnvelope(override)] })))
        .rejects
        .toThrow(message)
    }

    await expect(publishReturned(resultEnvelope({
      receipts: [receiptEnvelope({
        idempotencyKey: 'fallback-receipt-id',
        publicUrl: undefined,
        receiptId: undefined,
        status: 'failed',
      })],
    }))).resolves.toMatchObject({
      receipts: [{ publicUrl: undefined, receiptId: 'fallback-receipt-id', status: 'failed' }],
    })
  })

  it('validates failure and handoff identities without accepting ambiguous package mappings', async () => {
    const validFailure = {
      channel: 'bilibili',
      code: 'OWNER_ACTION_REQUIRED',
      message: 'Owner action is required',
      packageId: 'bilibili-image-text-zh',
      retryable: false,
    }
    await expect(publishReturned(resultEnvelope({ failures: [validFailure] }))).resolves.toMatchObject({
      failures: [{ code: 'OWNER_ACTION_REQUIRED', retryable: false }],
    })
    for (const override of [
      { channel: 'youtube' },
      { code: undefined },
      { message: undefined },
      { retryable: 'false' },
    ]) {
      await expect(publishReturned(resultEnvelope({ failures: [{ ...validFailure, ...override }] })))
        .rejects
        .toThrow(/channel|schema|package/i)
    }

    await expect(publishReturned(resultEnvelope({
      handoffs: [handoffEnvelope({ nextAction: undefined, status: 'confirmed' })],
    }))).resolves.toMatchObject({
      handoffs: [{ status: 'confirmed' }],
    })
    const invalidHandoffs: Array<[Record<string, unknown>, RegExp]> = [
      [{ status: 'published' }, /status/i],
      [{ contentHash: 'bad' }, /identity/i],
      [{ contentStudioContentHash: undefined }, /identity/i],
      [{ contentStudioContentHash: 'd'.repeat(64) }, /identity/i],
      [{ idempotencyKey: undefined }, /identity/i],
      [{ idempotencyKey: 'bad key' }, /identity/i],
      [{ form: 'video' }, /form/i],
      [{ videoOrientation: 'square' }, /orientation/i],
    ]
    for (const [override, message] of invalidHandoffs) {
      await expect(publishReturned(resultEnvelope({ handoffs: [handoffEnvelope(override)] })))
        .rejects
        .toThrow(message)
    }

    await expect(publishReturned(resultEnvelope({ handoffs: [{ ...handoffEnvelope(), packageId: undefined, channel: undefined }] })))
      .resolves
      .toMatchObject({ handoffs: [{ packageId: 'bilibili-image-text-zh' }] })
    await expect(publishReturned(resultEnvelope({ handoffs: [handoffEnvelope({ packageId: 'missing' })] })))
      .rejects
      .toThrow(/mapped|package/i)
  })
})
