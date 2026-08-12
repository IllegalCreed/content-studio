import type {
  ActivityArtifact,
  ChannelContent,
  MarketingOpsPublicationPackageInput,
  ProjectSnapshot,
  PublishingActivity,
} from '../types'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  compileMarketingOpsPublicationPackage,
  compileMarketingOpsPublicationPackages,
} from './package'

const projectId = 'package-project'
const activityId = 'package-activity'
const origin = 'https://package.example.com'

function snapshot(): ProjectSnapshot {
  return {
    manifest: {
      canonicalUrl: `${origin}/`,
      captureFlows: [],
      facts: [],
      locales: ['en', 'zh-CN'],
      name: 'Package project',
      projectId,
      repositoryUrl: 'https://github.com/example/package-project',
      schemaVersion: 1,
      tagline: { 'en': 'A package project', 'zh-CN': '素材项目' },
    },
    projectId,
    snapshotId: 'package-snapshot-1',
    version: 1,
  }
}

function activity(): PublishingActivity {
  return {
    activityId,
    campaignId: 'package-campaign',
    channels: [
      { contentFormats: ['article'], id: 'github', locale: 'en' },
      { contentFormats: ['image-text'], id: 'bilibili', locale: 'zh-CN' },
      { contentFormats: ['image-text', 'short-post'], id: 'bilibili', locale: 'en' },
    ],
    goal: 'launch',
    projectId,
    projectSnapshotId: 'package-snapshot-1',
    status: 'draft',
    targetUrl: `${origin}/quick-sort/`,
    topic: { 'en': 'Quick Sort', 'zh-CN': '快速排序' },
    version: 1,
  }
}

function content(overrides: Partial<ChannelContent> = {}): ChannelContent {
  return {
    activityId,
    artifactIds: ['article-en'],
    body: `Read the guide at ${origin}/en/quick-sort/`,
    channel: 'github',
    contentGroupId: 'package-group',
    contentId: 'github-en-content',
    format: 'article',
    locale: 'en',
    projectId,
    title: 'Quick Sort visualization',
    version: 2,
    ...overrides,
  }
}

function artifact(
  artifactId: string,
  kind: ActivityArtifact['kind'],
  relativePath: string,
  locale?: ActivityArtifact['locale'],
): ActivityArtifact {
  return {
    activityId,
    artifactId,
    kind,
    projectId,
    relativePath,
    sha256: createHash('sha256').update(artifactId).digest('hex'),
    version: 1,
    ...(locale === undefined ? {} : { locale }),
  }
}

function renderer(
  overrides: Partial<MarketingOpsPublicationPackageInput['renderer']> = {},
) {
  return {
    canonicalUrl: `${origin}/en/quick-sort/`,
    format: 'release' as const,
    links: [`${origin}/en/quick-sort/`],
    media: [] as Array<'image' | 'gif' | 'video'>,
    utmMedium: 'community' as const,
    ...overrides,
  }
}

function input(overrides: Partial<MarketingOpsPublicationPackageInput> = {}): MarketingOpsPublicationPackageInput {
  const currentActivity = activity()
  const currentContent = content()
  return {
    activity: currentActivity,
    artifacts: [artifact('article-en', 'article-version', 'articles/en.md')],
    content: currentContent,
    publication: {
      activityId,
      channel: 'github',
      contentId: currentContent.contentId,
      projectId,
      publicationId: 'github-en-publication',
    },
    renderer: renderer(),
    snapshot: snapshot(),
    ...overrides,
  }
}

describe('marketing-ops publication package compiler', () => {
  it('compiles an English GitHub package with immutable artifact references', () => {
    const compiled = compileMarketingOpsPublicationPackage(input())

    expect(compiled).toMatchObject({
      activityId,
      campaignId: 'package-campaign',
      channel: 'github',
      contentFormat: 'article',
      contentId: 'github-en-content',
      contentVersion: 2,
      locale: 'en',
      packageId: 'github-en-publication',
      projectId,
      publicationId: 'github-en-publication',
      schemaVersion: 1,
      title: 'Quick Sort visualization',
    })
    expect(compiled.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(compiled.artifactRefs).toEqual([{
      artifactId: 'article-en',
      kind: 'article-version',
      locale: 'neutral',
      sha256: expect.any(String),
      version: 1,
    }])
    expect(compiled.artifactRefs[0]).not.toHaveProperty('relativePath')
    expect(compileMarketingOpsPublicationPackage(input()).contentHash)
      .toBe(compiled.contentHash)
  })

  it('keeps Chinese Bilibili image-text media and locale in the package', () => {
    const currentContent = content({
      artifactIds: ['article-zh', 'demo-gif'],
      body: `快速排序演示：${origin}/zh/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-zh-content',
      format: 'image-text',
      locale: 'zh-CN',
      title: '快速排序可视化',
      version: 3,
    })
    const compiled = compileMarketingOpsPublicationPackage(input({
      artifacts: [
        artifact('article-zh', 'article-version', 'articles/zh-CN.md', 'zh-CN'),
        artifact('demo-gif', 'image', 'media/quick-sort.gif', 'zh-CN'),
        artifact('bilibili-cover-image-text-zh-v2', 'image', 'media/quick-sort-cover-image-text-v2.png', 'zh-CN'),
      ],
      content: currentContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: currentContent.contentId,
        projectId,
        publicationId: 'bilibili-zh-image-text',
      },
      renderer: renderer({
        canonicalUrl: `${origin}/zh/quick-sort/`,
        format: 'manual-package',
        links: [`${origin}/zh/quick-sort/`],
        media: ['gif'],
        utmMedium: 'social',
      }),
    }))

    expect(compiled).toMatchObject({
      channel: 'bilibili',
      contentFormat: 'image-text',
      locale: 'zh-CN',
      packageId: 'bilibili-zh-image-text',
      renderer: { format: 'manual-package', media: ['gif'], utmMedium: 'social' },
    })
    expect(compiled.artifactRefs.map(reference => reference.locale))
      .toEqual(['zh-CN', 'zh-CN', 'zh-CN'])
    expect(compiled.artifactRefs.find(reference => reference.artifactId === 'demo-gif'))
      .toMatchObject({ mediaKind: 'gif' })
    expect(compiled.artifactRefs.find(reference => reference.artifactId === 'bilibili-cover-image-text-zh-v2'))
      .toMatchObject({ mediaKind: 'image' })
  })

  it('derives and locks Bilibili video orientation from the activity video plan', () => {
    const currentContent = content({
      artifactIds: ['video-en'],
      body: `Watch the video at ${origin}/en/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-en-video',
      format: 'video',
    })
    const currentActivity = {
      ...activity(),
      channels: [
        ...activity().channels.map(channel =>
          channel.id === 'bilibili' && channel.locale === 'en'
            ? {
                ...channel,
                contentFormats: [...(channel.contentFormats ?? []), 'video-metadata' as const],
              }
            : channel,
        ),
      ],
      video: { flowIds: [], format: 'landscape' as const },
    }
    const baseInput = input({
      activity: currentActivity,
      artifacts: [
        artifact('video-en', 'video', 'media/quick-sort.mp4', 'en'),
        artifact('bilibili-cover-video-16x9-en-v2', 'image', 'media/bilibili-cover-video-16x9-v2.png', 'en'),
        artifact('bilibili-cover-video-4x3-en-v2', 'image', 'media/bilibili-cover-video-4x3-v2.png', 'en'),
      ],
      content: currentContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: currentContent.contentId,
        projectId,
        publicationId: 'bilibili-en-video',
      },
      renderer: renderer({
        format: 'manual-package',
        media: ['video'],
        utmMedium: 'social',
      }),
    })

    const compiled = compileMarketingOpsPublicationPackage(baseInput)
    expect(compiled.videoOrientation).toBe('landscape')
    expect(compiled.artifactRefs.map(reference => reference.artifactId)).toEqual([
      'video-en',
      'bilibili-cover-video-16x9-en-v2',
      'bilibili-cover-video-4x3-en-v2',
    ])
    expect(compiled.renderer.media).toEqual(['video'])
    expect(compiled.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(compileMarketingOpsPublicationPackage({
      ...baseInput,
      activity: {
        ...currentActivity,
        video: {
          flowIds: [],
          format: 'landscape',
          recordingProfile: {
            channelVariants: {
              bilibili: { format: 'portrait' },
            },
          },
        },
      },
    }).videoOrientation).toBe('portrait')
    expect(compileMarketingOpsPublicationPackage({
      ...baseInput,
      activity: { ...currentActivity, video: { flowIds: [], format: 'portrait' } },
    }).contentHash).not.toBe(compiled.contentHash)
    expect(() => compileMarketingOpsPublicationPackage({
      ...baseInput,
      activity: { ...currentActivity, video: undefined },
    })).toThrow(/orientation/i)
    expect(() => compileMarketingOpsPublicationPackage({
      ...baseInput,
      activity: { ...currentActivity, video: { flowIds: [], format: 'square' } },
    })).toThrow(/landscape|portrait/i)
    expect(() => compileMarketingOpsPublicationPackage({
      ...baseInput,
      artifacts: [
        artifact('video-en', 'video', 'media/quick-sort.mp4', 'en'),
        artifact('bilibili-cover-video-16x9-en-v2', 'image', 'media/bilibili-cover-video-16x9-v2.png', 'en'),
      ],
    })).toThrow(/4:3|cover/i)
  })

  it('prefers the dedicated Bilibili image-text cover over an older generic cover', () => {
    const currentContent = content({
      artifactIds: ['article-zh', 'demo-gif'],
      body: `中文说明：${origin}/zh/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-zh-cover-preference',
      format: 'image-text',
      locale: 'zh-CN',
    })
    const compiled = compileMarketingOpsPublicationPackage(input({
      artifacts: [
        artifact('article-zh', 'article-version', 'articles/zh.md', 'zh-CN'),
        artifact('demo-gif', 'image', 'media/quick-sort.gif', 'zh-CN'),
        artifact('bilibili-quick-sort-cover-zh', 'image', 'media/quick-sort-cover.png', 'zh-CN'),
        artifact('bilibili-cover-image-text-zh-v2', 'image', 'media/quick-sort-cover-image-text-v2.png', 'zh-CN'),
      ],
      content: currentContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: currentContent.contentId,
        projectId,
        publicationId: 'bilibili-zh-cover-preference',
      },
      renderer: renderer({
        canonicalUrl: `${origin}/zh/quick-sort/`,
        format: 'manual-package',
        links: [`${origin}/zh/quick-sort/`],
        media: ['gif'],
        utmMedium: 'social',
      }),
    }))
    expect(compiled.artifactRefs.at(-1)?.artifactId)
      .toBe('bilibili-cover-image-text-zh-v2')
  })

  it('locks selected Bilibili cover slots and ignores ineligible auxiliary artifacts', () => {
    const currentContent = content({
      artifactIds: ['video-en', 'selected-cover-landscape', 'selected-cover-4x3'],
      body: `Watch the video at ${origin}/en/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-selected-video',
      format: 'video',
    })
    const currentActivity = {
      ...activity(),
      channels: activity().channels.map(channel =>
        channel.id === 'bilibili' && channel.locale === 'en'
          ? { ...channel, contentFormats: [...(channel.contentFormats ?? []), 'video-metadata' as const] }
          : channel),
      video: { flowIds: [], format: 'landscape' as const },
    }
    const compiled = compileMarketingOpsPublicationPackage(input({
      activity: currentActivity,
      artifacts: [
        artifact('video-en', 'video', 'media/quick-sort.mp4', 'en'),
        artifact('selected-cover-landscape', 'image', 'media/selected-cover-landscape.png', 'en'),
        artifact('selected-cover-4x3', 'image', 'media/selected-cover-4x3.png', 'en'),
        artifact('selected-cover-landscape', 'image', 'media/old-cover-landscape.png', 'en'),
        artifact('ignored-cover-image-text', 'article-version', 'media/ignored-cover-image-text.png', 'en'),
        artifact('foreign-cover-image-text', 'image', 'media/foreign-cover-image-text.png', 'zh-CN'),
      ].map((value, index) => index === 3 ? { ...value, version: 0 } : value),
      content: currentContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: currentContent.contentId,
        projectId,
        publicationId: 'bilibili-selected-video',
      },
      renderer: renderer({ format: 'manual-package', media: ['video', 'image'], utmMedium: 'social' }),
    }))

    expect(compiled.artifactRefs.map(reference => reference.artifactId)).toEqual([
      'video-en',
      'selected-cover-landscape',
      'selected-cover-4x3',
    ])
  })

  it('uses one generic image-text cover and rejects ambiguous selected or auxiliary covers', () => {
    const currentContent = content({
      artifactIds: ['article-en', 'generic-cover'],
      body: `English image-text: ${origin}/en/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-generic-cover',
      format: 'image-text',
    })
    const base = input({
      artifacts: [
        artifact('article-en', 'article-version', 'articles/en.md', 'en'),
        artifact('generic-cover', 'image', 'media/generic-cover.png', 'en'),
      ],
      content: currentContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: currentContent.contentId,
        projectId,
        publicationId: 'bilibili-generic-cover',
      },
      renderer: renderer({ format: 'manual-package', media: ['image'], utmMedium: 'social' }),
    })
    expect(compileMarketingOpsPublicationPackage(base).artifactRefs.at(-1)?.artifactId)
      .toBe('generic-cover')

    expect(() => compileMarketingOpsPublicationPackage({
      ...base,
      content: { ...currentContent, artifactIds: ['article-en', 'cover-a', 'cover-b'] },
      artifacts: [
        artifact('article-en', 'article-version', 'articles/en.md', 'en'),
        artifact('cover-a', 'image', 'media/cover-a.png', 'en'),
        artifact('cover-b', 'image', 'media/cover-b.png', 'en'),
      ],
    })).toThrow(/exactly one.*cover/i)
    expect(() => compileMarketingOpsPublicationPackage({
      ...base,
      content: { ...currentContent, artifactIds: ['article-en'] },
      artifacts: [
        ...base.artifacts,
        artifact('another-generic-cover', 'image', 'media/another-generic-cover.png', 'en'),
      ],
    })).toThrow(/exactly one.*cover/i)
  })

  it('ignores Bilibili auxiliary covers for short posts and non-Bilibili packages', () => {
    const shortPost = content({
      artifactIds: [],
      body: `English post: ${origin}/en/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-short-post-cover-ignore',
      format: 'short-post',
    })
    expect(compileMarketingOpsPublicationPackage(input({
      artifacts: [artifact('unused-cover', 'image', 'media/unused-cover.png', 'en')],
      content: shortPost,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: shortPost.contentId,
        projectId,
        publicationId: 'bilibili-short-post-cover-ignore',
      },
      renderer: renderer({ format: 'manual-package', utmMedium: 'social' }),
    })).artifactRefs).toEqual([])

    expect(compileMarketingOpsPublicationPackage(input({
      artifacts: [
        artifact('article-en', 'article-version', 'articles/en.md'),
        artifact('unused-cover', 'image', 'media/unused-cover.png', 'en'),
      ],
    })).artifactRefs.map(reference => reference.artifactId)).toEqual(['article-en'])
  })

  it('allows multiple locales and forms for one channel in a batch', () => {
    const chineseContent = content({
      artifactIds: ['article-zh', 'cover-zh'],
      body: `中文说明：${origin}/zh/quick-sort/`,
      channel: 'bilibili',
      contentId: 'bilibili-zh-post',
      format: 'image-text',
      locale: 'zh-CN',
    })
    const chineseInput = input({
      artifacts: [
        artifact('article-zh', 'article-version', 'articles/zh.md', 'zh-CN'),
        artifact('cover-zh', 'image', 'media/cover-zh.png', 'zh-CN'),
      ],
      content: chineseContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: chineseContent.contentId,
        projectId,
        publicationId: 'bilibili-zh-post',
      },
      renderer: renderer({
        canonicalUrl: `${origin}/zh/quick-sort/`,
        format: 'manual-package',
        links: [`${origin}/zh/quick-sort/`],
        media: ['image'],
        utmMedium: 'social',
      }),
    })
    const englishInput = input({
      content: content({
        artifactIds: [],
        body: `English post: ${origin}/en/quick-sort/`,
        channel: 'bilibili',
        contentId: 'bilibili-en-post',
        format: 'short-post',
      }),
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: 'bilibili-en-post',
        projectId,
        publicationId: 'bilibili-en-post',
      },
      renderer: renderer({
        canonicalUrl: `${origin}/en/quick-sort/`,
        format: 'manual-package',
        links: [`${origin}/en/quick-sort/`],
        utmMedium: 'social',
      }),
    })
    const compiled = compileMarketingOpsPublicationPackages([chineseInput, englishInput])
    expect(compiled.map(packageValue => [packageValue.channel, packageValue.locale, packageValue.contentFormat]))
      .toEqual([
        ['bilibili', 'zh-CN', 'image-text'],
        ['bilibili', 'en', 'short-post'],
      ])
  })

  it('rejects locale drift, unresolved media, missing links, and foreign origins', () => {
    expect(() => compileMarketingOpsPublicationPackage(input({
      artifacts: [artifact('article-en', 'article-version', 'articles/zh.md', 'zh-CN')],
    }))).toThrow(/locale/i)

    const imageContent = content({
      artifactIds: ['article-en', 'cover'],
      channel: 'bilibili',
      contentId: 'bilibili-image-content',
      format: 'image-text',
    })
    expect(() => compileMarketingOpsPublicationPackage(input({
      artifacts: [
        artifact('article-en', 'article-version', 'articles/en.md'),
        artifact('cover', 'image', 'media/cover.png', 'en'),
      ],
      content: imageContent,
      publication: {
        activityId,
        channel: 'bilibili',
        contentId: imageContent.contentId,
        projectId,
        publicationId: 'bilibili-image-content',
      },
      renderer: renderer({
        canonicalUrl: `${origin}/en/quick-sort/`,
        format: 'manual-package',
        links: [`${origin}/en/quick-sort/`],
      }),
    }))).toThrow(/media/i)

    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ links: ['https://outside.example.com/page'] }),
    }))).toThrow(/origin|link/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ media: ['image', 'image', 'image', 'image'] }),
    }))).toThrow(/three media/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ media: ['image', 'image'] }),
    }))).toThrow(/unique/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ canonicalUrl: 'not-a-url' }),
    }))).toThrow(/valid URL/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ canonicalUrl: 'http://package.example.com/en/quick-sort/' }),
    }))).toThrow(/HTTPS/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      renderer: renderer({ links: [`https://user:password@${new URL(origin).host}/en/quick-sort/`] }),
    }))).toThrow(/credential/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      content: content({ body: 'No canonical link here' }),
    }))).toThrow(/link/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      artifacts: [{
        ...artifact('article-en', 'article-version', 'articles/en.md'),
        activityId: 'other-activity',
      }],
    }))).toThrow(/project and activity/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      content: content({ artifactIds: ['article-en', 'article-en'] }),
    }))).toThrow(/duplicate/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      content: content({ artifactIds: ['missing'] }),
    }))).toThrow(/not resolved/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      artifacts: [{
        ...artifact('article-en', 'article-version', 'articles/en.md'),
        sha256: 'invalid',
      }],
    }))).toThrow(/sha256/i)
    expect(() => compileMarketingOpsPublicationPackage(input({
      artifacts: [{
        ...artifact('article-en', 'article-version', 'articles/en.md'),
        version: 0,
      }],
    }))).toThrow(/positive version/i)
    expect(() => compileMarketingOpsPublicationPackages([input(), input()]))
      .toThrow(/duplicate.*package id/i)
  })
})
