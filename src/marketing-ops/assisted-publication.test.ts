// @env node

import type {
  MarketingOpsCampaignRequest,
  MarketingOpsChannelsStatusSnapshot,
  MarketingOpsPublishResult,
  ProjectRecord,
  ProjectSnapshot,
} from '../types'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import { createMarketingOpsAssistedPublicationService } from './assisted-publication'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('marketing-ops assisted publication service', () => {
  it('locks an observed URL during resume and confirms it without a caller URL', async () => {
    const fixture = await createFixture()
    let prepareCalls = 0
    const publishCampaign = vi.fn(async (
      input: MarketingOpsCampaignRequest,
    ): Promise<MarketingOpsPublishResult> => {
      const packageValue = input.packages[0]!
      if (input.execution.mode === 'assisted-confirm') {
        return {
          campaignId: input.campaignId,
          failures: [],
          handoffs: [],
          limitations: [],
          projectId: input.projectId,
          receipts: [{
            accountRef: packageValue.contentStudio.accountRef,
            activityId: packageValue.contentStudio.activityId,
            channel: packageValue.channel,
            contentSha256: packageValue.contentStudio.contentHash,
            externalReceiptId: 'external-synthetic-1',
            issuedAt: '2026-08-14T06:00:00.000Z',
            projectId: input.projectId,
            publicationId: packageValue.contentStudio.publicationId,
            publicUrl: input.execution.confirmations[0]!.publicUrl,
            receiptId: 'receipt-synthetic-1',
            source: 'marketing-ops',
            status: 'published',
          }],
        }
      }
      prepareCalls += 1
      return {
        campaignId: input.campaignId,
        failures: [],
        handoffs: [{
          action: prepareCalls === 1 ? 'final-confirmation' : 'assisted-confirm',
          contentHash: 'a'.repeat(64),
          contentStudioContentHash: packageValue.contentStudio.contentHash,
          form: packageValue.contentStudio.contentFormat,
          idempotencyKey: `${input.idempotencyKey}/bilibili/${packageValue.contentStudio.packageId}/synthetic`,
          packageId: packageValue.contentStudio.packageId,
          ...(prepareCalls === 1
            ? {}
            : { publicUrl: 'https://www.bilibili.com/opus/900000000000000005' }),
          publicationId: packageValue.contentStudio.publicationId,
          status: 'awaiting-owner',
        }],
        limitations: [],
        projectId: input.projectId,
        receipts: [],
      }
    })
    const publication = createMarketingOpsAssistedPublicationService({
      assetBundleRoot: fixture.assetBundleRoot,
      publish: { publishCampaign },
      service: fixture.service,
      sourceRoot: fixture.sourceRoot,
      status: { getChannelsStatus: async () => freshStatus() },
    })
    const authorization = {
      authorizedAt: '2026-08-14T05:59:00.000Z',
      source: 'owner-prompt' as const,
    }

    const prepared = await publication.prepare({
      authorization,
      preparation: {
        projectId: 'project-a',
        publicationId: 'publication-a',
        renderer: {
          canonicalUrl: 'https://project-a.example.com/guide',
          format: 'manual-package',
          links: ['https://project-a.example.com/guide'],
          media: ['image'],
          utmMedium: 'social',
        },
      },
    })
    expect(prepared.handoff.marketingOpsConfirmation).toBeUndefined()

    const resumed = await publication.resume({
      authorization,
      handoffId: prepared.handoff.handoffId,
      projectId: 'project-a',
    })
    expect(resumed.handoff.marketingOpsConfirmation).toEqual({
      publicUrl: 'https://www.bilibili.com/opus/900000000000000005',
      status: 'pending',
    })

    const confirmed = await publication.confirm({
      authorization,
      handoffId: prepared.handoff.handoffId,
      projectId: 'project-a',
    })
    expect(confirmed).toMatchObject({
      handoff: {
        marketingOpsConfirmation: {
          publicUrl: 'https://www.bilibili.com/opus/900000000000000005',
          status: 'confirmed',
        },
        status: 'completed',
      },
      mode: 'assisted-confirm',
      receipts: [{ receiptId: 'receipt-synthetic-1' }],
    })
    expect(fixture.service.getProjectView('project-a').publicationReceipts)
      .toEqual([expect.objectContaining({ receiptId: 'receipt-synthetic-1' })])
  })

  it('will not confirm before the runtime has observed a public URL', async () => {
    const fixture = await createFixture()
    const publication = createMarketingOpsAssistedPublicationService({
      assetBundleRoot: fixture.assetBundleRoot,
      publish: { publishCampaign: vi.fn() },
      service: fixture.service,
      sourceRoot: fixture.sourceRoot,
      status: { getChannelsStatus: async () => freshStatus() },
    })
    const packageValue = fixture.service.prepareMarketingOpsPublicationPackage({
      projectId: 'project-a',
      publicationId: 'publication-a',
      renderer: {
        canonicalUrl: 'https://project-a.example.com/guide',
        format: 'manual-package',
        links: ['https://project-a.example.com/guide'],
        media: ['image'],
        utmMedium: 'social',
      },
    }).package
    const handoff = fixture.service.createMarketingOpsPublicationHandoff(packageValue)

    await expect(publication.confirm({
      authorization: {
        authorizedAt: '2026-08-14T05:59:00.000Z',
        source: 'owner-prompt',
      },
      handoffId: handoff.handoffId,
      projectId: 'project-a',
    })).rejects.toThrow(/runtime-observed public URL/i)
  })
})

async function createFixture(): Promise<{
  assetBundleRoot: string
  service: ContentStudioApplicationService
  sourceRoot: string
}> {
  const project: ProjectRecord = {
    captureMode: 'deterministic',
    currentSnapshotId: 'project-a-snapshot-1',
    name: 'Project A',
    projectId: 'project-a',
    repeatability: 'high',
    sourceAccess: 'source-owned',
  }
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: 'https://project-a.example.com/',
      captureFlows: [],
      facts: [],
      locales: ['zh-CN'],
      name: 'Project A',
      projectId: 'project-a',
      repositoryUrl: 'https://github.com/example/project-a',
      schemaVersion: 1,
      tagline: { 'en': 'Project A', 'zh-CN': '项目 A' },
    },
    projectId: 'project-a',
    snapshotId: 'project-a-snapshot-1',
    version: 1,
  }
  const service = new ContentStudioApplicationService(new InMemoryContentStudioRepository())
  service.registerProject(project, snapshot)
  service.bindProjectChannel({
    accountRef: 'bilibili-synthetic-owner',
    channel: 'bilibili',
    delivery: 'owner-assisted',
    enabled: true,
    projectId: 'project-a',
  })
  service.createActivity({
    activityId: 'activity-a',
    campaignId: 'campaign-a',
    channels: [{ contentFormats: ['image-text'], id: 'bilibili', locale: 'zh-CN' }],
    goal: 'education',
    projectId: 'project-a',
    projectSnapshotId: snapshot.snapshotId,
    status: 'draft',
    targetUrl: 'https://project-a.example.com/guide',
    topic: { 'en': 'Guide', 'zh-CN': '指南' },
  })
  service.createContentGroup({
    activityId: 'activity-a',
    contentGroupId: 'group-a',
    coreMessage: 'Explain the partition step.',
    projectId: 'project-a',
    title: 'Guide',
  })
  const sourceRoot = mkdtempSync(join(tmpdir(), 'content-studio-assisted-source-'))
  const assetBundleRoot = mkdtempSync(join(tmpdir(), 'content-studio-assisted-bundle-'))
  temporaryRoots.push(sourceRoot, assetBundleRoot)
  const relativePath = '.content-studio/activity-a/cover.png'
  const sourcePath = resolve(sourceRoot, 'project-a', relativePath)
  const contents = 'synthetic cover bytes'
  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, contents, { mode: 0o600 })
  service.createActivityArtifact({
    activityId: 'activity-a',
    artifactId: 'cover-a',
    kind: 'image',
    locale: 'zh-CN',
    projectId: 'project-a',
    relativePath,
    sha256: createHash('sha256').update(contents).digest('hex'),
  })
  service.createChannelContent({
    activityId: 'activity-a',
    artifactIds: ['cover-a'],
    body: '分区步骤说明：https://project-a.example.com/guide',
    channel: 'bilibili',
    contentGroupId: 'group-a',
    contentId: 'content-a',
    format: 'image-text',
    locale: 'zh-CN',
    projectId: 'project-a',
    title: '分区步骤说明',
  })
  service.createPublicationPlan({
    activityId: 'activity-a',
    channel: 'bilibili',
    contentId: 'content-a',
    projectId: 'project-a',
    publicationId: 'publication-a',
  })
  return { assetBundleRoot, service, sourceRoot }
}

function freshStatus(): MarketingOpsChannelsStatusSnapshot {
  const observedAt = new Date()
  return {
    authorizesExternalWrite: false,
    capabilities: ['content-studio-assisted-publication-v1'],
    channels: [{
      accountRef: 'bilibili-synthetic-owner',
      adapterReady: true,
      assistedPublicationReady: true,
      channel: 'bilibili',
      health: 'ready',
      nextStep: 'ready',
    }],
    contractVersion: 3,
    expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
    observedAt: observedAt.toISOString(),
    projectId: 'project-a',
    runtimeVersion: '0.2.0',
  }
}
