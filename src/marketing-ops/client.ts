// @env node

import type {
  ChannelId,
  MarketingOpsPublicationReceipt,
  MarketingOpsPublicationRequest,
  PublicationReceipt,
} from '../types'

export interface MarketingOpsClient {
  /**
   * 真实实现由随附的 marketing-ops 运行时提供；Content Studio 不在这里执行渠道写入。
   */
  publish: (input: MarketingOpsPublicationRequest) => Promise<MarketingOpsPublicationReceipt>
}

export interface FakeMarketingOpsClientOptions {
  now?: () => Date
  publicOrigin?: string
}

/**
 * 仅用于本地契约测试的假适配器。它不启动浏览器、不读取凭据，也不连接任何渠道。
 */
export function createFakeMarketingOpsClient(
  options: FakeMarketingOpsClientOptions = {},
): MarketingOpsClient {
  const now = options.now ?? (() => new Date())
  const publicOrigin = options.publicOrigin ?? 'https://marketing-ops.invalid'
  return {
    publish: async (input) => {
      const issuedAt = now().toISOString()
      const externalReceiptId = `fixture-${input.publicationId}`
      return {
        accountRef: input.accountRef,
        activityId: input.activityId,
        channel: input.channel,
        contentSha256: input.contentSha256,
        externalReceiptId,
        issuedAt,
        projectId: input.projectId,
        publicationId: input.publicationId,
        publicUrl: `${publicOrigin}/${encodeURIComponent(input.publicationId)}`,
        receiptId: `marketing-ops-${input.publicationId}`,
        source: 'marketing-ops',
        status: 'published',
      }
    },
  }
}

export interface MarketingOpsReceiptMatch {
  accountRef?: string
  activityId: string
  channel: ChannelId
  projectId: string
  publicationId: string
}

export function assertMatchingMarketingOpsReceipt(
  receipt: PublicationReceipt,
  expected: MarketingOpsReceiptMatch,
): asserts receipt is MarketingOpsPublicationReceipt {
  if (receipt.source !== 'marketing-ops')
    throw new Error('Published receipt must come from marketing-ops')
  if (receipt.issuedAt === undefined || Number.isNaN(Date.parse(receipt.issuedAt)))
    throw new Error('marketing-ops receipt must include a valid issuedAt timestamp')
  if (
    receipt.projectId !== expected.projectId
    || receipt.activityId !== expected.activityId
    || receipt.publicationId !== expected.publicationId
    || receipt.channel !== expected.channel
  ) {
    throw new Error('marketing-ops receipt must match project, activity, publication, and channel')
  }
  if (expected.accountRef !== undefined && receipt.accountRef !== expected.accountRef)
    throw new Error('marketing-ops receipt must match the bound channel account')
}
