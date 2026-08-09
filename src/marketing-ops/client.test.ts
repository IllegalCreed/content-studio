// @env node

import type { PublicationReceipt } from '../types'
import { describe, expect, it } from 'vitest'
import { MARKETING_OPS_STATUS_TTL_MS } from '../constants'
import {
  assertMatchingMarketingOpsReceipt,
  assessMarketingOpsCompatibility,
  createFakeMarketingOpsClient,
  createMarketingOpsManagedRuntime,
  createMarketingOpsMcpStatusClient,
  createMarketingOpsStatusClient,
  isMarketingOpsStatusSnapshotFresh,
} from './client'

describe('marketing-ops client boundary', () => {
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
