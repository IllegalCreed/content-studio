// @env node

import type { MarketingOpsCampaignRequest, PublicationReceipt } from '../types'
import { describe, expect, it } from 'vitest'
import { MARKETING_OPS_STATUS_TTL_MS } from '../constants'
import {
  assertMatchingMarketingOpsReceipt,
  assessMarketingOpsCompatibility,
  createFakeMarketingOpsClient,
  createMarketingOpsManagedRuntime,
  createMarketingOpsMcpPublishClient,
  createMarketingOpsMcpStatusClient,
  createMarketingOpsStatusClient,
  isMarketingOpsStatusSnapshotFresh,
} from './client'

describe('marketing-ops client boundary', () => {
  it('adapts an initialized MCP client through the fixed publish_campaign tool only', async () => {
    const calls: unknown[] = []
    const request: MarketingOpsCampaignRequest = {
      authorization: {
        authorizedAt: '2026-08-10T00:00:00.000Z',
        source: 'owner-prompt',
      },
      campaignId: 'campaign-a',
      execution: { mode: 'assisted-prepare' },
      idempotencyKey: 'content-studio/12345678',
      packages: [{
        channel: 'bilibili',
        contentStudio: {
          activityId: 'activity-a',
          artifactRefs: [],
          contentFormat: 'short-post',
          contentHash: 'a'.repeat(64),
          contentId: 'content-a',
          contentVersion: 1,
          packageId: 'package-a',
          projectId: 'project-a',
          publicationId: 'publication-a',
          schemaVersion: 1,
        },
        format: 'manual-package',
        utmMedium: 'social',
        variants: [{
          body: 'A short update',
          links: ['https://example.test/'],
          locale: 'en',
          media: [],
          title: 'Update',
        }],
      }],
      projectId: 'project-a',
      spec: {
        campaign: 'campaign-a',
        channels: ['bilibili'],
        content: {
          media: [],
          variants: {
            en: {
              angle: 'A short update',
              callToAction: 'Open',
              title: 'Update',
            },
          },
        },
        failureMode: 'continue-supported',
        id: 'campaign-a',
        locales: ['en'],
        publishAt: '2026-08-10T00:00:00.000Z',
        replies: { createBugIssues: false, mode: 'off' },
        schemaVersion: 1,
        targetUrls: ['https://example.test/'],
        topic: 'Update',
      },
    }
    const client = createMarketingOpsMcpPublishClient({
      mcp: {
        callTool: async (input) => {
          calls.push(input)
          return {
            content: [{ text: 'Untrusted display text', type: 'text' }],
            isError: false,
            structuredContent: {
              campaignId: 'campaign-a',
              failures: [],
              handoffs: [{
                channel: 'bilibili',
                contentHash: 'b'.repeat(64),
                contentStudioContentHash: 'a'.repeat(64),
                form: 'short-post',
                idempotencyKey: 'campaign-v3/project-a/campaign-a/bilibili/package-a/12345678',
                packageId: 'package-a',
                publicationId: 'publication-a',
                status: 'awaiting-owner',
              }],
              limitations: [],
              projectId: 'project-a',
              receipts: [],
            },
          }
        },
      },
    })

    await expect(client.publishCampaign(request)).resolves.toMatchObject({
      handoffs: [{ form: 'short-post', packageId: 'package-a' }],
      projectId: 'project-a',
    })
    expect(calls).toEqual([{
      arguments: request,
      name: 'publish_campaign',
    }])

    const failingClient = createMarketingOpsMcpPublishClient({
      mcp: {
        callTool: async () => ({
          content: [{ text: JSON.stringify({ code: 'UNKNOWN_RESULT', message: 'image paste timed out' }), type: 'text' }],
          isError: true,
          structuredContent: {
            code: 'UNKNOWN_RESULT',
            message: 'image paste timed out',
          },
        }),
      },
    })
    await expect(failingClient.publishCampaign(request)).rejects.toThrow(/image paste timed out/)

    const sensitiveFailure = createMarketingOpsMcpPublishClient({
      mcp: {
        callTool: async () => ({
          content: [{ text: 'Bearer private-token', type: 'text' }],
          isError: true,
          structuredContent: {
            code: 'UNKNOWN_RESULT',
            message: 'Bearer private-token',
          },
        }),
      },
    })
    await expect(sensitiveFailure.publishCampaign(request)).rejects.toThrow(
      /^Marketing-ops publish failed: Marketing-ops MCP tool failed: UNKNOWN_RESULT$/,
    )
  })

  it('creates a deterministic local receipt without touching a channel', async () => {
    const client = createFakeMarketingOpsClient({
      now: () => new Date('2026-08-04T00:00:00.000Z'),
    })
    await expect(client.publish({
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      contentSha256: 'a'.repeat(64),
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).resolves.toEqual({
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      contentSha256: 'a'.repeat(64),
      externalReceiptId: 'fixture-publication-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      projectId: 'project-a',
      publicationId: 'publication-a',
      publicUrl: 'https://marketing-ops.invalid/publication-a',
      receiptId: 'marketing-ops-publication-a',
      source: 'marketing-ops',
      status: 'published',
    })
  })

  it('rejects a receipt without the marketing-ops source or matching account', () => {
    const base: PublicationReceipt = {
      activityId: 'activity-a',
      channel: 'youtube',
      externalReceiptId: 'external-a',
      issuedAt: '2026-08-04T00:00:00.000Z',
      projectId: 'project-a',
      publicationId: 'publication-a',
      receiptId: 'receipt-a',
      source: 'marketing-ops',
      status: 'published',
    }
    expect(() => assertMatchingMarketingOpsReceipt({ ...base, source: undefined }, {
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).toThrow(/marketing-ops/i)
    expect(() => assertMatchingMarketingOpsReceipt({ ...base, accountRef: 'other-account' }, {
      accountRef: 'account-youtube-main',
      activityId: 'activity-a',
      channel: 'youtube',
      projectId: 'project-a',
      publicationId: 'publication-a',
    })).toThrow(/account/i)
  })

  it('creates a fresh, sanitized channels snapshot that grants no write authority', async () => {
    const calls: string[] = []
    const client = createMarketingOpsStatusClient({
      now: () => new Date('2026-08-09T12:00:00.000Z'),
      transport: {
        getChannelsStatus: async (input) => {
          calls.push(input.projectId)
          return {
            channels: [{
              adapterReady: true,
              alias: '@project-release-bot',
              channel: 'github',
              health: 'ready',
              nextAction: null,
            }, {
              adapterReady: false,
              alias: null,
              channel: 'weibo',
              health: 'blocked',
              nextAction: 'Keep publishing disabled',
            }],
            contractVersion: 3,
            projectId: 'project-a',
          }
        },
        getRuntimeInfo: async () => ({
          name: 'marketing-ops',
          version: '0.1.0+codex.20260728231229',
        }),
      },
    })

    const snapshot = await client.getChannelsStatus('project-a')

    expect(calls).toEqual(['project-a'])
    expect(snapshot).toEqual({
      authorizesExternalWrite: false,
      capabilities: [],
      channels: [{
        accountAlias: '@project-release-bot',
        adapterReady: true,
        channel: 'github',
        health: 'ready',
        nextStep: 'ready',
      }, {
        adapterReady: false,
        channel: 'weibo',
        health: 'blocked',
        nextStep: 'blocked',
      }],
      contractVersion: 3,
      expiresAt: new Date(
        Date.parse('2026-08-09T12:00:00.000Z') + MARKETING_OPS_STATUS_TTL_MS,
      ).toISOString(),
      observedAt: '2026-08-09T12:00:00.000Z',
      projectId: 'project-a',
      runtimeVersion: '0.1.0+codex.20260728231229',
    })
    expect(isMarketingOpsStatusSnapshotFresh(
      snapshot,
      new Date('2026-08-09T12:00:59.999Z'),
    )).toBe(true)
    expect(isMarketingOpsStatusSnapshotFresh(
      snapshot,
      new Date('2026-08-09T12:01:00.000Z'),
    )).toBe(false)
    expect(isMarketingOpsStatusSnapshotFresh({
      ...snapshot,
      expiresAt: '2026-08-09T12:02:00.000Z',
    }, new Date('2026-08-09T12:00:30.000Z'))).toBe(false)
  })

  it('defines a fail-closed runtime and contract compatibility matrix', () => {
    expect(assessMarketingOpsCompatibility({
      contractVersion: 3,
      runtimeName: 'marketing-ops',
      runtimeVersion: '0.1.9+codex.local',
    })).toMatchObject({ compatible: true })
    expect(assessMarketingOpsCompatibility({
      contractVersion: 3,
      runtimeName: 'marketing-ops',
      runtimeVersion: '0.2.0',
    })).toMatchObject({ compatible: false, issue: 'runtime-version' })
    expect(assessMarketingOpsCompatibility({
      contractVersion: 4,
      runtimeName: 'marketing-ops',
      runtimeVersion: '0.1.0',
    })).toMatchObject({ compatible: false, issue: 'contract-version' })
    expect(assessMarketingOpsCompatibility({
      contractVersion: 3,
      runtimeName: 'other-runtime',
      runtimeVersion: '0.1.0',
    })).toMatchObject({ compatible: false, issue: 'runtime-name' })
  })

  it('maps reauthorization and configuration health to finite next steps', async () => {
    const client = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          channels: [{
            adapterReady: false,
            alias: null,
            channel: 'bluesky',
            health: 'reauth-required',
            nextAction: 'Run marketing-ops setup bluesky',
          }, {
            adapterReady: false,
            alias: null,
            channel: 'dev',
            health: 'not-configured',
            nextAction: 'Run marketing-ops setup dev',
          }],
          contractVersion: 3,
          projectId: 'project-a',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })
    await expect(client.getChannelsStatus('project-a')).resolves.toMatchObject({
      channels: [{ channel: 'bluesky', nextStep: 'reauthorize' }, {
        channel: 'dev',
        nextStep: 'configure',
      }],
    })
  })

  it('preserves a validated opaque account reference from a status response', async () => {
    const client = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          channels: [{
            accountRef: 'account.github.main',
            adapterReady: true,
            alias: '@renamed-release-bot',
            channel: 'github',
            health: 'ready',
            nextAction: null,
          }],
          contractVersion: 3,
          projectId: 'project-a',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })

    await expect(client.getChannelsStatus('project-a')).resolves.toMatchObject({
      channels: [{
        accountRef: 'account.github.main',
        accountAlias: '@renamed-release-bot',
      }],
    })
  })

  it('preserves the managed runtime capability and owner-assisted Bilibili readiness', async () => {
    const client = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          capabilities: ['content-studio-assisted-publication-v1'],
          channels: [{
            adapterReady: false,
            alias: null,
            assistedPublicationReady: true,
            channel: 'bilibili',
            health: 'ready',
            nextAction: 'Publish in the official Bilibili UI, then confirm its public URL',
          }],
          contractVersion: 3,
          projectId: 'project-a',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })

    await expect(client.getChannelsStatus('project-a')).resolves.toMatchObject({
      capabilities: ['content-studio-assisted-publication-v1'],
      channels: [{
        assistedPublicationReady: true,
        channel: 'bilibili',
        nextStep: 'ready',
      }],
    })
  })

  it('rejects malformed opaque account references', async () => {
    const client = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          channels: [{
            accountRef: 'account/ref with spaces',
            adapterReady: true,
            alias: '@release-bot',
            channel: 'github',
            health: 'ready',
            nextAction: null,
          }],
          contractVersion: 3,
          projectId: 'project-a',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })

    await expect(client.getChannelsStatus('project-a')).rejects.toThrow(/opaque account reference/i)
  })

  it('rejects incompatible or malformed status data without exposing unknown fields', async () => {
    let statusCalls = 0
    const incompatible = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => {
          statusCalls += 1
          return {}
        },
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.2.0' }),
      },
    })
    await expect(incompatible.getChannelsStatus('project-a'))
      .rejects
      .toThrow(/incompatible marketing-ops runtime/i)
    expect(statusCalls).toBe(0)

    const malformed = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          channels: [{
            adapterReady: false,
            alias: null,
            channel: 'github',
            health: 'blocked',
            nextAction: null,
          }, {
            adapterReady: false,
            alias: null,
            channel: 'github',
            health: 'blocked',
            nextAction: null,
          }],
          contractVersion: 3,
          password: null,
          projectId: 'project-b',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })
    await expect(malformed.getChannelsStatus('project-a'))
      .rejects
      .toThrow(/sensitive|password|project/i)

    const duplicate = createMarketingOpsStatusClient({
      transport: {
        getChannelsStatus: async () => ({
          channels: [{
            adapterReady: false,
            alias: null,
            channel: 'github',
            health: 'blocked',
            nextAction: null,
          }, {
            adapterReady: false,
            alias: null,
            channel: 'github',
            health: 'blocked',
            nextAction: null,
          }],
          contractVersion: 3,
          projectId: 'project-a',
        }),
        getRuntimeInfo: async () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })
    await expect(duplicate.getChannelsStatus('project-a'))
      .rejects
      .toThrow(/duplicate/i)
  })

  it('adapts an initialized MCP client through the fixed channels_status tool only', async () => {
    const calls: unknown[] = []
    const client = createMarketingOpsMcpStatusClient({
      mcp: {
        callTool: async (input) => {
          calls.push(input)
          return {
            content: [{
              text: 'Untrusted display text that must not become status data',
              type: 'text',
            }],
            isError: false,
            structuredContent: {
              channels: [{
                adapterReady: true,
                alias: '@project-a',
                channel: 'github',
                health: 'ready',
                nextAction: null,
              }],
              contractVersion: 3,
              projectId: 'project-a',
            },
          }
        },
        getServerVersion: () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
      now: () => new Date('2026-08-10T00:00:00.000Z'),
    })

    await expect(client.getChannelsStatus('project-a')).resolves.toMatchObject({
      authorizesExternalWrite: false,
      channels: [{ channel: 'github', nextStep: 'ready' }],
      projectId: 'project-a',
    })
    expect(calls).toEqual([{
      arguments: { projectId: 'project-a' },
      name: 'channels_status',
    }])
  })

  it('wraps an installer-initialized MCP client with an idempotent lifecycle close', async () => {
    let closeCalls = 0
    const managed = createMarketingOpsManagedRuntime({
      assetBundleRoot: '/tmp/marketing-ops-bundles',
      close: async () => {
        closeCalls += 1
      },
      mcp: {
        callTool: async () => ({
          isError: false,
          structuredContent: {
            channels: [],
            contractVersion: 3,
            projectId: 'project-a',
          },
        }),
        getServerVersion: () => ({
          name: 'marketing-ops',
          version: '0.1.0',
        }),
      },
      now: () => new Date('2026-08-10T00:00:00.000Z'),
    })

    await expect(managed.statusClient.getChannelsStatus('project-a'))
      .resolves
      .toMatchObject({ projectId: 'project-a' })
    expect(managed.assetBundleRoot).toBe('/tmp/marketing-ops-bundles')
    await Promise.all([managed.close(), managed.close()])
    expect(closeCalls).toBe(1)
  })

  it('rejects MCP errors and text-only fallbacks without parsing their content', async () => {
    const createClient = (result: unknown) => createMarketingOpsMcpStatusClient({
      mcp: {
        callTool: async () => result,
        getServerVersion: () => ({ name: 'marketing-ops', version: '0.1.0' }),
      },
    })

    await expect(createClient({
      content: [{ text: '{"contractVersion":3}', type: 'text' }],
      isError: true,
      structuredContent: { code: 'ADAPTER_UNAVAILABLE' },
    }).getChannelsStatus('project-a')).rejects.toThrow(/mcp tool failed/i)
    await expect(createClient({
      content: [{
        text: '{"contractVersion":3,"projectId":"project-a","channels":[]}',
        type: 'text',
      }],
      isError: false,
    }).getChannelsStatus('project-a')).rejects.toThrow(/structuredContent/i)
  })
})
