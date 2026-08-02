import type { CampaignSpec, ProjectManifest } from './types'
import { describe, expect, it } from 'vitest'
import { validateCampaign, validateProjectManifest } from './validation'

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
        'en': 'Includes 95 English pages.',
        'zh-CN': '包含 95 个中文页面。',
      },
    },
  ],
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
            name: '开始',
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
  highlights: ['catalog'],
  tags: ['algorithms', 'visualization'],
  channels: [
    {
      id: 'zhihu',
      locale: 'zh-CN',
    },
  ],
  video: {
    flowIds: ['quick-sort'],
    format: 'landscape',
  },
}

describe('manifest validation', () => {
  it('accepts a project and campaign that only reference declared facts and flows', () => {
    expect(validateProjectManifest(project)).toEqual(project)
    expect(validateCampaign(campaign, project)).toEqual(campaign)
  })

  it('accepts explicit source-owned and web-assisted integration modes', () => {
    const sourceOwned = validateProjectManifest({
      ...project,
      sourceAccess: 'source-owned',
      captureMode: 'deterministic',
      repeatability: 'high',
    })
    const webAssisted = validateProjectManifest({
      ...project,
      sourceAccess: 'web-assisted',
      captureMode: 'assisted',
      repeatability: 'low',
    })

    expect(sourceOwned).toMatchObject({
      sourceAccess: 'source-owned',
      captureMode: 'deterministic',
      repeatability: 'high',
    })
    expect(webAssisted).toMatchObject({
      sourceAccess: 'web-assisted',
      captureMode: 'assisted',
      repeatability: 'low',
    })
  })

  it('rejects a web-assisted project that claims deterministic capture', () => {
    expect(() => validateProjectManifest({
      ...project,
      sourceAccess: 'web-assisted',
      captureMode: 'deterministic',
    })).toThrow(/web-assisted.*deterministic/i)
  })

  it('fails closed for non-HTTPS public URLs and unknown capture flows', () => {
    expect(() =>
      validateProjectManifest({
        ...project,
        canonicalUrl: 'http://algo.illegalscreed.cn/',
      }),
    ).toThrow(/HTTPS/)

    expect(() =>
      validateCampaign(
        {
          ...campaign,
          video: {
            ...campaign.video!,
            flowIds: ['missing-flow'],
          },
        },
        project,
      ),
    ).toThrow(/missing-flow/)
  })

  it('rejects sensitive fields, malformed projects, and arbitrary browser actions', () => {
    expect(() =>
      validateProjectManifest({
        ...project,
        apiKey: 'must-never-be-accepted',
      }),
    ).toThrow(/Sensitive field/)
    expect(() =>
      validateProjectManifest({
        ...project,
        schemaVersion: 2,
      }),
    ).toThrow(/schemaVersion/)
    expect(() =>
      validateProjectManifest({
        ...project,
        locales: ['en', 'en'],
      }),
    ).toThrow(/Duplicate locale/)
    expect(() =>
      validateProjectManifest({
        ...project,
        locales: ['fr'],
      }),
    ).toThrow(/Unsupported locale/)
    expect(() =>
      validateProjectManifest({
        ...project,
        tagline: {
          ...project.tagline,
          en: '',
        },
      }),
    ).toThrow(/tagline.en/)
    expect(() =>
      validateProjectManifest({
        ...project,
        facts: [
          project.facts[0],
          project.facts[0],
        ],
      }),
    ).toThrow(/Duplicate fact id/)
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            startPath: 'https://example.com/',
          },
        ],
      }),
    ).toThrow(/project-relative/)
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            steps: [],
          },
        ],
      }),
    ).toThrow(/non-empty array/)
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            steps: [
              {
                kind: 'script',
                source: 'document.cookie',
              },
            ],
          },
        ],
      }),
    ).toThrow(/Unsupported capture step/)
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            steps: [
              {
                kind: 'click',
                locator: {
                  by: 'css',
                  value: '#publish',
                },
              },
            ],
          },
        ],
      }),
    ).toThrow(/semantic locator/)
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            steps: [
              {
                kind: 'wait',
                durationMs: 0,
              },
            ],
          },
        ],
      }),
    ).toThrow(/between 1 and 60000/)
  })

  it('accepts the complete semantic action vocabulary', () => {
    expect(() =>
      validateProjectManifest({
        ...project,
        captureFlows: [
          {
            ...project.captureFlows[0],
            steps: [
              {
                kind: 'fill',
                locator: {
                  by: 'label',
                  value: 'Input values',
                },
                value: '5,3,1',
              },
              {
                kind: 'press',
                key: 'Enter',
              },
              {
                kind: 'wait',
                durationMs: 500,
              },
              {
                kind: 'capture',
                label: 'sorted',
              },
            ],
          },
        ],
      }),
    ).not.toThrow()
  })

  it('accepts a semantic wait-for step for asynchronously mounted project UI', () => {
    const input = {
      ...project,
      captureFlows: [
        {
          ...project.captureFlows[0],
          steps: [
            {
              kind: 'wait-for',
              locator: {
                by: 'role',
                value: 'button',
                name: '开始',
              },
              durationMs: 5000,
            },
          ],
        },
      ],
    } as unknown

    expect(validateProjectManifest(input).captureFlows[0]?.steps).toEqual([
      {
        kind: 'wait-for',
        locator: {
          by: 'role',
          value: 'button',
          name: '开始',
        },
        durationMs: 5000,
      },
    ])
  })

  it('rejects campaign references and policy fields outside the project contract', () => {
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          goal: 'sales',
        },
        project,
      ),
    ).toThrow(/goal/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          targetUrl: 'https://example.com/quick-sort/',
        },
        project,
      ),
    ).toThrow(/canonical origin/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          highlights: ['missing-fact'],
        },
        project,
      ),
    ).toThrow(/Unknown project fact/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          channels: [],
        },
        project,
      ),
    ).toThrow(/non-empty array/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          channels: [
            {
              id: 'unknown',
              locale: 'en',
            },
          ],
        },
        project,
      ),
    ).toThrow(/Unsupported channel/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          channels: [
            {
              id: 'github',
              locale: 'fr',
            },
          ],
        },
        project,
      ),
    ).toThrow(/project locale/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          channels: [
            {
              id: 'github',
              locale: 'en',
            },
            {
              id: 'github',
              locale: 'en',
            },
          ],
        },
        project,
      ),
    ).toThrow(/Duplicate channel/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          tags: ['not valid'],
        },
        project,
      ),
    ).toThrow(/tags/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          video: {
            flowIds: [],
            format: 'landscape',
          },
        },
        project,
      ),
    ).toThrow(/must not be empty/)
    expect(() =>
      validateCampaign(
        {
          ...campaign,
          video: {
            flowIds: ['quick-sort'],
            format: 'cinema',
          },
        },
        project,
      ),
    ).toThrow(/video format/)
  })
})
