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

describe('marketing-ops publish client', () => {
  it('passes only the validated campaign request to the transport and parses handoffs', async () => {
    const publishCampaign = vi.fn(async () => ({
      campaignId: 'quick-sort-launch',
      failures: [],
      handoffs: [{
        channel: 'bilibili',
        contentHash: 'c'.repeat(64),
        contentStudioContentHash: 'b'.repeat(64),
        form: 'image-text',
        idempotencyKey: 'campaign-v3/algorithm-visualizer/quick-sort-launch/bilibili/package/hash',
        nextAction: 'Publish this package in the official UI, then confirm its public URL.',
        packageId: 'bilibili-image-text-zh',
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
        form: 'image-text',
        packageId: 'bilibili-image-text-zh',
        publicationId: 'bilibili-image-text-zh',
        status: 'awaiting-owner',
      }],
      projectId: 'algorithm-visualizer',
    })
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
    await expect(client.publishCampaign(request)).rejects.toThrow(/failed/i)
  })
})
