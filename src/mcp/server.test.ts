import type { ProductionWorkerJob } from '../jobs/worker'
import type {
  ProjectManifest,
  ProjectRecord,
  ProjectSnapshot,
} from '../types'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
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

function createFixture(options: {
  includeBilibili?: boolean
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
    ownerTakeovers: options.ownerTakeovers,
    projectId,
    service,
  })
}

describe('content Studio local MCP server', () => {
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

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: {
        uri: `content-studio://projects/${projectId}/view`,
      },
    })).resolves.toMatchObject({
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
      tools: Array<{ inputSchema: unknown, name: string }>
    }).tools
    expect(listedTools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'create_owner_handoff',
      'create_publication_plan',
      'create_publishing_activity',
      'get_activity_video_plan',
      'promote_activity_artifact',
      'register_activity_artifact',
      'retry_task',
    ]))
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
      channel: 'github',
      delivery: 'automatic-candidate',
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
      channels: [{ id: 'github', locale: 'en' }],
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
      channel: 'github',
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
            body: 'An AI-written, reviewable article draft.',
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
