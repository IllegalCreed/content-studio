import type { CampaignSpec, ProjectManifest } from '../types'
import { describe, expect, it } from 'vitest'
import { generateContentPackages } from './generate'

const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: 'algorithm-visualizer',
  name: 'Algorithm Visualizer',
  canonicalUrl: 'https://algo.illegalscreed.cn/',
  repositoryUrl: 'https://github.com/IllegalCreed/algorithms-visualization',
  locales: ['zh-CN', 'en'],
  tagline: {
    'en': 'Learn algorithms through interactive animation.',
    'zh-CN': '通过交互动画学习算法。',
  },
  facts: [
    {
      id: 'catalog',
      text: {
        'en': 'Explore 95 English pages and interactive demos.',
        'zh-CN': '探索 95 个中文页面与交互式演示。',
      },
    },
  ],
  captureFlows: [],
}

const campaign: CampaignSpec = {
  schemaVersion: 1,
  campaignId: 'quick-sort-launch',
  topic: {
    'en': 'Understand quick sort partitioning',
    'zh-CN': '看懂快速排序的分区过程',
  },
  goal: 'education',
  targetUrl: 'https://algo.illegalscreed.cn/quick-sort/',
  highlights: ['catalog'],
  tags: ['algorithms', 'visualization'],
  channels: [
    {
      id: 'x',
      locale: 'en',
    },
    {
      id: 'zhihu',
      locale: 'zh-CN',
    },
    {
      id: 'youtube',
      locale: 'en',
    },
  ],
}

describe('content generation', () => {
  it('generates deterministic platform-native packages from current project facts', () => {
    const first = generateContentPackages(project, campaign)
    const second = generateContentPackages(project, campaign)

    expect(first).toEqual(second)
    expect(first).toHaveLength(3)
    expect(first[0]).toMatchObject({
      channel: 'x',
      delivery: 'owner-assisted',
      locale: 'en',
    })
    expect(first[0]!.body.length).toBeLessThanOrEqual(280)
    expect(first[1]!.body).toContain('探索 95 个中文页面')
    expect(first[2]).toMatchObject({
      channel: 'youtube',
      format: 'video-metadata',
    })
    expect(first.every(item => item.targetUrl === campaign.targetUrl)).toBe(true)
  })

  it('preserves the target URL while fitting long short-form content', () => {
    const tags = Array.from({
      length: 20,
    }, (_, index) => `tag-${index}`)
    const packages = generateContentPackages(
      {
        ...project,
        tagline: {
          'en': 'A'.repeat(400),
          'zh-CN': '长'.repeat(400),
        },
        facts: [
          {
            id: 'catalog',
            text: {
              'en': 'B'.repeat(400),
              'zh-CN': '事实'.repeat(200),
            },
          },
        ],
      },
      {
        ...campaign,
        topic: {
          'en': 'C'.repeat(200),
          'zh-CN': '主题'.repeat(100),
        },
        tags,
        channels: [
          {
            id: 'x',
            locale: 'en',
          },
        ],
      },
    )

    expect(packages[0]!.title).toHaveLength(70)
    expect(packages[0]!.body.length).toBeLessThanOrEqual(280)
    expect(packages[0]!.body).toContain(campaign.targetUrl)
    expect(packages[0]!.body).toContain('…')
  })

  it('generates one independent package for each selected channel form', () => {
    const packages = generateContentPackages(project, {
      ...campaign,
      channels: [{
        contentFormats: ['video-metadata', 'image-text'],
        id: 'bilibili',
        locale: 'zh-CN',
      }],
    })

    expect(packages).toHaveLength(2)
    expect(packages.map(packageItem => packageItem.format)).toEqual([
      'video-metadata',
      'image-text',
    ])
    expect(packages.every(packageItem => packageItem.channel === 'bilibili'))
      .toBe(true)
  })
})
