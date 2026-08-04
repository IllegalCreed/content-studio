// @env node

import { describe, expect, it } from 'vitest'
import { DEFAULT_STORAGE_RETENTION_POLICY } from '../constants'
import {
  classifyStorageRetention,
  evaluateStorageRetention,
} from './retention'

describe('storage retention policy', () => {
  it('keeps project assets long-lived and gives them no automatic deadline', () => {
    expect(classifyStorageRetention('project-asset', 'video')).toBe('long-lived-asset')
    expect(evaluateStorageRetention({
      createdAt: '2020-01-01T00:00:00.000Z',
      now: '2026-08-04T00:00:00.000Z',
      retentionClass: 'long-lived-asset',
    })).toEqual({
      eligible: false,
      reason: '项目素材默认长期保留，不会自动清理。',
      retentionClass: 'long-lived-asset',
    })
  })

  it('uses a shorter deadline for rebuildable preview caches', () => {
    expect(classifyStorageRetention('activity-artifact', 'preview-frame'))
      .toBe('rebuildable-cache')
    expect(evaluateStorageRetention({
      createdAt: '2026-07-20T00:00:00.000Z',
      now: '2026-08-04T00:00:00.000Z',
      retentionClass: 'rebuildable-cache',
    })).toEqual({
      eligible: true,
      eligibleAfter: '2026-07-27T00:00:00.000Z',
      reason: '可重建缓存已超过 7 天保留期，清理前需要用户确认。',
      retentionClass: 'rebuildable-cache',
    })
  })

  it('keeps fresh activity artifacts reviewable but not expired', () => {
    expect(classifyStorageRetention('activity-artifact', 'video'))
      .toBe('activity-artifact')
    expect(evaluateStorageRetention({
      createdAt: '2026-08-01T12:00:00.000Z',
      now: '2026-08-04T00:00:00.000Z',
      retentionClass: 'activity-artifact',
    })).toEqual({
      eligible: false,
      eligibleAfter: '2026-08-31T12:00:00.000Z',
      reason: '活动产物默认保留 30 天，仍需用户明确确认后清理。',
      retentionClass: 'activity-artifact',
    })
  })

  it('exposes a stable policy without allowing invalid durations', () => {
    expect(DEFAULT_STORAGE_RETENTION_POLICY).toEqual({
      activityArtifactDays: 30,
      rebuildableCacheDays: 7,
      recycleRecoveryDays: 30,
    })
    expect(() => evaluateStorageRetention({
      createdAt: '2026-08-01T00:00:00.000Z',
      policy: { ...DEFAULT_STORAGE_RETENTION_POLICY, activityArtifactDays: 0 },
      retentionClass: 'activity-artifact',
    })).toThrow(/positive/i)
  })
})
