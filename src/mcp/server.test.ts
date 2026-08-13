import type { ProductionWorkerJob } from '../jobs/worker'
import type {
  MarketingOpsChannelsStatusSnapshot,
  MarketingOpsPublishClient,
  MarketingOpsPublishResult,
  MarketingOpsStatusClient,
  ProjectManifest,
  ProjectRecord,
  ProjectSnapshot,
} from '../types'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import { OwnerTakeoverRegistry } from '../jobs/owner-takeover'
import { InMemoryExecutionTaskStore } from '../jobs/task'
import {
  createContentStudioMcpServer,
  serveMcpStdio,
} from './server'

const projectId = 'algorithm-visualizer'

function requestMeta(tasks = false): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/clientCapabilities': tasks
      ? {
          extensions: {
            'io.modelcontextprotocol/tasks': {},
          },
        }
      : {},
    'io.modelcontextprotocol/clientInfo': {
      name: 'content-studio-test',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  }
}

const manifest: ProjectManifest = {
  schemaVersion: 1 as const,
  projectId,
  name: 'Algorithm Visualizer',
  canonicalUrl: 'https://example.com/',
  repositoryUrl: 'https://github.com/example/project',
  locales: ['en', 'zh-CN'],
  tagline: {
    'en': 'Learn algorithms.',
    'zh-CN': '学习算法。',
  },
  facts: [],
  captureFlows: [{
    id: 'quick-sort',
    startPath: '/quick-sort',
    steps: [{ kind: 'capture', label: 'algorithm' }],
    title: {
      'en': 'Quick sort',
      'zh-CN': '快速排序',
    },
  }],
}

const project: ProjectRecord = {
  captureMode: 'deterministic',
  currentSnapshotId: 'algorithm-visualizer-snapshot-1',
  name: 'Algorithm Visualizer',
  projectId,
  repeatability: 'high',
  sourceAccess: 'source-owned',
}

const snapshot: ProjectSnapshot = {
  manifest,
  projectId,
  snapshotId: project.currentSnapshotId,
  version: 1,
}

function createMarketingOpsStagingRoots(): {
  assetBundleRoot: string
  sourceRoot: string
} {
  return {
    assetBundleRoot: mkdtempSync(join(tmpdir(), 'content-studio-marketing-ops-bundle-')),
    sourceRoot: mkdtempSync(join(tmpdir(), 'content-studio-marketing-ops-source-')),
  }
}

async function writeMarketingOpsSourceArtifact(
  sourceRoot: string,
  projectIdValue: string,
  relativePath: string,
  contents: string,
): Promise<string> {
  const sourcePath = resolve(sourceRoot, projectIdValue, relativePath)
  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, contents, { mode: 0o600 })
  return createHash('sha256').update(contents).digest('hex')
}

function freshMarketingOpsStatus(
  snapshotProjectId: string,
): MarketingOpsChannelsStatusSnapshot {
  const observedAt = new Date()
  return {
    authorizesExternalWrite: false,
    capabilities: [],
    channels: [],
    contractVersion: 3,
    expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
    observedAt: observedAt.toISOString(),
    projectId: snapshotProjectId,
    runtimeVersion: '0.1.0',
  }
}

function createFixture(options: {
  includeBilibili?: boolean
  marketingOpsPublish?: MarketingOpsPublishClient
  marketingOpsStatus?: MarketingOpsStatusClient
  ownerTakeovers?: OwnerTakeoverRegistry
  taskStore?: InMemoryExecutionTaskStore
} = {}) {
  const repository = new InMemoryContentStudioRepository()
  const service = new ContentStudioApplicationService(
    repository,
    options.taskStore ?? new InMemoryExecutionTaskStore(),
  )
  service.registerProject(project, snapshot)
  service.bindProjectChannel({
    channel: 'github',
    delivery: 'automatic-candidate',
    enabled: true,
    projectId,
  })
  if (options.includeBilibili === true) {
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId,
    })
  }
  return createContentStudioMcpServer({
    marketingOpsPublish: options.marketingOpsPublish,
    marketingOpsStatus: options.marketingOpsStatus,
    ownerTakeovers: options.ownerTakeovers,
    projectId,
    service,
  })
}

type MarketingOpsPublishInput = Parameters<MarketingOpsPublishClient['publishCampaign']>[0]
type MarketingOpsConfirmationFactory = (
  input: MarketingOpsPublishInput,
) => MarketingOpsPublishResult

function confirmationReceipt(
  input: MarketingOpsPublishInput,
  publicUrl: string,
  receiptId: string,
) {
  const packageValue = input.packages[0]!.contentStudio
  return {
    activityId: packageValue.activityId,
    accountRef: packageValue.accountRef,
    channel: input.packages[0]!.channel,
    contentSha256: packageValue.contentHash,
    externalReceiptId: `external-${receiptId}`,
    issuedAt: '2026-08-10T10:01:00.000Z',
    projectId: input.projectId,
    publicationId: packageValue.publicationId,
    publicUrl,
    receiptId,
    source: 'marketing-ops' as const,
    status: 'published' as const,
  }
}

async function createBilibiliAssistedConfirmationFixture(): Promise<{
  confirm: (publicUrl: string) => Promise<unknown>
  setConfirmationResult: (factory: MarketingOpsConfirmationFactory) => void
  setBinding: (binding: {
    accountRef?: string
    delivery?: 'content-only' | 'owner-assisted'
    enabled?: boolean
  }) => void
  service: ContentStudioApplicationService
}> {
  const repository = new InMemoryContentStudioRepository()
  const service = new ContentStudioApplicationService(repository)
  service.registerProject(project, snapshot)
  const { assetBundleRoot: marketingOpsAssetBundleRoot, sourceRoot: marketingOpsSourceRoot } = createMarketingOpsStagingRoots()
  const binding = {
    accountRef: 'bilibili-main',
    channel: 'bilibili' as const,
    delivery: 'owner-assisted' as const,
    enabled: true,
    projectId,
  }
  service.bindProjectChannel(binding)
  const activity = service.createActivity({
    activityId: 'bilibili-confirmation-activity',
    campaignId: 'bilibili-confirmation-campaign',
    channels: [{
      contentFormats: ['image-text'],
      id: 'bilibili',
      locale: 'zh-CN',
    }],
    goal: 'education',
    projectId,
    projectSnapshotId: snapshot.snapshotId,
    status: 'draft',
    targetUrl: 'https://example.com/bilibili/',
    topic: { 'en': 'Bilibili package', 'zh-CN': 'Bilibili 图文包' },
  })
  const group = service.createContentGroup({
    activityId: activity.activityId,
    contentGroupId: 'bilibili-confirmation-group',
    coreMessage: 'Prepare the image-text package.',
    projectId,
    title: 'Bilibili package',
  })
  service.createActivityArtifact({
    activityId: activity.activityId,
    artifactId: 'bilibili-confirmation-cover',
    kind: 'image',
    locale: 'zh-CN',
    projectId,
    relativePath: '.content-studio/bilibili-confirmation/cover.png',
    sha256: await writeMarketingOpsSourceArtifact(
      marketingOpsSourceRoot,
      projectId,
      '.content-studio/bilibili-confirmation/cover.png',
      'bilibili-confirmation-cover',
    ),
  })
  const content = service.createChannelContent({
    activityId: activity.activityId,
    artifactIds: ['bilibili-confirmation-cover'],
    body: '快速排序图文：https://example.com/bilibili/',
    channel: 'bilibili',
    contentGroupId: group.contentGroupId,
    contentId: 'bilibili-confirmation-content',
    format: 'image-text',
    locale: 'zh-CN',
    projectId,
    title: '快速排序图文',
  })
  service.createPublicationPlan({
    activityId: activity.activityId,
    channel: 'bilibili',
    contentId: content.contentId,
    projectId,
    publicationId: 'bilibili-confirmation-publication',
  })

  let confirmationFactory: MarketingOpsConfirmationFactory | undefined
  const marketingOpsPublish: MarketingOpsPublishClient = {
    publishCampaign: async (input) => {
      const packageValue = input.packages[0]!.contentStudio
      if (input.execution.mode === 'assisted-confirm') {
        return confirmationFactory?.(input) ?? {
          campaignId: input.campaignId,
          failures: [],
          handoffs: [],
          limitations: [],
          projectId: input.projectId,
          receipts: [confirmationReceipt(
            input,
            input.execution.confirmations[0]!.publicUrl,
            'bilibili-confirmation-receipt',
          )],
        }
      }
      return {
        campaignId: input.campaignId,
        failures: [],
        handoffs: [{
          contentHash: 'b'.repeat(64),
          form: packageValue.contentFormat,
          idempotencyKey: 'content-studio/confirmation',
          packageId: packageValue.packageId,
          publicationId: packageValue.publicationId,
          status: 'awaiting-owner' as const,
        }],
        limitations: [],
        projectId: input.projectId,
        receipts: [],
      }
    },
  }
  const observedAt = new Date()
  const server = createContentStudioMcpServer({
    marketingOpsPublish,
    marketingOpsStatus: {
      getChannelsStatus: async () => ({
        authorizesExternalWrite: false,
        capabilities: ['content-studio-assisted-publication-v1'],
        channels: [{
          accountRef: 'bilibili-main',
          adapterReady: true,
          alias: null,
          assistedPublicationReady: true,
          channel: 'bilibili',
          health: 'ready',
          nextAction: 'Publish in the official Bilibili UI, then confirm its public URL',
          nextStep: 'ready',
        }],
        contractVersion: 3,
        expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
        observedAt: observedAt.toISOString(),
        projectId,
        runtimeVersion: '0.1.0',
      }),
    },
    marketingOpsAssetBundleRoot,
    marketingOpsSourceRoot,
    projectId,
    service,
  })
  const preparedResponse = await server.handleMessage({
    jsonrpc: '2.0',
    id: 'bilibili-confirmation-prepare',
    method: 'tools/call',
    params: {
      name: 'publish_marketing_ops_package',
      arguments: {
        authorization: {
          authorizedAt: '2026-08-10T10:00:00.000Z',
          source: 'owner-prompt',
        },
        execution: { mode: 'assisted-prepare' },
        projectId,
        publicationId: 'bilibili-confirmation-publication',
        renderer: {
          canonicalUrl: 'https://example.com/bilibili/',
          format: 'manual-package',
          links: ['https://example.com/bilibili/'],
          media: ['image'],
          utmMedium: 'social',
        },
      },
    },
  })
  const handoffId = (preparedResponse?.result as {
    structuredContent?: { handoff?: { handoffId?: string } }
  })?.structuredContent?.handoff?.handoffId
  if (typeof handoffId !== 'string')
    throw new Error('Test fixture failed to prepare an owner handoff')

  return {
    confirm: publicUrl => server.handleMessage({
      jsonrpc: '2.0',
      id: `bilibili-confirmation-${publicUrl}`,
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:02:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-confirm', publicUrl },
          handoffId,
          projectId,
        },
      },
    }),
    service,
    setBinding: updates => service.updateProjectChannelBinding({
      ...binding,
      ...updates,
    }),
    setConfirmationResult: (factory) => {
      confirmationFactory = factory
    },
  }
}

describe('content Studio local MCP server', () => {
  it('fails closed when no managed marketing-ops publish client is injected', async () => {
    const server = createFixture({ includeBilibili: true })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'publish-unavailable',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-prepare' },
          projectId,
          publicationId: 'bilibili-publication',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: [],
            utmMedium: 'social',
          },
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringMatching(/unavailable|blocked/i) }],
      },
    })
  })

  it.each([
    {
      capabilities: ['content-studio-assisted-publication-v1'] as const,
      expectedMessage: 'Bilibili 需要 Owner 人工登录：请在 Bilibili 官方页面完成登录，然后使用同一个 MCP 请求重试；不要向 Content Studio 提供登录凭据。',
      health: 'reauth-required' as const,
      nextStep: 'reauthorize' as const,
      runtimeNextAction: '在 Bilibili 官方页面登录后重试',
    },
    {
      capabilities: ['content-studio-assisted-publication-v1'] as const,
      expectedMessage: 'Bilibili 当前账号状态无法确认：请检查固定流程打开的 Bilibili 官方页面，完成人工登录或页面要求的验证码、风控/2FA 后，用同一个 MCP 请求重试；若未打开官方页面，则 managed runtime 不可用。不要提供凭据或验证码。',
      health: 'blocked' as const,
      nextStep: 'blocked' as const,
      runtimeNextAction: '在 Bilibili 官方页面完成风控验证并确认当前账号',
    },
    {
      capabilities: [] as const,
      expectedMessage: 'Marketing Ops status unavailable; publishing remains blocked',
      health: 'reauth-required' as const,
      nextStep: 'reauthorize' as const,
      runtimeNextAction: 'untrusted login detail',
    },
    {
      capabilities: ['content-studio-assisted-publication-v1'] as const,
      expectedMessage: 'Marketing Ops status unavailable; publishing remains blocked',
      health: 'ready' as const,
      nextStep: 'ready' as const,
      runtimeNextAction: 'untrusted ready detail',
    },
  ])('returns a fixed Bilibili owner handoff for $health without leaking runtime text', async ({
    capabilities,
    expectedMessage,
    health,
    nextStep,
    runtimeNextAction,
  }) => {
    const observedAt = new Date()
    const server = createFixture({
      includeBilibili: true,
      marketingOpsPublish: {
        publishCampaign: async () => {
          throw new Error('publish should not run before owner intervention')
        },
      },
      marketingOpsStatus: {
        getChannelsStatus: async () => ({
          authorizesExternalWrite: false,
          capabilities: [...capabilities],
          channels: [{
            adapterReady: false,
            assistedPublicationReady: false,
            channel: 'bilibili',
            health,
            nextAction: runtimeNextAction,
            nextStep,
          }],
          contractVersion: 3,
          expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
          observedAt: observedAt.toISOString(),
          projectId,
          runtimeVersion: '0.1.0',
        }),
      },
    })

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: `bilibili-owner-${health}`,
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-prepare' },
          projectId,
          publicationId: 'bilibili-owner-intervention',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: [],
            utmMedium: 'social',
          },
        },
      },
    })

    expect(response).toMatchObject({
      result: {
        content: [{ text: expectedMessage }],
        isError: true,
      },
    })
    expect(JSON.stringify(response)).not.toContain(runtimeNextAction)
  })

  it('prepares one locked Bilibili package through the managed client without publishing remotely', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    service.registerProject(project, snapshot)
    const { assetBundleRoot, sourceRoot } = createMarketingOpsStagingRoots()
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId,
    })
    const activity = service.createActivity({
      activityId: 'bilibili-assisted-activity',
      campaignId: 'bilibili-assisted-campaign',
      channels: [{
        contentFormats: ['image-text'],
        id: 'bilibili',
        locale: 'zh-CN',
      }],
      goal: 'education',
      projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://example.com/bilibili/',
      topic: { 'en': 'Bilibili package', 'zh-CN': 'Bilibili 图文包' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'bilibili-assisted-group',
      coreMessage: 'Prepare the image-text package.',
      projectId,
      title: 'Bilibili package',
    })
    const coverSha256 = await writeMarketingOpsSourceArtifact(
      sourceRoot,
      projectId,
      '.content-studio/bilibili-assisted/cover.png',
      'bilibili-assisted-cover',
    )
    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'bilibili-assisted-cover',
      kind: 'image',
      locale: 'zh-CN',
      projectId,
      relativePath: '.content-studio/bilibili-assisted/cover.png',
      sha256: coverSha256,
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: ['bilibili-assisted-cover'],
      body: '快速排序图文：https://example.com/bilibili/',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'bilibili-assisted-content',
      format: 'image-text',
      locale: 'zh-CN',
      projectId,
      title: '快速排序图文',
    })
    service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: content.contentId,
      projectId,
      publicationId: 'bilibili-assisted-publication',
    })

    let forwarded:
      | Parameters<MarketingOpsPublishClient['publishCampaign']>[0]
      | undefined
    let prepareCalls = 0
    const marketingOpsPublish: MarketingOpsPublishClient = {
      publishCampaign: async (input) => {
        forwarded = input
        if (input.execution.mode === 'assisted-abandon') {
          const packageValue = input.packages[0]!
          return {
            campaignId: input.campaignId,
            failures: [],
            handoffs: [{
              channel: packageValue.channel,
              contentHash: 'b'.repeat(64),
              contentStudioContentHash: packageValue.contentStudio.contentHash,
              form: packageValue.contentStudio.contentFormat,
              idempotencyKey: `${input.idempotencyKey}/bilibili/${packageValue.contentStudio.packageId}/12345678`,
              nextAction: 'Local owner handoff was abandoned without a remote action.',
              packageId: packageValue.contentStudio.packageId,
              publicationId: packageValue.contentStudio.publicationId,
              reused: false,
              status: 'abandoned' as const,
            }],
            limitations: ['local-owner-handoff-released-without-browser-or-remote-content-action'],
            projectId: input.projectId,
            receipts: [],
          }
        }
        if (input.execution.mode === 'assisted-confirm') {
          const packageValue = input.packages[0]!
          return {
            campaignId: input.campaignId,
            failures: [],
            handoffs: [],
            limitations: ['publication-is-owner-confirmed-not-remotely-created'],
            projectId: input.projectId,
            receipts: [{
              activityId: packageValue.contentStudio.activityId,
              accountRef: packageValue.contentStudio.accountRef,
              channel: packageValue.channel,
              contentFormat: packageValue.contentStudio.contentFormat,
              contentSha256: packageValue.contentStudio.contentHash,
              externalReceiptId: '966723264948731941',
              issuedAt: '2026-08-10T10:01:00.000Z',
              projectId: input.projectId,
              publicationId: packageValue.contentStudio.publicationId,
              publicUrl: input.execution.confirmations[0]!.publicUrl,
              receiptId: 'bilibili-owner-confirmed-1',
              source: 'marketing-ops',
              status: 'published',
            }],
          }
        }
        prepareCalls += 1
        const packageValue = input.packages[0]!
        return {
          campaignId: input.campaignId,
          failures: [],
          handoffs: [{
            ...(prepareCalls > 1
              ? {
                  action: 'assisted-confirm' as const,
                  publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
                }
              : { action: 'final-confirmation' as const }),
            contentHash: 'b'.repeat(64),
            contentStudioContentHash: packageValue.contentStudio.contentHash,
            form: packageValue.contentStudio.contentFormat,
            idempotencyKey: `${input.idempotencyKey}/bilibili/${packageValue.contentStudio.packageId}/12345678`,
            nextAction: 'Publish this package in the official UI, then confirm its public URL.',
            packageId: packageValue.contentStudio.packageId,
            publicationId: packageValue.contentStudio.publicationId,
            status: 'awaiting-owner',
          }],
          limitations: ['publication-is-owner-confirmed-not-remotely-created'],
          projectId: input.projectId,
          receipts: [],
        }
      },
    }
    const observedAt = new Date()
    const getChannelsStatus = vi.fn(async (): Promise<MarketingOpsChannelsStatusSnapshot> => ({
      authorizesExternalWrite: false,
      capabilities: ['content-studio-assisted-publication-v1' as const],
      channels: [{
        accountRef: 'bilibili-main',
        adapterReady: true,
        assistedPublicationReady: true,
        channel: 'bilibili' as const,
        health: 'ready' as const,
        nextStep: 'ready' as const,
      }],
      contractVersion: 3,
      expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
      observedAt: observedAt.toISOString(),
      projectId,
      runtimeVersion: '0.1.0',
    }))
    const server = createContentStudioMcpServer({
      marketingOpsPublish,
      marketingOpsStatus: {
        getChannelsStatus,
      },
      marketingOpsAssetBundleRoot: assetBundleRoot,
      marketingOpsSourceRoot: sourceRoot,
      projectId,
      service,
    })

    const preparedResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-prepare',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-prepare' },
          projectId,
          publicationId: 'bilibili-assisted-publication',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: ['image'],
            utmMedium: 'social',
          },
        },
      },
    })
    expect(preparedResponse).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          handoff: {
            marketingOpsPackage: {
              contentHash: expect.any(String),
              publicationId: 'bilibili-assisted-publication',
            },
            status: 'pending',
          },
          handoffs: [{
            packageId: 'bilibili-assisted-publication',
            publicationId: 'bilibili-assisted-publication',
            status: 'awaiting-owner',
          }],
          mode: 'assisted-prepare',
        },
      },
    })
    const handoffId = (preparedResponse as {
      result: { structuredContent: { handoff: { handoffId: string } } }
    }).result.structuredContent.handoff.handoffId

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-prepare-recovery',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-prepare' },
          projectId,
          publicationId: 'bilibili-assisted-publication',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: ['image'],
            utmMedium: 'social',
          },
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          handoffs: [{
            action: 'assisted-confirm',
            publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
          }],
        },
      },
    })
    expect(forwarded).toMatchObject({
      campaignId: 'bilibili-assisted-campaign',
      execution: { mode: 'assisted-prepare' },
      packages: [{
        channel: 'bilibili',
        contentStudio: {
          artifactRefs: [{
            artifactId: 'bilibili-assisted-cover',
            sha256: coverSha256,
          }],
          packageId: 'bilibili-assisted-publication',
          publicationId: 'bilibili-assisted-publication',
        },
      }],
      projectId,
    })
    expect(JSON.stringify(forwarded)).not.toContain('relativePath')
    expect(service.getProjectView(projectId).publicationReceipts).toEqual([])
    expect(service.getProjectView(projectId).tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'awaiting-owner',
        taskId: 'publication-bilibili-assisted-publication',
      }),
    ]))

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-confirm',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:02:00.000Z',
            source: 'owner-prompt',
          },
          execution: {
            mode: 'assisted-confirm',
            publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
          },
          handoffId,
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          mode: 'assisted-confirm',
          receipts: [{
            publicationId: 'bilibili-assisted-publication',
            status: 'published',
          }],
        },
      },
    })
    expect(forwarded?.execution).toMatchObject({
      confirmations: [{
        form: 'image-text',
        packageId: 'bilibili-assisted-publication',
        publicationId: 'bilibili-assisted-publication',
      }],
      mode: 'assisted-confirm',
    })
    expect(service.getProjectView(projectId).publicationReceipts).toMatchObject([{
      publicationId: 'bilibili-assisted-publication',
      publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
      status: 'published',
    }])
    expect(service.getProjectView(projectId).ownerHandoffs).toMatchObject([{
      handoffId,
      status: 'completed',
    }])

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-confirm-retry',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:03:00.000Z',
            source: 'owner-prompt',
          },
          execution: {
            mode: 'assisted-confirm',
            publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
          },
          handoffId,
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          receipts: [{ receiptId: 'bilibili-owner-confirmed-1' }],
        },
      },
    })
    expect(service.getProjectView(projectId).publicationReceipts).toHaveLength(1)

    const abandonedContent = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: ['bilibili-assisted-cover'],
      body: '待放弃的快速排序图文：https://example.com/bilibili/',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'bilibili-abandon-content',
      format: 'image-text',
      locale: 'zh-CN',
      projectId,
      title: '待放弃的快速排序图文',
    })
    service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: abandonedContent.contentId,
      projectId,
      publicationId: 'bilibili-abandon-publication',
    })
    const abandonPrepared = await server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-abandon-prepare',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:05:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-prepare' },
          projectId,
          publicationId: 'bilibili-abandon-publication',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: ['image'],
            utmMedium: 'social',
          },
        },
      },
    })
    expect(abandonPrepared).toMatchObject({
      result: {
        isError: false,
        structuredContent: { handoff: { status: 'pending' } },
      },
    })
    const abandonHandoffId = (abandonPrepared as {
      result: { structuredContent: { handoff: { handoffId: string } } }
    }).result.structuredContent.handoff.handoffId
    const statusCallsBeforeAbandon = getChannelsStatus.mock.calls.length
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-abandon',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:06:00.000Z',
            source: 'owner-prompt',
          },
          execution: { mode: 'assisted-abandon' },
          handoffId: abandonHandoffId,
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          handoff: { handoffId: abandonHandoffId, status: 'cancelled' },
          handoffs: [{
            packageId: 'bilibili-abandon-publication',
            status: 'abandoned',
          }],
          mode: 'assisted-abandon',
          receipts: [],
        },
      },
    })
    expect(getChannelsStatus).toHaveBeenCalledTimes(statusCallsBeforeAbandon)
    expect(forwarded?.execution).toEqual({ mode: 'assisted-abandon' })
    expect(service.getProjectView(projectId).ownerHandoffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ handoffId: abandonHandoffId, status: 'cancelled' }),
    ]))

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-confirm-different-url',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:04:00.000Z',
            source: 'owner-prompt',
          },
          execution: {
            mode: 'assisted-confirm',
            publicUrl: 'https://www.bilibili.com/opus/966723264948731942',
          },
          handoffId,
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        content: [{ text: expect.stringMatching(/another public URL/i) }],
        isError: true,
      },
    })
    expect(service.getProjectView(projectId).publicationReceipts).toHaveLength(1)
  })

  it('surfaces marketing-ops assisted preparation failures in the MCP error text', async () => {
    const observedAt = new Date()
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    service.registerProject(project, snapshot)
    const { assetBundleRoot, sourceRoot } = createMarketingOpsStagingRoots()
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId,
    })
    const activity = service.createActivity({
      activityId: 'bilibili-assisted-activity',
      campaignId: 'bilibili-assisted-campaign',
      channels: [{
        contentFormats: ['image-text'],
        id: 'bilibili',
        locale: 'zh-CN',
      }],
      goal: 'education',
      projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://example.com/bilibili/',
      topic: { 'en': 'Bilibili package', 'zh-CN': 'Bilibili 图文包' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'bilibili-assisted-group',
      coreMessage: 'Prepare the image-text package.',
      projectId,
      title: 'Bilibili package',
    })
    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'bilibili-assisted-cover',
      kind: 'image',
      locale: 'zh-CN',
      projectId,
      relativePath: '.content-studio/bilibili-assisted/cover.png',
      sha256: await writeMarketingOpsSourceArtifact(
        sourceRoot,
        projectId,
        '.content-studio/bilibili-assisted/cover.png',
        'bilibili-assisted-cover',
      ),
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: ['bilibili-assisted-cover'],
      body: '快速排序图文：https://example.com/bilibili/',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'bilibili-assisted-content',
      format: 'image-text',
      locale: 'zh-CN',
      projectId,
      title: '快速排序图文',
    })
    service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: content.contentId,
      projectId,
      publicationId: 'bilibili-assisted-publication',
    })
    const server = createContentStudioMcpServer({
      marketingOpsPublish: {
        publishCampaign: async () => ({
          campaignId: 'bilibili-assisted-campaign',
          failures: [{
            code: 'UNKNOWN_RESULT',
            message: 'image paste timed out',
            packageId: 'bilibili-assisted-publication',
            retryable: false,
          }],
          handoffs: [],
          limitations: [],
          projectId,
          receipts: [],
        }),
      },
      marketingOpsStatus: {
        getChannelsStatus: async () => ({
          authorizesExternalWrite: false,
          capabilities: ['content-studio-assisted-publication-v1'],
          channels: [{
            accountRef: 'bilibili-main',
            adapterReady: true,
            alias: null,
            assistedPublicationReady: true,
            channel: 'bilibili',
            health: 'ready',
            nextAction: 'Publish in the official Bilibili UI, then confirm its public URL',
            nextStep: 'ready',
          }],
          contractVersion: 3,
          expiresAt: new Date(observedAt.getTime() + 30_000).toISOString(),
          observedAt: observedAt.toISOString(),
          projectId,
          runtimeVersion: '0.1.0',
        }),
      },
      marketingOpsAssetBundleRoot: assetBundleRoot,
      marketingOpsSourceRoot: sourceRoot,
      projectId,
      service,
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'bilibili-assisted-prepare-failure',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: {
            mode: 'assisted-prepare',
          },
          projectId,
          publicationId: 'bilibili-assisted-publication',
          renderer: {
            canonicalUrl: 'https://example.com/bilibili/',
            format: 'manual-package',
            links: ['https://example.com/bilibili/'],
            media: ['image'],
            utmMedium: 'social',
          },
        },
      },
    })).resolves.toMatchObject({
      result: {
        content: [{ text: expect.stringContaining('image paste timed out') }],
        isError: true,
      },
    })
  })

  it('refuses confirmation without a stored owner handoff', async () => {
    const server = createFixture({
      includeBilibili: true,
      marketingOpsPublish: {
        publishCampaign: async () => {
          throw new Error('publish should not be reached without a handoff')
        },
      },
      marketingOpsStatus: {
        getChannelsStatus: async () => freshMarketingOpsStatus(projectId),
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'missing-owner-handoff',
      method: 'tools/call',
      params: {
        name: 'publish_marketing_ops_package',
        arguments: {
          authorization: {
            authorizedAt: '2026-08-10T10:00:00.000Z',
            source: 'owner-prompt',
          },
          execution: {
            mode: 'assisted-confirm',
            publicUrl: 'https://www.bilibili.com/opus/966723264948731941',
          },
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringMatching(/handoff/i) }],
      },
    })
  })

  it('rechecks the current Bilibili owner-assisted binding before confirmation', async () => {
    const updates = [
      { enabled: false },
      { delivery: 'content-only' as const },
      { accountRef: 'bilibili-other' },
    ]
    for (const update of updates) {
      const fixture = await createBilibiliAssistedConfirmationFixture()
      fixture.setBinding(update)

      await expect(fixture.confirm('https://www.bilibili.com/opus/100001')).resolves.toMatchObject({
        result: {
          content: [{ text: expect.stringMatching(/binding|account scope/i) }],
          isError: true,
        },
      })
      expect(fixture.service.getProjectView(projectId).publicationReceipts).toEqual([])
      expect(
        fixture.service.getProjectView(projectId).ownerHandoffs[0]?.marketingOpsConfirmation,
      ).toBeUndefined()
    }
  })

  it('validates the complete confirmation result before recording any receipt', async () => {
    const cases: Array<{
      expectedMessage: RegExp
      name: string
      result: MarketingOpsConfirmationFactory
    }> = [
      {
        expectedMessage: /exactly one/i,
        name: 'two receipts',
        result: (input) => {
          const publicUrl = input.execution.mode === 'assisted-confirm'
            ? input.execution.confirmations[0]!.publicUrl
            : 'https://www.bilibili.com/opus/100001'
          const first = confirmationReceipt(input, publicUrl, 'bilibili-receipt-one')
          return {
            campaignId: input.campaignId,
            failures: [],
            handoffs: [],
            limitations: [],
            projectId: input.projectId,
            receipts: [first, {
              ...first,
              externalReceiptId: 'external-bilibili-receipt-two',
              receiptId: 'bilibili-receipt-two',
            }],
          }
        },
      },
      {
        expectedMessage: /failures/i,
        name: 'one failure and one success',
        result: (input) => {
          const publicUrl = input.execution.mode === 'assisted-confirm'
            ? input.execution.confirmations[0]!.publicUrl
            : 'https://www.bilibili.com/opus/100001'
          return {
            campaignId: input.campaignId,
            failures: [{
              code: 'owner-confirmation-partial',
              message: 'one package failed',
              packageId: input.packages[0]!.contentStudio.packageId,
              retryable: false,
            }],
            handoffs: [],
            limitations: [],
            projectId: input.projectId,
            receipts: [confirmationReceipt(
              input,
              publicUrl,
              'bilibili-success-with-failure',
            )],
          }
        },
      },
    ]

    for (const testCase of cases) {
      const fixture = await createBilibiliAssistedConfirmationFixture()
      fixture.setConfirmationResult(testCase.result)
      await expect(fixture.confirm('https://www.bilibili.com/opus/100001')).resolves.toMatchObject({
        result: {
          content: [{ text: expect.stringMatching(testCase.expectedMessage) }],
          isError: true,
        },
      })
      expect(fixture.service.getProjectView(projectId).publicationReceipts).toEqual([])
      expect(
        fixture.service.getProjectView(projectId).ownerHandoffs[0]?.marketingOpsConfirmation,
      ).toBeUndefined()
    }
  })

  it('initializes a standard MCP client before exposing tools and resources', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'initialize-1',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: {
          name: 'codex-host-test',
          version: '1.0.0',
        },
        protocolVersion: '2025-11-25',
      },
    })).resolves.toMatchObject({
      id: 'initialize-1',
      jsonrpc: '2.0',
      result: {
        capabilities: {
          resources: {},
          tools: {},
        },
        protocolVersion: '2025-11-25',
        serverInfo: {
          name: 'content-studio',
          version: '0.1.0',
        },
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })).resolves.toBeUndefined()
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping',
    })).resolves.toEqual({
      id: 'ping-1',
      jsonrpc: '2.0',
      result: {},
    })
  })

  it('discovers a project-scoped, stateless server', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: { _meta: requestMeta() },
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        cacheScope: 'private',
        capabilities: {
          extensions: {
            'io.modelcontextprotocol/tasks': {},
          },
          resources: {},
          tools: {},
        },
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        ttlMs: 60_000,
        _meta: {
          'io.content-studio/project': {
            projectId,
          },
          'io.modelcontextprotocol/serverInfo': {
            name: 'content-studio',
            version: '0.1.0',
          },
        },
      },
    })
  })

  it('lists and reads only resources for the registered project', async () => {
    const server = createFixture()

    const list = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
    })
    expect(list).toMatchObject({
      result: {
        cacheScope: 'private',
        resultType: 'complete',
        ttlMs: 60_000,
        resources: expect.arrayContaining([
          expect.objectContaining({
            uri: `content-studio://projects/${projectId}/view`,
          }),
          expect.objectContaining({
            uri: `content-studio://projects/${projectId}/assets`,
          }),
          expect.objectContaining({
            uri: `content-studio://projects/${projectId}/receipts`,
          }),
          expect.objectContaining({
            uri: `content-studio://projects/${projectId}/reports`,
          }),
        ]),
      },
    })

    const viewResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: {
        uri: `content-studio://projects/${projectId}/view`,
      },
    })
    expect(viewResponse).toMatchObject({
      result: {
        cacheScope: 'private',
        resultType: 'complete',
        ttlMs: 0,
        contents: [
          expect.objectContaining({
            mimeType: 'application/json',
          }),
        ],
      },
    })
    const viewText = (viewResponse?.result as {
      contents: Array<{ text: string }>
    }).contents[0]?.text
    expect(viewText).toBeDefined()
    const viewPayload = JSON.parse(viewText!) as {
      channelBlueprints: {
        bilibili: {
          contentForms: Array<{
            format: string
            media: { allowedKinds: string[] }
          }>
        }
      }
    }
    expect(viewPayload.channelBlueprints.bilibili.contentForms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          format: 'image-text',
          media: expect.objectContaining({ allowedKinds: ['image'] }),
        }),
        expect.objectContaining({
          format: 'short-post',
          media: expect.objectContaining({ allowedKinds: ['image'] }),
        }),
      ]),
    )

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: {
        uri: 'content-studio://projects/other-project/view',
      },
    })).resolves.toMatchObject({
      error: {
        code: -32003,
      },
    })

    for (const kind of ['activities', 'content', 'tasks', 'assets', 'receipts', 'reports']) {
      const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: `read-${kind}`,
        method: 'resources/read',
        params: {
          uri: `content-studio://projects/${projectId}/${kind}`,
        },
      })
      expect(response).toMatchObject({
        result: {
          contents: [expect.objectContaining({ mimeType: 'application/json' })],
        },
      })
      const text = (response?.result as {
        contents: Array<{ text: string }>
      }).contents[0]?.text
      expect(text).toBeDefined()
      const payload = JSON.parse(text!) as Record<string, unknown>
      if (kind === 'content') {
        expect(payload).toEqual({
          channelContentReadiness: {},
          channelContents: [],
          contentGroups: [],
        })
      }
      if (kind === 'tasks')
        expect(payload).toEqual({ compositionReceipts: [], taskEvents: {}, tasks: [] })
      if (kind === 'assets')
        expect(payload).toEqual({ activityArtifacts: [], projectAssets: [] })
      if (kind === 'receipts')
        expect(payload).toEqual({ publicationPlans: [], publicationReceipts: [] })
      if (kind === 'reports')
        expect(payload).toEqual({ monitoringObservations: [], reports: [] })
    }
  })

  it('returns an empty resource template list for standard MCP hosts', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'resource-templates-1',
      method: 'resources/templates/list',
    })).resolves.toMatchObject({
      id: 'resource-templates-1',
      jsonrpc: '2.0',
      result: {
        cacheScope: 'private',
        resourceTemplates: [],
        resultType: 'complete',
        ttlMs: 60_000,
      },
    })
  })

  it('describes the available tools and reports protocol errors', async () => {
    const server = createFixture()

    const toolsResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/list',
    })
    const listedTools = (toolsResponse?.result as {
      tools: Array<{
        annotations: Record<string, boolean>
        inputSchema: unknown
        name: string
      }>
    }).tools
    expect(listedTools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'create_owner_handoff',
      'create_publication_plan',
      'create_publishing_activity',
      'get_activity_video_plan',
      'get_marketing_ops_channels_status',
      'prepare_marketing_ops_package',
      'promote_activity_artifact',
      'register_activity_artifact',
      'revise_channel_content_media',
      'retry_task',
    ]))
    const preparePackageTool = listedTools.find(tool =>
      tool.name === 'prepare_marketing_ops_package',
    )
    expect(preparePackageTool).toMatchObject({
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      inputSchema: {
        additionalProperties: false,
        properties: {
          projectId: { type: 'string' },
          publicationId: { type: 'string' },
          renderer: { additionalProperties: false, type: 'object' },
        },
      },
    })
    expect(JSON.stringify(preparePackageTool?.inputSchema)).not.toContain('accountRef')
    const createActivityTool = listedTools.find(tool => tool.name === 'create_publishing_activity')
    expect(createActivityTool).toBeDefined()
    expect(createActivityTool?.inputSchema).toMatchObject({
      properties: {
        video: {
          properties: {
            outline: { type: 'array' },
            planVersion: { type: 'integer' },
            recordingProfile: {
              properties: {
                channelVariants: { type: 'object' },
                defaults: { type: 'object' },
              },
            },
          },
        },
      },
    })
    const registerArtifactTool = listedTools.find(tool => tool.name === 'register_activity_artifact')
    expect(registerArtifactTool?.inputSchema).toMatchObject({
      properties: {
        locale: { enum: ['en', 'zh-CN', 'neutral'] },
      },
    })
    const recordingProfile = (createActivityTool?.inputSchema as {
      properties: {
        video: {
          properties: {
            recordingProfile: {
              properties: {
                channelVariants: {
                  additionalProperties: {
                    properties: Record<string, unknown>
                  }
                }
                defaults: { properties: Record<string, unknown> }
              }
            }
          }
        }
      }
    }).properties.video.properties.recordingProfile.properties
    expect(recordingProfile.defaults.properties).not.toHaveProperty('format')
    expect(recordingProfile.channelVariants.additionalProperties.properties)
      .toMatchObject({
        format: {
          enum: ['landscape', 'portrait', 'square'],
          type: 'string',
        },
      })
    const channelSchema = (createActivityTool?.inputSchema as {
      properties: {
        channels: {
          items: {
            properties: {
              contentFormats: unknown
            }
          }
        }
      }
    }).properties.channels.items.properties
    expect(channelSchema.contentFormats).toMatchObject({
      items: {
        enum: ['article', 'image-text', 'short-post', 'video-metadata'],
      },
      minItems: 1,
      type: 'array',
      uniqueItems: true,
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 13,
      method: 'unknown/method',
    })).resolves.toMatchObject({
      error: { code: -32601 },
    })
    await expect(server.handleMessage({
      jsonrpc: '1.0',
      id: 14,
      method: 'server/discover',
    })).resolves.toMatchObject({
      error: { code: -32600 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 15,
      method: 'server/discover',
      params: 'invalid',
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      method: 'server/discover',
    })).resolves.toBeUndefined()
    await expect(server.handleMessage(null)).resolves.toMatchObject({
      error: { code: -32600 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: { invalid: true },
      method: 'server/discover',
    })).resolves.toMatchObject({
      error: { code: -32600 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 24,
      method: 'resources/read',
      params: null,
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 25,
      method: 'resources/read',
      params: { uri: 42 },
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
  })

  it('lets the AI host select multiple content forms for one channel', async () => {
    const server = createFixture({ includeBilibili: true })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'multi-form-activity',
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'bilibili-multi-form',
          campaignId: 'bilibili-multi-form',
          channels: [{
            contentFormats: ['video-metadata', 'image-text', 'short-post'],
            id: 'bilibili',
            locale: 'zh-CN',
          }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/quick-sort/',
          topic: {
            'en': 'Explain quick sort',
            'zh-CN': '讲解快速排序',
          },
          video: {
            flowIds: ['quick-sort'],
            format: 'landscape',
          },
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          channels: [{
            contentFormats: ['video-metadata', 'image-text', 'short-post'],
            id: 'bilibili',
            locale: 'zh-CN',
          }],
        },
      },
    })
  })

  it('accepts per-request metadata on compliant tool calls', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        _meta: requestMeta(),
        arguments: { projectId },
        name: 'get_project_view',
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        resultType: 'complete',
        structuredContent: { project: { projectId } },
      },
    })
  })

  it('exposes only a fresh, project-scoped marketing-ops status snapshot to MCP', async () => {
    const observedAtMs = Date.now()
    const status: MarketingOpsChannelsStatusSnapshot = {
      authorizesExternalWrite: false,
      capabilities: [],
      channels: [{
        accountAlias: '@project-a',
        adapterReady: true,
        channel: 'github',
        health: 'ready',
        nextStep: 'ready',
      }],
      contractVersion: 3,
      expiresAt: new Date(observedAtMs + 60_000).toISOString(),
      observedAt: new Date(observedAtMs).toISOString(),
      projectId,
      runtimeVersion: '0.1.0',
    }
    const server = createFixture({
      marketingOpsStatus: {
        getChannelsStatus: async (requestedProjectId) => {
          expect(requestedProjectId).toBe(projectId)
          return status
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'marketing-status-1',
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'get_marketing_ops_channels_status',
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: status,
      },
    })
  })

  it('keeps the MCP status tool blocked when the managed runtime is not connected', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'marketing-status-unavailable',
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'get_marketing_ops_channels_status',
      },
    })).resolves.toMatchObject({
      result: {
        content: [{
          text: 'Marketing Ops status unavailable; publishing remains blocked',
          type: 'text',
        }],
        isError: true,
      },
    })

    const failingServer = createFixture({
      marketingOpsStatus: {
        getChannelsStatus: async () => {
          throw new Error('private transport detail')
        },
      },
    })
    const failed = await failingServer.handleMessage({
      jsonrpc: '2.0',
      id: 'marketing-status-failed',
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'get_marketing_ops_channels_status',
      },
    })
    expect(failed).toMatchObject({
      result: {
        content: [{
          text: 'Marketing Ops status unavailable; publishing remains blocked',
        }],
        isError: true,
      },
    })
    expect(JSON.stringify(failed)).not.toContain('private transport detail')

    const malformedServer = createFixture({
      marketingOpsStatus: {
        getChannelsStatus: async () => undefined as never,
      },
    })
    const malformed = await malformedServer.handleMessage({
      jsonrpc: '2.0',
      id: 'marketing-status-malformed',
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'get_marketing_ops_channels_status',
      },
    })
    expect(malformed).toMatchObject({
      result: {
        content: [{
          text: 'Marketing Ops status unavailable; publishing remains blocked',
        }],
        isError: true,
      },
    })
    expect(JSON.stringify(malformed)).not.toContain('Cannot read properties')
  })

  it('lets the AI host create an activity and channel content without publishing', async () => {
    const server = createFixture()

    const activityResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'quick-sort-launch',
          campaignId: 'quick-sort-launch',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/quick-sort/',
          topic: {
            'en': 'Explain quick sort',
            'zh-CN': '讲解快速排序',
          },
          video: {
            flowIds: ['quick-sort'],
            format: 'landscape',
            planVersion: 3,
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
        },
      },
    })
    expect(activityResponse).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activityId: 'quick-sort-launch',
          video: {
            flowIds: ['quick-sort'],
            format: 'landscape',
            planVersion: 3,
            outline: [{ flowId: 'quick-sort' }],
          },
        },
      },
    })

    const planResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'get_activity_video_plan',
        arguments: {
          activityId: 'quick-sort-launch',
          projectId,
        },
      },
    })
    expect(planResponse).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          campaignId: 'quick-sort-launch',
          outline: [{ flowId: 'quick-sort' }],
          planVersion: 3,
          reviewStatus: 'pending',
          scenes: [{ id: 'quick-sort', startPath: '/quick-sort' }],
        },
      },
    })

    const groupResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'create_content_group',
        arguments: {
          activityId: 'quick-sort-launch',
          contentGroupId: 'quick-sort-core',
          coreMessage: 'Show partitioning clearly',
          projectId,
          title: 'Quick sort core message',
        },
      },
    })
    expect(groupResponse).toMatchObject({
      result: {
        structuredContent: {
          contentGroupId: 'quick-sort-core',
        },
      },
    })

    const contentResponse = await server.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'save_channel_content',
        arguments: {
          activityId: 'quick-sort-launch',
          body: 'A safe, reviewable draft.',
          channel: 'github',
          contentGroupId: 'quick-sort-core',
          contentId: 'quick-sort-github-en',
          format: 'article',
          locale: 'en',
          projectId,
          title: 'Quick sort explained',
        },
      },
    })
    expect(contentResponse).toMatchObject({
      result: {
        structuredContent: {
          contentId: 'quick-sort-github-en',
        },
      },
    })

    const view = await server.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'get_project_view',
        arguments: { projectId },
      },
    })
    expect(view).toMatchObject({
      result: {
        structuredContent: {
          activities: [expect.objectContaining({ activityId: 'quick-sort-launch' })],
          channelContents: [expect.objectContaining({ contentId: 'quick-sort-github-en' })],
        },
      },
    })
  })

  it('reports content readiness and rejects a publication plan with missing required media', async () => {
    const server = createFixture({ includeBilibili: true })

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'readiness-activity',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'readiness-demo',
          campaignId: 'readiness-demo',
          channels: [{
            contentFormats: ['image-text'],
            id: 'bilibili',
            locale: 'zh-CN',
          }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/readiness-demo/',
          topic: { 'en': 'Readiness', 'zh-CN': '发布就绪检查' },
        },
        name: 'create_publishing_activity',
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'readiness-group',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'readiness-demo',
          contentGroupId: 'readiness-demo-group',
          coreMessage: 'Show the final image before scheduling publication.',
          projectId,
          title: 'Readiness demo',
        },
        name: 'create_content_group',
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'readiness-content',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'readiness-demo',
          artifactIds: [],
          body: 'Image-text body',
          channel: 'bilibili',
          contentGroupId: 'readiness-demo-group',
          contentId: 'readiness-image-text',
          format: 'image-text',
          locale: 'zh-CN',
          projectId,
          title: 'Image-text title',
        },
        name: 'save_channel_content',
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'readiness-publication',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'readiness-demo',
          channel: 'bilibili',
          contentId: 'readiness-image-text',
          projectId,
          publicationId: 'readiness-publication',
        },
        name: 'create_publication_plan',
      },
    })).resolves.toMatchObject({
      result: {
        content: [{
          text: expect.stringMatching(/not ready.*image artifact.*required/i),
          type: 'text',
        }],
        isError: true,
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'readiness-view',
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'get_project_view',
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: {
          channelContentReadiness: {
            'readiness-image-text': {
              matchingArtifactIds: [],
              missingMediaKinds: ['image'],
              ready: false,
            },
          },
        },
      },
    })
  })

  it('revises an existing channel content media reference through MCP', async () => {
    const server = createFixture()

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'media-revision-activity',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'media-revision-demo',
          campaignId: 'media-revision-demo',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/media-revision-demo/',
          topic: { 'en': 'Media revision', 'zh-CN': '媒体修订' },
        },
        name: 'create_publishing_activity',
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'media-revision-group',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'media-revision-demo',
          contentGroupId: 'media-revision-group',
          coreMessage: 'Attach a final image after drafting.',
          projectId,
          title: 'Media revision',
        },
        name: 'create_content_group',
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'media-revision-content',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'media-revision-demo',
          artifactIds: [],
          body: 'Article body',
          channel: 'github',
          contentGroupId: 'media-revision-group',
          contentId: 'media-revision-content',
          format: 'article',
          locale: 'en',
          projectId,
          title: 'Article',
        },
        name: 'save_channel_content',
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 'media-revision-artifact',
      method: 'tools/call',
      params: {
        arguments: {
          activityId: 'media-revision-demo',
          artifactId: 'media-revision-image',
          kind: 'image',
          projectId,
          relativePath: 'media/cover.png',
          sha256: 'c'.repeat(64),
        },
        name: 'register_activity_artifact',
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 'media-revision-call',
      method: 'tools/call',
      params: {
        arguments: {
          artifactIds: ['media-revision-image'],
          baseVersion: 1,
          contentId: 'media-revision-content',
          mode: 'replace',
          projectId,
        },
        name: 'revise_channel_content_media',
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: {
          artifactIds: ['media-revision-image'],
          contentId: 'media-revision-content',
          version: 2,
        },
      },
    })
  })

  it('rejects a cross-project call and sensitive input', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'get_project_view',
        arguments: { projectId: 'other-project' },
      },
    })).resolves.toMatchObject({
      result: { isError: true },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: null,
    })).resolves.toMatchObject({
      result: { isError: true },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 27,
      method: 'tools/call',
      params: { arguments: {}, name: '' },
    })).resolves.toMatchObject({
      result: { isError: true },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'unsafe',
          campaignId: 'unsafe',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          password: 'must-not-be-accepted',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/',
          topic: { 'en': 'Unsafe', 'zh-CN': '不安全' },
        },
      },
    })).resolves.toMatchObject({
      result: { isError: true },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: {
        arguments: { projectId },
        name: 'unknown_tool',
      },
    })).resolves.toMatchObject({
      result: { isError: true },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        arguments: { projectId, unsupported: true },
        name: 'get_project_view',
      },
    })).resolves.toMatchObject({
      result: { isError: true },
    })
  })

  it('exposes task events and safe cancellation/retry controls', async () => {
    const server = createFixture()
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'task-demo',
          campaignId: 'task-demo',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/task-demo/',
          topic: { 'en': 'Task demo', 'zh-CN': '任务演示' },
        },
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 18.1,
      method: 'tools/call',
      params: {
        name: 'save_activity_content_pack',
        arguments: {
          activityId: 'task-demo',
          contentGroupId: 'task-demo-content-group',
          contents: [{
            body: 'Task demo content',
            channel: 'github',
            contentId: 'task-demo-content',
            format: 'article',
            locale: 'en',
            title: 'Task demo content',
          }],
          coreMessage: 'Explain the task demo.',
          projectId,
          title: 'Task demo content group',
        },
      },
    })
    const taskId = 'production-task-demo-content'

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: {
        name: 'list_project_tasks',
        arguments: { projectId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: [expect.objectContaining({ taskId })],
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'cancel_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: expect.objectContaining({ status: 'cancelled' }),
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'retry_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: expect.objectContaining({ status: 'queued' }),
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'get_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: {
          events: expect.arrayContaining([
            expect.objectContaining({ kind: 'attempt-cancelled' }),
            expect.objectContaining({ kind: 'attempt-retried' }),
          ]),
          task: expect.objectContaining({ status: 'queued' }),
        },
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'get_task',
        arguments: { projectId, taskId: 'missing-task' },
      },
    })).resolves.toMatchObject({
      result: { isError: true },
    })
  })

  it('maps domain tasks to the standard Tasks get, update, and cancel shapes', async () => {
    const taskStore = new InMemoryExecutionTaskStore()
    const server = createFixture({ taskStore })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 28,
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'mcp-task-demo',
          campaignId: 'mcp-task-demo',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/mcp-task-demo/',
          topic: { 'en': 'Task polling', 'zh-CN': '任务轮询' },
        },
      },
    })
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 28.1,
      method: 'tools/call',
      params: {
        name: 'save_activity_content_pack',
        arguments: {
          activityId: 'mcp-task-demo',
          contentGroupId: 'mcp-task-demo-content-group',
          contents: [{
            body: 'Task polling content',
            channel: 'github',
            contentId: 'mcp-task-demo-content',
            format: 'article',
            locale: 'en',
            title: 'Task polling content',
          }],
          coreMessage: 'Explain task polling.',
          projectId,
          title: 'Task polling content group',
        },
      },
    })
    const taskId = 'production-mcp-task-demo-content'

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 29,
      method: 'tasks/get',
      params: { _meta: requestMeta(true), taskId },
    })).resolves.toMatchObject({
      result: {
        createdAt: expect.any(String),
        internalStatus: 'queued',
        lastUpdatedAt: expect.any(String),
        pollIntervalMs: 1000,
        resultType: 'complete',
        status: 'working',
        taskId,
        ttlMs: null,
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 30,
      method: 'tasks/update',
      params: {
        _meta: requestMeta(true),
        inputResponses: {},
        taskId,
      },
    })).resolves.toMatchObject({
      result: { resultType: 'complete' },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 31,
      method: 'tasks/cancel',
      params: { _meta: requestMeta(true), taskId },
    })).resolves.toMatchObject({
      result: { resultType: 'complete' },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 32,
      method: 'tasks/get',
      params: { _meta: requestMeta(true), taskId },
    })).resolves.toMatchObject({
      result: {
        internalStatus: 'cancelled',
        resultType: 'complete',
        status: 'cancelled',
      },
    })
  })

  it('schedules video production through the configured local worker', async () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    service.registerProject(project, snapshot)
    service.bindProjectChannel({
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId,
    })
    const jobs: ProductionWorkerJob[] = []
    const cancelled: string[] = []
    const server = createContentStudioMcpServer({
      projectId,
      productionWorker: {
        cancel: (queuedProjectId, taskId) => {
          cancelled.push(`${queuedProjectId}:${taskId}`)
          return true
        },
        enqueue: (job) => {
          jobs.push(job)
          return true
        },
      },
      productionWorkerJob: task => task.productionType === 'video'
        ? {
            baseUrl: 'https://example.com',
            outputDirectory: `.content-studio/production/${task.taskId}`,
            projectId: task.projectId,
            projectOrigin: 'https://example.com',
            taskId: task.taskId,
          }
        : undefined,
      service,
    })

    service.createActivity({
      activityId: 'mcp-video-worker',
      campaignId: 'mcp-video-worker',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://example.com/mcp-video-worker/',
      topic: { 'en': 'Worker scheduling', 'zh-CN': 'Worker 调度' },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const group = service.createContentGroup({
      activityId: 'mcp-video-worker',
      contentGroupId: 'mcp-video-worker-group',
      coreMessage: 'Show the worker scheduling flow.',
      projectId,
      title: 'Worker scheduling',
    })
    service.createChannelContent({
      activityId: 'mcp-video-worker',
      artifactIds: [],
      body: 'Worker scheduling video',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'mcp-video-worker-content',
      format: 'video',
      locale: 'en',
      projectId,
      title: 'Worker scheduling video',
    })
    const taskId = 'production-mcp-video-worker-content'

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 43,
      method: 'tools/call',
      params: {
        _meta: requestMeta(true),
        name: 'start_production_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        createdAt: expect.any(String),
        internalStatus: 'generating',
        lastUpdatedAt: expect.any(String),
        resultType: 'task',
        status: 'working',
        taskId,
        ttlMs: null,
      },
    })
    expect(jobs).toEqual([expect.objectContaining({ projectId, taskId })])

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 44,
      method: 'tools/call',
      params: {
        name: 'cancel_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: { status: 'cancelled' },
      },
    })
    expect(cancelled).toEqual([`${projectId}:${taskId}`])

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 45,
      method: 'tools/call',
      params: {
        name: 'retry_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: { status: 'queued' },
      },
    })
    expect(jobs).toHaveLength(2)

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 46,
      method: 'tools/call',
      params: {
        name: 'start_production_task',
        arguments: { projectId, taskId },
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: { internalStatus: 'generating', status: 'working' },
      },
    })
    expect(jobs).toHaveLength(3)

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 47,
      method: 'tasks/cancel',
      params: { projectId, taskId },
    })).resolves.toMatchObject({
      result: { resultType: 'complete' },
    })
    expect(cancelled).toHaveLength(2)
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 48,
      method: 'tasks/get',
      params: { taskId },
    })).resolves.toMatchObject({
      result: { internalStatus: 'cancelled', status: 'cancelled' },
    })
  })

  it('saves an AI-produced activity content pack in one project-scoped call', async () => {
    const server = createFixture()
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 38,
      method: 'tools/call',
      params: {
        name: 'create_publishing_activity',
        arguments: {
          activityId: 'content-pack-demo',
          campaignId: 'content-pack-demo',
          channels: [{ id: 'github', locale: 'en' }],
          goal: 'education',
          projectId,
          projectSnapshotId: snapshot.snapshotId,
          status: 'draft',
          targetUrl: 'https://example.com/content-pack-demo/',
          topic: { 'en': 'Content pack', 'zh-CN': '内容包' },
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 38.1,
      method: 'tools/call',
      params: {
        name: 'register_activity_artifact',
        arguments: {
          activityId: 'content-pack-demo',
          artifactId: 'content-pack-cover',
          kind: 'image',
          locale: 'neutral',
          projectId,
          relativePath: '.content-studio/content-pack-demo/cover.png',
          sha256: 'a'.repeat(64),
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activityId: 'content-pack-demo',
          artifactId: 'content-pack-cover',
          locale: 'neutral',
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 39,
      method: 'tools/call',
      params: {
        name: 'save_activity_content_pack',
        arguments: {
          activityId: 'content-pack-demo',
          contentGroupId: 'content-pack-core',
          contents: [{
            artifactIds: ['content-pack-cover'],
            body: 'An AI-written, reviewable article draft: https://example.com/content-pack-demo/',
            channel: 'github',
            contentId: 'content-pack-github-en',
            format: 'article',
            locale: 'en',
            title: 'Content pack draft',
          }],
          coreMessage: 'Explain the project clearly and invite review.',
          projectId,
          title: 'Content pack core message',
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          contentGroup: { contentGroupId: 'content-pack-core' },
          contents: [{ contentId: 'content-pack-github-en' }],
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 39.1,
      method: 'tools/call',
      params: {
        name: 'promote_activity_artifact',
        arguments: {
          artifactId: 'content-pack-cover',
          assetId: 'content-pack-cover-asset',
          kind: 'image',
          projectId,
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          assetId: 'content-pack-cover-asset',
          sourceArtifactId: 'content-pack-cover',
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: {
        name: 'create_publication_plan',
        arguments: {
          activityId: 'content-pack-demo',
          channel: 'github',
          contentId: 'content-pack-github-en',
          projectId,
          publicationId: 'content-pack-publication',
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activityId: 'content-pack-demo',
          channel: 'github',
          contentId: 'content-pack-github-en',
          publicationId: 'content-pack-publication',
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 40.1,
      method: 'tools/call',
      params: {
        name: 'prepare_marketing_ops_package',
        arguments: {
          projectId,
          publicationId: 'content-pack-publication',
          renderer: {
            canonicalUrl: 'https://example.com/content-pack-demo/',
            format: 'release',
            links: ['https://example.com/content-pack-demo/'],
            media: ['image'],
            utmMedium: 'community',
          },
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          externalWrite: false,
          mode: 'prepare-only',
          package: {
            artifactRefs: [{
              artifactId: 'content-pack-cover',
              mediaKind: 'image',
            }],
            channel: 'github',
            contentId: 'content-pack-github-en',
            packageId: 'content-pack-publication',
            projectId,
          },
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: {
        name: 'create_owner_handoff',
        arguments: {
          activityId: 'content-pack-demo',
          artifactChecksums: ['a'.repeat(64)],
          channel: 'github',
          checklist: ['确认标题', '确认封面', '完成最终点击'],
          expiresAt: '2026-08-03T00:00:00.000Z',
          handoffId: 'content-pack-handoff',
          officialTargetUrl: 'https://github.com/example/project/releases/new',
          projectId,
          publicationId: 'content-pack-publication',
          status: 'pending',
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          activityId: 'content-pack-demo',
          handoffId: 'content-pack-handoff',
          publicationId: 'content-pack-publication',
          status: 'pending',
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'start_production_task',
        arguments: {
          projectId,
          taskId: 'production-content-pack-github-en',
        },
      },
    })).resolves.toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          internalStatus: 'generating',
          status: 'working',
        },
      },
    })
  })

  it('maps owner input, failure, and completion states without allowing MCP to invent them', async () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    service.registerProject(project, snapshot)
    service.bindProjectChannel({
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId,
    })
    const server = createContentStudioMcpServer({ projectId, service })
    service.createActivity({
      activityId: 'state-demo',
      campaignId: 'state-demo',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://example.com/state-demo/',
      topic: { 'en': 'State demo', 'zh-CN': '状态演示' },
    })
    const group = service.createContentGroup({
      activityId: 'state-demo',
      contentGroupId: 'state-demo-content-group',
      coreMessage: 'Explain state transitions.',
      projectId,
      title: 'State demo content group',
    })
    const content = service.createChannelContent({
      activityId: 'state-demo',
      artifactIds: [],
      body: 'State demo content',
      channel: 'github',
      contentGroupId: group.contentGroupId,
      contentId: 'state-demo-content',
      format: 'article',
      locale: 'en',
      projectId,
      title: 'State demo content',
    })
    const taskId = `production-${content.contentId}`
    taskStore.transitionTask(projectId, taskId, 'generating')
    taskStore.transitionTask(projectId, taskId, 'recording')
    taskStore.transitionTask(projectId, taskId, 'composing')
    taskStore.transitionTask(projectId, taskId, 'awaiting-owner')

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 33,
      method: 'tasks/get',
      params: { taskId },
    })).resolves.toMatchObject({
      result: {
        inputRequests: {
          'owner-confirmation': {
            method: 'elicitation/create',
          },
        },
        internalStatus: 'awaiting-owner',
        status: 'input_required',
      },
    })

    taskStore.transitionTask(projectId, taskId, 'recording')
    taskStore.transitionTask(projectId, taskId, 'composing')
    taskStore.transitionTask(projectId, taskId, 'completed')
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 34,
      method: 'tasks/get',
      params: { taskId },
    })).resolves.toMatchObject({
      result: {
        internalStatus: 'completed',
        result: {
          isError: false,
          resultType: 'complete',
        },
        status: 'completed',
      },
    })

    const compositionTaskId = 'composition-mcp-task-demo'
    taskStore.createTask({
      activityId: 'mcp-task-demo',
      kind: 'production',
      productionType: 'video',
      projectId,
      taskId: compositionTaskId,
    })
    taskStore.transitionTask(projectId, compositionTaskId, 'generating')
    taskStore.transitionTask(projectId, compositionTaskId, 'recording')
    taskStore.transitionTask(projectId, compositionTaskId, 'composing')
    taskStore.appendCompositionEvent(projectId, compositionTaskId, {
      kind: 'composition-started',
      message: 'Composition started',
    })
    taskStore.saveCompositionReceipt(projectId, compositionTaskId, {
      artifacts: [{
        artifactId: `composed-${compositionTaskId}`,
        height: 1080,
        kind: 'video',
        relativePath: 'production/composed/final.webm',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
        width: 1920,
      }],
      attempt: 1,
      jobId: compositionTaskId,
      outcome: 'succeeded',
      projectId,
      receiptVersion: 1,
    })
    taskStore.transitionTask(projectId, compositionTaskId, 'completed')
    taskStore.appendCompositionEvent(projectId, compositionTaskId, {
      kind: 'composition-completed',
      message: 'Composition completed',
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 34.1,
      method: 'tasks/get',
      params: { _meta: requestMeta(true), taskId: compositionTaskId },
    })).resolves.toMatchObject({
      result: {
        composition: {
          events: expect.arrayContaining([
            expect.objectContaining({ kind: 'composition-started' }),
            expect.objectContaining({ kind: 'composition-completed' }),
          ]),
          receipts: [expect.objectContaining({
            outcome: 'succeeded',
          })],
        },
        internalStatus: 'completed',
      },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 34.2,
      method: 'tools/call',
      params: {
        arguments: { projectId, taskId: compositionTaskId },
        name: 'get_task',
      },
    })).resolves.toMatchObject({
      result: {
        structuredContent: {
          compositionReceipts: [expect.objectContaining({ outcome: 'succeeded' })],
        },
      },
    })

    service.createActivity({
      activityId: 'failed-state-demo',
      campaignId: 'failed-state-demo',
      channels: [{ id: 'github', locale: 'en' }],
      goal: 'education',
      projectId,
      projectSnapshotId: snapshot.snapshotId,
      status: 'draft',
      targetUrl: 'https://example.com/failed-state-demo/',
      topic: { 'en': 'Failed state', 'zh-CN': '失败状态' },
    })
    const failedGroup = service.createContentGroup({
      activityId: 'failed-state-demo',
      contentGroupId: 'failed-state-content-group',
      coreMessage: 'Explain the failed state.',
      projectId,
      title: 'Failed state content group',
    })
    const failedContent = service.createChannelContent({
      activityId: 'failed-state-demo',
      artifactIds: [],
      body: 'Failed state content',
      channel: 'github',
      contentGroupId: failedGroup.contentGroupId,
      contentId: 'failed-state-content',
      format: 'article',
      locale: 'en',
      projectId,
      title: 'Failed state content',
    })
    const failedTaskId = `production-${failedContent.contentId}`
    taskStore.transitionTask(projectId, failedTaskId, 'generating')
    taskStore.transitionTask(projectId, failedTaskId, 'failed')
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 35,
      method: 'tasks/get',
      params: { taskId: failedTaskId },
    })).resolves.toMatchObject({
      result: {
        error: { code: expect.any(Number), message: expect.any(String) },
        internalStatus: 'failed',
        status: 'failed',
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 36,
      method: 'tasks/get',
      params: { taskId: 'Invalid_Task' },
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 37,
      method: 'tasks/update',
      params: { inputResponses: [], taskId },
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })

    taskStore.createTask({
      activityId: 'state-demo',
      kind: 'monitoring',
      projectId,
      taskId: 'monitoring-task',
    })
    taskStore.transitionTask(projectId, 'monitoring-task', 'monitoring')
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 38,
      method: 'tasks/cancel',
      params: { taskId: 'monitoring-task' },
    })).resolves.toMatchObject({
      result: { resultType: 'complete' },
    })
    expect(taskStore.getTask(projectId, 'monitoring-task')?.status)
      .toBe('monitoring')
  })

  it('serves newline-delimited JSON-RPC over stdio without writing diagnostics to stdout', async () => {
    const server = createFixture()
    const lines: string[] = []
    const output = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk))
        callback()
      },
    })
    await serveMcpStdio(
      server,
      {
        input: Readable.from([
          '\n',
          'not-json\n',
          `${JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'server/discover' })}\n`,
        ]),
        output,
      },
    )
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({
      id: 11,
      result: { supportedVersions: ['2026-07-28'] },
    })
  })

  it('accepts owner confirmation through Tasks inputResponses', async () => {
    const taskStore = new InMemoryExecutionTaskStore()
    const ownerTakeovers = new OwnerTakeoverRegistry(taskStore)
    taskStore.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId,
      taskId: 'task-input-demo',
    })
    taskStore.transitionTask(projectId, 'task-input-demo', 'generating')
    taskStore.transitionTask(projectId, 'task-input-demo', 'recording')
    const pending = ownerTakeovers.request({
      jobId: 'task-input-demo',
      pageUrl: 'https://example.com/login',
      projectId,
    })
    const server = createFixture({ ownerTakeovers, taskStore })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 89,
      method: 'tasks/update',
      params: {
        inputResponses: {
          'owner-confirmation': {
            action: 'accept',
            content: { confirmed: true },
          },
        },
        taskId: 'task-input-demo',
      },
    })).resolves.toMatchObject({
      result: { resultType: 'complete' },
    })
    await expect(pending).resolves.toMatchObject({
      confirmedAt: expect.any(String),
    })
    expect(taskStore.getTask(projectId, 'task-input-demo')?.status)
      .toBe('recording')
  })

  it('confirms a pending owner takeover through the confirm_owner_takeover tool', async () => {
    const taskStore = new InMemoryExecutionTaskStore()
    const ownerTakeovers = new OwnerTakeoverRegistry(taskStore)
    taskStore.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId,
      taskId: 'video-task',
    })
    taskStore.transitionTask(projectId, 'video-task', 'generating')
    taskStore.transitionTask(projectId, 'video-task', 'recording')
    const pending = ownerTakeovers.request({
      jobId: 'video-task',
      pageUrl: 'https://example.com/login',
      projectId,
    })
    const server = createFixture({ ownerTakeovers, taskStore })

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 90,
      method: 'tools/call',
      params: {
        name: 'confirm_owner_takeover',
        arguments: {
          projectId,
          taskId: 'video-task',
        },
      },
    })

    expect(response).toMatchObject({
      result: {
        isError: false,
        structuredContent: {
          ownerTakeover: {
            confirmedAt: expect.any(String),
            requestedAt: expect.any(String),
          },
          projectId,
          task: { status: 'recording' },
          taskId: 'video-task',
        },
      },
    })
    await expect(pending).resolves.toEqual(
      expect.objectContaining({ confirmedAt: expect.any(String) }),
    )
    expect(taskStore.getTask(projectId, 'video-task')?.status).toBe('recording')
    expect(ownerTakeovers.listPending()).toHaveLength(0)
  })

  it('rejects owner takeover confirmation when the runtime has no registry', async () => {
    const server = createFixture()

    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: 91,
      method: 'tools/call',
      params: {
        name: 'confirm_owner_takeover',
        arguments: {
          projectId,
          taskId: 'video-task',
        },
      },
    })

    expect(response).toMatchObject({
      result: { isError: true },
    })
  })

  it('dismisses a pending owner takeover when the task is cancelled', async () => {
    const taskStore = new InMemoryExecutionTaskStore()
    const ownerTakeovers = new OwnerTakeoverRegistry(taskStore)
    taskStore.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId,
      taskId: 'video-task',
    })
    taskStore.transitionTask(projectId, 'video-task', 'generating')
    taskStore.transitionTask(projectId, 'video-task', 'recording')
    const pending = ownerTakeovers.request({
      jobId: 'video-task',
      pageUrl: 'https://example.com/login',
      projectId,
    })
    const server = createFixture({ ownerTakeovers, taskStore })

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 92,
      method: 'tools/call',
      params: {
        name: 'cancel_task',
        arguments: {
          projectId,
          taskId: 'video-task',
        },
      },
    })

    await expect(pending).rejects.toThrow(/cancelled/i)
    expect(ownerTakeovers.listPending()).toHaveLength(0)
    expect(taskStore.getTask(projectId, 'video-task')?.status).toBe('cancelled')
  })
})
