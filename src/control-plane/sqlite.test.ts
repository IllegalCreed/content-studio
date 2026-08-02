// @env node

import type {
  ActivityArtifact,
  ChannelContent,
  ContentGroup,
  ContentStudioReport,
  MonitoringObservation,
  OwnerHandoff,
  ProjectAsset,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  PublicationPlan,
  PublicationReceipt,
  PublishingActivity,
} from '../types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecordConflictError } from './service'
import {
  SqliteContentStudioRepository,
} from './sqlite'

function records(projectId: string): {
  activity: PublishingActivity
  project: ProjectRecord
  snapshot: ProjectSnapshot
} {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows: [],
      facts: [],
      locales: ['en'],
      name: projectId,
      projectId,
      repositoryUrl: `https://github.com/example/${projectId}`,
      schemaVersion: 1,
      tagline: {
        'en': projectId,
        'zh-CN': projectId,
      },
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  const project: ProjectRecord = {
    captureMode: 'deterministic',
    currentSnapshotId: snapshot.snapshotId,
    name: projectId,
    projectId,
    repeatability: 'high',
    sourceAccess: 'source-owned',
  }
  const activity: PublishingActivity = {
    activityId: `${projectId}-activity`,
    campaignId: `${projectId}-campaign`,
    channels: [{ id: 'youtube', locale: 'en' }],
    goal: 'education',
    projectId,
    projectSnapshotId: snapshot.snapshotId,
    status: 'draft',
    targetUrl: snapshot.manifest.canonicalUrl,
    topic: {
      'en': 'A topic',
      'zh-CN': '主题',
    },
    video: {
      flowIds: ['quick-sort'],
      format: 'landscape',
    },
    version: 1,
  }
  return { activity, project, snapshot }
}

describe('sQLite control-plane repository', () => {
  it('保留项目、活动和历史版本，重开进程后仍可读取', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-sqlite-'))
    const databasePath = join(temporaryDirectory, 'state.sqlite')

    try {
      const firstRepository = new SqliteContentStudioRepository(databasePath)
      const first = records('project-a')
      firstRepository.saveProjectSnapshot(first.snapshot)
      firstRepository.saveProject(first.project)
      firstRepository.saveActivity(first.activity)
      firstRepository.saveActivity({
        ...first.activity,
        topic: {
          'en': 'A revised topic',
          'zh-CN': '修订主题',
        },
        version: 2,
      })
      const binding: ProjectChannelBinding = {
        channel: 'youtube',
        delivery: 'owner-assisted',
        enabled: true,
        projectId: 'project-a',
      }
      const group: ContentGroup = {
        activityId: first.activity.activityId,
        contentGroupId: 'group-a',
        coreMessage: 'Explain the idea',
        projectId: 'project-a',
        title: 'Quick sort',
        version: 1,
      }
      const content: ChannelContent = {
        activityId: first.activity.activityId,
        body: 'A video script',
        channel: 'youtube',
        contentGroupId: group.contentGroupId,
        contentId: 'content-a',
        format: 'video',
        locale: 'en',
        projectId: 'project-a',
        title: 'Quick sort explained',
        version: 1,
      }
      const artifact: ActivityArtifact = {
        activityId: first.activity.activityId,
        artifactId: 'artifact-a',
        kind: 'video',
        projectId: 'project-a',
        relativePath: 'activities/activity-a/video.webm',
        sha256: 'a'.repeat(64),
        version: 1,
      }
      const asset: ProjectAsset = {
        assetId: 'asset-a',
        kind: 'video',
        projectId: 'project-a',
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
        sourceArtifactId: artifact.artifactId,
        version: 1,
      }
      const plan: PublicationPlan = {
        activityId: first.activity.activityId,
        channel: 'youtube',
        contentId: content.contentId,
        projectId: 'project-a',
        publicationId: 'publication-a',
      }
      const receipt: PublicationReceipt = {
        activityId: first.activity.activityId,
        channel: 'youtube',
        externalReceiptId: 'external-a',
        projectId: 'project-a',
        publicationId: plan.publicationId,
        publicUrl: 'https://youtube.example/video-a',
        receiptId: 'receipt-a',
        status: 'published',
      }
      const handoff: OwnerHandoff = {
        activityId: first.activity.activityId,
        artifactChecksums: [artifact.sha256],
        channel: 'youtube',
        checklist: ['确认标题'],
        expiresAt: '2026-08-03T00:00:00.000Z',
        handoffId: 'handoff-a',
        officialTargetUrl: 'https://studio.youtube.com/upload',
        projectId: 'project-a',
        publicationId: plan.publicationId,
        status: 'pending',
      }
      const observation: MonitoringObservation = {
        activityId: first.activity.activityId,
        channel: 'youtube',
        collectedAt: '2026-08-02T01:00:00.000Z',
        metrics: { views: 100 },
        observationId: 'observation-a',
        projectId: 'project-a',
        publicationId: plan.publicationId,
        source: 'public',
      }
      const report: ContentStudioReport = {
        activityId: first.activity.activityId,
        generatedAt: '2026-08-02T02:00:00.000Z',
        metrics: { views: 100 },
        observationIds: [observation.observationId],
        projectId: 'project-a',
        reportId: 'report-a',
        scope: 'activity',
      }
      firstRepository.saveProjectChannelBinding(binding)
      firstRepository.saveContentGroup(group)
      firstRepository.saveChannelContent(content)
      firstRepository.saveActivityArtifact(artifact)
      firstRepository.saveProjectAsset(asset)
      firstRepository.savePublicationPlan(plan)
      firstRepository.savePublicationReceipt(receipt)
      firstRepository.saveOwnerHandoff(handoff)
      firstRepository.saveMonitoringObservation(observation)
      firstRepository.saveReport(report)
      firstRepository.close()
      firstRepository.close()

      const reopenedRepository = new SqliteContentStudioRepository(databasePath)
      expect(reopenedRepository.getProject('project-a')).toEqual(first.project)
      expect(reopenedRepository.getProjectSnapshot(
        'project-a',
        first.snapshot.snapshotId,
      )).toEqual(first.snapshot)
      expect(reopenedRepository.getActivity('project-a', first.activity.activityId, 1))
        .toEqual(first.activity)
      expect(reopenedRepository.getActivity('project-a', first.activity.activityId))
        .toMatchObject({
          topic: {
            en: 'A revised topic',
          },
          version: 2,
        })
      expect(reopenedRepository.listProjectChannelBindings('project-a'))
        .toEqual([binding])
      expect(reopenedRepository.getContentGroup('project-a', group.contentGroupId))
        .toEqual(group)
      expect(reopenedRepository.getChannelContent('project-a', content.contentId))
        .toEqual(content)
      expect(reopenedRepository.listActivityArtifacts(
        'project-a',
        first.activity.activityId,
      )).toEqual([artifact])
      expect(reopenedRepository.listProjectAssets('project-a'))
        .toEqual([asset])
      expect(reopenedRepository.getPublicationPlan(
        'project-a',
        plan.publicationId,
      )).toEqual(plan)
      expect(reopenedRepository.getPublicationReceipt(
        'project-a',
        receipt.receiptId,
      )).toEqual(receipt)
      expect(reopenedRepository.getPublicationReceiptForPublication(
        'project-a',
        plan.publicationId,
      )).toEqual(receipt)
      expect(reopenedRepository.getOwnerHandoff(
        'project-a',
        handoff.handoffId,
      )).toEqual(handoff)
      expect(reopenedRepository.getMonitoringObservation(
        'project-a',
        observation.observationId,
      )).toEqual(observation)
      expect(reopenedRepository.getReport('project-a', report.reportId))
        .toEqual(report)
      expect(() => reopenedRepository.saveActivity(first.activity))
        .toThrow(RecordConflictError)
      reopenedRepository.close()
    }
    finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  })

  it('重开后仍然执行项目隔离，不把别的项目记录返回出来', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-sqlite-'))
    const databasePath = join(temporaryDirectory, 'state.sqlite')

    try {
      const repository = new SqliteContentStudioRepository(databasePath)
      const first = records('project-a')
      repository.saveProjectSnapshot(first.snapshot)
      repository.saveProject(first.project)
      repository.saveActivity(first.activity)
      repository.close()

      const reopenedRepository = new SqliteContentStudioRepository(databasePath)
      expect(() => reopenedRepository.getActivity(
        'project-b',
        first.activity.activityId,
      )).toThrow(/not available in project/i)
      reopenedRepository.close()
    }
    finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  })
})
