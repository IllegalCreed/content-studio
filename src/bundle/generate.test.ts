import type { CampaignSpec, ProjectManifest } from '../types'
import { describe, expect, it } from 'vitest'
import { generateStudioBundle } from './generate'

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
  facts: [],
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
  highlights: [],
  tags: ['algorithms'],
  channels: [
    {
      id: 'github',
      locale: 'en',
    },
  ],
}

describe('studio bundle', () => {
  it('contains validated content and an optional video plan without timestamps', () => {
    const bundle = generateStudioBundle(project, campaign)

    expect(bundle).toMatchObject({
      bundleVersion: 1,
      campaignId: 'quick-sort-launch',
      projectId: 'algorithm-visualizer',
      videoPlan: null,
    })
    expect(bundle.contentPackages).toHaveLength(1)
    expect(bundle).not.toHaveProperty('generatedAt')
  })
})
