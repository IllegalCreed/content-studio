import type { CampaignSpec, ProjectManifest } from '../types'
import { describe, expect, it } from 'vitest'
import { compileVideoPlan } from './compile'

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
  captureFlows: [
    {
      id: 'quick-sort',
      title: {
        'en': 'Quick sort walkthrough',
        'zh-CN': '快速排序演示',
      },
      startPath: '/quick-sort',
      steps: [
        {
          kind: 'click',
          locator: {
            by: 'role',
            value: 'button',
            name: 'Start',
          },
        },
        {
          kind: 'capture',
          label: 'partition',
          durationMs: 2400,
        },
      ],
    },
  ],
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
      id: 'youtube',
      locale: 'en',
    },
  ],
  video: {
    flowIds: ['quick-sort'],
    format: 'landscape',
  },
}

describe('video plan compiler', () => {
  it('turns semantic project flows into a deterministic recording timeline', () => {
    expect(compileVideoPlan(project, campaign)).toMatchInlineSnapshot(`
      {
        "campaignId": "quick-sort-launch",
        "durationMs": 3000,
        "format": "landscape",
        "recordingConfig": {
          "colorScheme": "dark",
          "deviceScaleFactor": 1,
          "format": "landscape",
          "locale": "en",
          "outputSize": {
            "height": 1080,
            "width": 1920,
          },
          "viewport": {
            "height": 1080,
            "width": 1920,
          },
        },
        "scenes": [
          {
            "actions": [
              {
                "durationMs": 600,
                "kind": "click",
                "locator": {
                  "by": "role",
                  "name": "Start",
                  "value": "button",
                },
                "startMs": 0,
              },
              {
                "durationMs": 2400,
                "kind": "capture",
                "label": "partition",
                "startMs": 600,
              },
            ],
            "id": "quick-sort",
            "startMs": 0,
            "startPath": "/quick-sort",
            "title": "Quick sort walkthrough",
          },
        ],
      }
    `)
  })

  it('uses the first package locale and requested viewport without a video channel', () => {
    const plan = compileVideoPlan(project, {
      ...campaign,
      channels: [
        {
          id: 'github',
          locale: 'zh-CN',
        },
      ],
      video: {
        flowIds: ['quick-sort'],
        format: 'portrait',
      },
    })

    expect(plan.recordingConfig.viewport).toEqual({
      height: 1920,
      width: 1080,
    })
    expect(plan.scenes[0]!.title).toBe('快速排序演示')
  })

  it('compiles a channel-specific portrait variant plan', () => {
    const plan = compileVideoPlan(project, {
      ...campaign,
      channels: [
        { id: 'youtube', locale: 'en' },
        { id: 'douyin', locale: 'en' },
      ],
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          channelVariants: {
            douyin: {
              format: 'portrait',
              outputSize: { height: 1920, width: 1080 },
              viewport: { height: 1920, width: 1080 },
            },
          },
        },
      },
    }, 'douyin')

    expect(plan).toMatchObject({
      format: 'portrait',
      recordingConfig: {
        format: 'portrait',
        outputSize: { height: 1920, width: 1080 },
        viewport: { height: 1920, width: 1080 },
      },
    })
  })

  it('uses a bounded custom viewport from the activity video plan', () => {
    const plan = compileVideoPlan(project, {
      ...campaign,
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          defaults: {
            viewport: {
              height: 768,
              width: 1366,
            },
          },
        },
      },
    })

    expect(plan.recordingConfig.viewport).toEqual({
      height: 768,
      width: 1366,
    })
  })

  it('carries a versioned shooting outline into the compiled recording plan', () => {
    const plan = compileVideoPlan(project, {
      ...campaign,
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 4,
        outline: [{
          flowId: 'quick-sort',
          objective: {
            'en': 'Show the partition step',
            'zh-CN': '展示分区步骤',
          },
          title: {
            'en': 'Partition the array',
            'zh-CN': '数组分区',
          },
        }],
      },
    })

    expect(plan).toMatchObject({
      outline: [{ flowId: 'quick-sort' }],
      planVersion: 4,
    })
  })

  it('fails when compilation is requested without a video section', () => {
    expect(() =>
      compileVideoPlan(project, {
        ...campaign,
        video: undefined,
      }),
    ).toThrow(/does not define a video plan/)
  })
})
