// @env node

import type {
  ActivityArtifactKind,
  ProjectAssetKind,
  StorageRetentionClass,
  StorageRetentionPolicy,
} from '../types'
import { DEFAULT_STORAGE_RETENTION_POLICY } from '../constants'

const DAY_MS = 24 * 60 * 60 * 1000

export interface StorageRetentionEvaluationInput {
  createdAt: Date | string
  now?: Date | string
  policy?: StorageRetentionPolicy
  retentionClass: StorageRetentionClass
}

export interface StorageRetentionEvaluation {
  eligible: boolean
  eligibleAfter?: string
  reason: string
  retentionClass: StorageRetentionClass
}

export function classifyStorageRetention(
  scope: 'activity-artifact' | 'project-asset',
  kind: ActivityArtifactKind | ProjectAssetKind,
): StorageRetentionClass {
  if (scope === 'project-asset')
    return 'long-lived-asset'
  return kind === 'preview-frame' ? 'rebuildable-cache' : 'activity-artifact'
}

export function evaluateStorageRetention(
  input: StorageRetentionEvaluationInput,
): StorageRetentionEvaluation {
  const policy = input.policy ?? DEFAULT_STORAGE_RETENTION_POLICY
  assertValidPolicy(policy)
  const createdAt = parseDate(input.createdAt, 'createdAt')
  const now = input.now === undefined
    ? new Date()
    : parseDate(input.now, 'now')

  if (input.retentionClass === 'long-lived-asset') {
    return {
      eligible: false,
      reason: '项目素材默认长期保留，不会自动清理。',
      retentionClass: input.retentionClass,
    }
  }

  const days = input.retentionClass === 'rebuildable-cache'
    ? policy.rebuildableCacheDays
    : policy.activityArtifactDays
  const eligibleAfter = new Date(createdAt.getTime() + days * DAY_MS).toISOString()
  const eligible = now.getTime() >= Date.parse(eligibleAfter)
  return {
    eligible,
    eligibleAfter,
    reason: input.retentionClass === 'rebuildable-cache'
      ? eligible
        ? `可重建缓存已超过 ${days} 天保留期，清理前需要用户确认。`
        : `可重建缓存保留 ${days} 天，仍未到建议清理时间。`
      : eligible
        ? `活动产物已超过 ${days} 天保留期，清理前需要用户确认。`
        : `活动产物默认保留 ${days} 天，仍需用户明确确认后清理。`,
    retentionClass: input.retentionClass,
  }
}

function assertValidPolicy(policy: StorageRetentionPolicy): void {
  for (const [name, days] of Object.entries(policy)) {
    if (!Number.isSafeInteger(days) || days <= 0)
      throw new Error(`${name} must be a positive safe integer`)
  }
}

function parseDate(value: Date | string, name: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new Error(`${name} must be a valid date`)
  return date
}
