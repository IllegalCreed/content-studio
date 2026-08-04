import type { CampaignSpec, ProjectManifest } from '../types'
import { describe, expect, it } from 'vitest'
import {
  resolveVideoRecordingConfig,
  validateVideoRecordingConfigOverrides,
} from './recording-config'

const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: 'algorithm-visualizer',
  name: 'Algorithm Visualizer',
  canonicalUrl: 'https://algo.example.com/',
  repositoryUrl: 'https://github.com/example/algorithm-visualizer',
  locales: ['zh-CN', 'en'],
  tagline: {
    'en': 'Learn algorithms.',
    'zh-CN': '学习算法。',
  },
  facts: [],
  captureFlows: [],
  videoRecordingDefaults: {
    colorScheme: 'light',
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    outputSize: { height: 720, width: 1280 },
    viewport: { height: 900, width: 1600 },
  },
}

const campaign: CampaignSpec = {
  schemaVersion: 1,
  campaignId: 'quick-sort-launch',
  topic: {
    'en': 'Quick sort',
    'zh-CN': '快速排序',
  },
  goal: 'education',
  targetUrl: 'https://algo.example.com/quick-sort',
  highlights: [],
  tags: ['algorithms'],
  channels: [{ id: 'youtube', locale: 'en' }],
  video: {
    flowIds: ['quick-sort'],
    format: 'landscape',
    recordingProfile: {
      defaults: {
        colorScheme: 'no-preference',
        locale: 'en',
        viewport: { height: 810, width: 1440 },
      },
      channelVariants: {
        youtube: {
          colorScheme: 'dark',
          outputSize: { height: 1080, width: 1920 },
          viewport: { height: 768, width: 1366 },
        },
      },
    },
  },
}

describe('video recording configuration', () => {
  it('resolves project defaults, activity defaults, and channel variants', () => {
    expect(resolveVideoRecordingConfig(project, campaign)).toEqual({
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      locale: 'en',
      outputSize: { height: 1080, width: 1920 },
      viewport: { height: 768, width: 1366 },
    })
  })

  it('rejects fields outside the recording configuration whitelist', () => {
    expect(() =>
      validateVideoRecordingConfigOverrides({
        browserArgs: ['--no-sandbox'],
      }),
    ).toThrow(/unsupported field/i)
  })

  it('only permits the supported scale factors and color schemes', () => {
    expect(() =>
      validateVideoRecordingConfigOverrides({ deviceScaleFactor: 1.5 }),
    ).toThrow(/deviceScaleFactor/i)
    expect(() =>
      validateVideoRecordingConfigOverrides({ colorScheme: 'sepia' }),
    ).toThrow(/colorScheme/i)
  })
})
