// @env node

import type { MarketingOpsPublicationPackage } from '../types'
import type { MarketingOpsCampaignRequestInput } from './publish'
import { describe, expect, it } from 'vitest'
import {
  buildMarketingOpsCampaignRequest,
  createMarketingOpsCampaignSpec,
} from './publish'

const packageValue: MarketingOpsPublicationPackage = {
  activityId: 'activity-quick-sort',
  artifactRefs: [{
    artifactId: 'cover-zh',
    kind: 'image',
    locale: 'zh-CN',
    mediaKind: 'image',
    sha256: 'a'.repeat(64),
    version: 2,
  }],
  body: '快速排序演示 https://algo.example/zh/quick-sort/',
  campaignId: 'quick-sort-launch',
  channel: 'bilibili',
  contentFormat: 'image-text',
  contentHash: 'b'.repeat(64),
  contentId: 'bilibili-image-text-zh',
  contentVersion: 3,
  locale: 'zh-CN',
  packageId: 'bilibili-image-text-zh',
  projectId: 'algorithm-visualizer',
  publicationId: 'bilibili-image-text-zh',
  renderer: {
    canonicalUrl: 'https://algo.example/zh/quick-sort/',
    format: 'manual-package',
    links: ['https://algo.example/zh/quick-sort/'],
    media: ['image'],
    utmMedium: 'social',
  },
  schemaVersion: 1,
  title: '快速排序可视化',
}

function input(
  overrides: Partial<MarketingOpsCampaignRequestInput> = {},
): MarketingOpsCampaignRequestInput {
  return {
    authorization: {
      authorizedAt: '2026-08-10T10:00:00.000Z',
      source: 'owner-prompt',
    },
    campaignId: 'quick-sort-launch',
    execution: { mode: 'assisted-prepare' },
    idempotencyKey: 'campaign-v4/algorithm-visualizer/quick-sort-launch/12345678',
    packages: [packageValue],
    spec: {
      campaign: 'quick-sort-launch',
      content: {
        media: ['image'],
        variants: {
          'zh-CN': {
            angle: '演示排序过程',
            callToAction: '打开演示',
            title: packageValue.title,
          },
        },
      },
      channels: ['bilibili'],
      failureMode: 'continue-supported',
      id: 'quick-sort-launch',
      locales: ['zh-CN'],
      publishAt: '2026-08-10T10:00:00.000Z',
      replies: { createBugIssues: false, mode: 'off' },
      schemaVersion: 1,
      targetUrls: [packageValue.renderer.canonicalUrl],
      topic: '快速排序可视化',
    },
    ...overrides,
  }
}

describe('marketing-ops publish bridge', () => {
  it('derives the non-authorizing campaign metadata from locked packages', () => {
    expect(createMarketingOpsCampaignSpec([packageValue], {
      now: () => new Date('2026-08-10T10:00:00.000Z'),
    })).toEqual({
      campaign: 'quick-sort-launch',
      channels: ['bilibili'],
      content: {
        media: ['image'],
        variants: {
          'zh-CN': {
            angle: packageValue.body,
            callToAction: '查看详情',
            title: packageValue.title,
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
    })
  })

  it('serializes Content Studio packages without paths or credentials', () => {
    const request = buildMarketingOpsCampaignRequest(input())

    expect(request).toMatchObject({
      campaignId: 'quick-sort-launch',
      projectId: 'algorithm-visualizer',
      execution: { mode: 'assisted-prepare' },
      packages: [{
        channel: 'bilibili',
        format: 'manual-package',
        contentStudio: {
          activityId: 'activity-quick-sort',
          artifactRefs: [{ artifactId: 'cover-zh', sha256: 'a'.repeat(64) }],
          contentFormat: 'image-text',
          packageId: 'bilibili-image-text-zh',
          publicationId: 'bilibili-image-text-zh',
          schemaVersion: 1,
        },
      }],
    })
    const serialized = JSON.stringify(request)
    expect(serialized).not.toMatch(/relativePath|password|token|cookie/i)
    expect(serialized).not.toContain('/Users')
  })

  it('echoes Bilibili video orientation into Content Studio provenance', () => {
    const videoPackage: MarketingOpsPublicationPackage = {
      ...packageValue,
      artifactRefs: [{
        artifactId: 'video-zh',
        kind: 'video',
        locale: 'zh-CN',
        mediaKind: 'video',
        sha256: 'd'.repeat(64),
        version: 1,
      }],
      body: '观看视频 https://algo.example/zh/quick-sort/video',
      contentFormat: 'video',
      contentHash: 'e'.repeat(64),
      contentId: 'bilibili-video-zh',
      packageId: 'bilibili-video-zh',
      publicationId: 'bilibili-video-zh',
      renderer: {
        ...packageValue.renderer,
        canonicalUrl: 'https://algo.example/zh/quick-sort/video',
        links: ['https://algo.example/zh/quick-sort/video'],
        media: ['video'],
      },
      title: '快速排序视频',
      videoOrientation: 'portrait',
    }
    const videoSpec = {
      ...input().spec,
      content: {
        ...input().spec.content,
        media: ['video' as const],
        variants: {
          'zh-CN': {
            angle: '观看排序过程',
            callToAction: '打开视频',
            title: videoPackage.title,
          },
        },
      },
      targetUrls: [videoPackage.renderer.canonicalUrl],
      topic: videoPackage.title,
    }
    const request = buildMarketingOpsCampaignRequest(input({
      packages: [videoPackage],
      spec: videoSpec,
    }))
    expect(request.packages[0]?.contentStudio.videoOrientation).toBe('portrait')
    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{ ...videoPackage, videoOrientation: undefined }],
      spec: videoSpec,
    }))).toThrow(/orientation/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{ ...videoPackage, videoOrientation: 'square' }],
      spec: videoSpec,
    }))).toThrow(/landscape|portrait/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{ ...videoPackage, videoOrientation: 'diagonal' as never }],
      spec: videoSpec,
    }))).toThrow(/orientation is invalid/i)
    const genericVideoPackage = { ...videoPackage, channel: 'youtube' as const, videoOrientation: 'square' as const }
    expect(buildMarketingOpsCampaignRequest(input({
      packages: [genericVideoPackage],
      spec: { ...videoSpec, channels: ['youtube'] },
    })).packages[0]?.contentStudio.videoOrientation).toBe('square')

    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{ ...packageValue, videoOrientation: 'portrait' }],
    }))).toThrow(/non-video.*orientation/i)
  })

  it('keeps multiple Bilibili forms as distinct packages and confirmations', () => {
    const second: MarketingOpsPublicationPackage = {
      ...packageValue,
      artifactRefs: [],
      body: '动态文本 https://algo.example/zh/quick-sort/',
      contentFormat: 'short-post',
      contentHash: 'c'.repeat(64),
      contentId: 'bilibili-dynamic-zh',
      contentVersion: 1,
      packageId: 'bilibili-dynamic-zh',
      publicationId: 'bilibili-dynamic-zh',
      renderer: { ...packageValue.renderer, media: [] },
      title: '排序动态',
    }
    const request = buildMarketingOpsCampaignRequest(input({
      packages: [packageValue, second],
      spec: {
        ...input().spec,
        content: {
          ...input().spec.content,
          variants: {
            ...input().spec.content.variants,
            'zh-CN': {
              angle: '演示排序过程',
              callToAction: '打开演示',
              title: packageValue.title,
            },
          },
        },
      },
    }))

    expect(request.packages).toHaveLength(2)
    expect(request.packages.map(item => item.contentStudio.packageId)).toEqual([
      'bilibili-image-text-zh',
      'bilibili-dynamic-zh',
    ])
  })

  it('rejects package/spec/project drift before transport', () => {
    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [packageValue, { ...packageValue, packageId: 'other-package', publicationId: 'other-publication', projectId: 'other-project' }],
    }))).toThrow(/project/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      spec: { ...input().spec, channels: ['github'] },
    }))).toThrow(/channel/i)
  })

  it('fails closed for invalid media, confirmation, URL, and clock inputs', () => {
    expect(() => createMarketingOpsCampaignSpec([])).toThrow(/at least one/i)
    expect(() => createMarketingOpsCampaignSpec([packageValue], {
      now: () => new Date('invalid'),
    })).toThrow(/clock/i)

    expect(() => buildMarketingOpsCampaignRequest(input({
      authorization: {
        authorizedAt: 'not-a-date',
        source: 'owner-prompt',
      },
    }))).toThrow(/authorization/i)

    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{
        ...packageValue,
        renderer: {
          ...packageValue.renderer,
          canonicalUrl: 'http://algo.example/zh/quick-sort/',
        },
      }],
      spec: {
        ...input().spec,
        targetUrls: ['http://algo.example/zh/quick-sort/'],
      },
    }))).toThrow(/HTTPS/i)

    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [{
        ...packageValue,
        renderer: { ...packageValue.renderer, media: ['video'] },
      }],
      spec: {
        ...input().spec,
        content: { ...input().spec.content, media: ['video'] },
      },
    }))).toThrow(/resolved artifact/i)

    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: {
        confirmations: [{
          channel: 'bilibili',
          form: 'video',
          packageId: packageValue.packageId,
          publicUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
          publicationId: packageValue.publicationId,
        }],
        mode: 'assisted-confirm',
      },
    }))).toThrow(/confirmation/i)

    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: { confirmations: [], mode: 'assisted-confirm' },
    }))).toThrow(/confirmations must match/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: {
        confirmations: [{
          channel: 'bilibili',
          form: 'image-text',
          packageId: 'unknown-package',
          publicationId: 'unknown-publication',
          publicUrl: 'https://www.bilibili.com/opus/123456789',
        }],
        mode: 'assisted-confirm',
      },
    }))).toThrow(/unknown/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: {
        confirmations: [{
          channel: 'bilibili',
          form: 'image-text',
          packageId: packageValue.packageId,
          publicationId: packageValue.publicationId,
          publicUrl: 'not-a-url',
        }],
        mode: 'assisted-confirm',
      },
    }))).toThrow(/HTTPS/i)
    const secondPackage: MarketingOpsPublicationPackage = {
      ...packageValue,
      contentHash: 'c'.repeat(64),
      contentId: 'bilibili-image-text-zh-2',
      packageId: 'bilibili-image-text-zh-2',
      publicationId: 'bilibili-image-text-zh-2',
    }
    expect(() => buildMarketingOpsCampaignRequest(input({
      packages: [packageValue, secondPackage],
      execution: {
        confirmations: [
          {
            channel: 'bilibili',
            form: 'image-text',
            packageId: packageValue.packageId,
            publicationId: packageValue.publicationId,
            publicUrl: 'https://www.bilibili.com/opus/123456789',
          },
          {
            channel: 'bilibili',
            form: 'image-text',
            packageId: packageValue.packageId,
            publicationId: packageValue.publicationId,
            publicUrl: 'https://www.bilibili.com/opus/987654321',
          },
        ],
        mode: 'assisted-confirm',
      },
    }))).toThrow(/unique/i)
  })

  it('keeps the optional account and a valid confirmation when cloning a request', () => {
    const rendered = buildMarketingOpsCampaignRequest(input({
      execution: {
        confirmations: [{
          channel: 'bilibili',
          form: 'image-text',
          packageId: packageValue.packageId,
          publicUrl: 'https://www.bilibili.com/opus/123456',
          publicationId: packageValue.publicationId,
        }],
        mode: 'assisted-confirm',
      },
      packages: [{ ...packageValue, accountRef: 'bilibili-main' }],
      spec: {
        ...input().spec,
        content: {
          ...input().spec.content,
          variants: {
            ...input().spec.content.variants,
            en: undefined,
          },
        },
      },
    }))

    expect(rendered).toMatchObject({
      execution: {
        confirmations: [{ packageId: packageValue.packageId }],
        mode: 'assisted-confirm',
      },
      packages: [{ contentStudio: { accountRef: 'bilibili-main' } }],
    })
  })

  it('clones abandonment only for one account-bound Bilibili package', () => {
    const abandoned = buildMarketingOpsCampaignRequest(input({
      execution: { mode: 'assisted-abandon' },
      packages: [{ ...packageValue, accountRef: 'account.bilibili.synthetic-owner' }],
    }))

    expect(abandoned).toMatchObject({
      execution: { mode: 'assisted-abandon' },
      packages: [{ contentStudio: { accountRef: 'account.bilibili.synthetic-owner' } }],
    })
    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: { mode: 'assisted-abandon' },
    }))).toThrow(/abandonment.*account/i)
    expect(() => buildMarketingOpsCampaignRequest(input({
      execution: { mode: 'assisted-abandon' },
      packages: [
        { ...packageValue, accountRef: 'account.bilibili.synthetic-owner' },
        {
          ...packageValue,
          accountRef: 'account.bilibili.synthetic-owner',
          contentHash: 'c'.repeat(64),
          contentId: 'second-content',
          packageId: 'second-package',
          publicationId: 'second-publication',
        },
      ],
    }))).toThrow(/abandonment.*one/i)
  })
})
