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
import { InMemoryExecutionTaskStore } from '../jobs/task'
import {
  createContentStudioMcpServer,
  serveMcpStdio,
} from './server'

const projectId = 'algorithm-visualizer'

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

function createFixture() {
  const repository = new InMemoryContentStudioRepository()
  const service = new ContentStudioApplicationService(repository)
  service.registerProject(project, snapshot)
  service.bindProjectChannel({
    channel: 'github',
    delivery: 'automatic-candidate',
    enabled: true,
    projectId,
  })
  return createContentStudioMcpServer({
    projectId,
    service,
  })
}

describe('content Studio local MCP server', () => {
  it('discovers a project-scoped, stateless server', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        capabilities: {
          resources: {},
          tools: {},
        },
        projectId,
        protocolVersion: '2026-07-28',
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
        resources: expect.arrayContaining([
          expect.objectContaining({
            uri: `content-studio://projects/${projectId}/view`,
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

    for (const kind of ['activities', 'content', 'tasks']) {
      await expect(server.handleMessage({
        jsonrpc: '2.0',
        id: `read-${kind}`,
        method: 'resources/read',
        params: {
          uri: `content-studio://projects/${projectId}/${kind}`,
        },
      })).resolves.toMatchObject({
        result: {
          contents: [expect.objectContaining({ mimeType: 'application/json' })],
        },
      })
    }
  })

  it('describes the available tools and reports protocol errors', async () => {
    const server = createFixture()

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/list',
    })).resolves.toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'create_publishing_activity' }),
          expect.objectContaining({ name: 'retry_task' }),
        ]),
      },
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
      result: { protocolVersion: '2026-07-28' },
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
          },
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
    const taskId = 'production-task-demo'

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

  it('maps domain task state to MCP Tasks and supports cursor-based polling', async () => {
    const server = createFixture()
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
    const taskId = 'production-mcp-task-demo'

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 29,
      method: 'tasks/get',
      params: { projectId, taskId },
    })).resolves.toMatchObject({
      result: {
        task: {
          attempt: 1,
          eventCursor: '1',
          internalStatus: 'queued',
          status: 'working',
          taskId,
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 30,
      method: 'tasks/update',
      params: { cursor: '1', projectId, taskId },
    })).resolves.toMatchObject({
      result: {
        events: [],
        task: { eventCursor: '1', status: 'working' },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 31,
      method: 'tasks/cancel',
      params: { projectId, taskId },
    })).resolves.toMatchObject({
      result: {
        task: {
          internalStatus: 'cancelled',
          status: 'cancelled',
        },
      },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 32,
      method: 'tasks/update',
      params: { cursor: '1', projectId, taskId },
    })).resolves.toMatchObject({
      result: {
        events: [expect.objectContaining({
          kind: 'attempt-cancelled',
          sequence: 2,
        })],
        task: { status: 'cancelled' },
      },
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
      id: 39,
      method: 'tools/call',
      params: {
        name: 'save_activity_content_pack',
        arguments: {
          activityId: 'content-pack-demo',
          contentGroupId: 'content-pack-core',
          contents: [{
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
      id: 40,
      method: 'tools/call',
      params: {
        name: 'start_production_task',
        arguments: {
          projectId,
          taskId: 'production-content-pack-demo',
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
    const taskId = 'production-state-demo'
    taskStore.transitionTask(projectId, taskId, 'generating')
    taskStore.transitionTask(projectId, taskId, 'recording')
    taskStore.transitionTask(projectId, taskId, 'composing')
    taskStore.transitionTask(projectId, taskId, 'awaiting-owner')

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 33,
      method: 'tasks/get',
      params: { projectId, taskId },
    })).resolves.toMatchObject({
      result: { task: { status: 'input_required', internalStatus: 'awaiting-owner' } },
    })

    taskStore.transitionTask(projectId, taskId, 'published', {
      hasMatchingPublicationReceipt: true,
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 34,
      method: 'tasks/get',
      params: { projectId, taskId },
    })).resolves.toMatchObject({
      result: { task: { status: 'completed', internalStatus: 'published' } },
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
    const failedTaskId = 'production-failed-state-demo'
    taskStore.transitionTask(projectId, failedTaskId, 'generating')
    taskStore.transitionTask(projectId, failedTaskId, 'failed')
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 35,
      method: 'tasks/get',
      params: { projectId, taskId: failedTaskId },
    })).resolves.toMatchObject({
      result: { task: { status: 'failed', internalStatus: 'failed' } },
    })

    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 36,
      method: 'tasks/get',
      params: { projectId, taskId: 'Invalid_Task' },
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
    await expect(server.handleMessage({
      jsonrpc: '2.0',
      id: 37,
      method: 'tasks/update',
      params: { cursor: '', projectId, taskId },
    })).resolves.toMatchObject({
      error: { code: -32602 },
    })
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
      result: { protocolVersion: '2026-07-28' },
    })
  })
})
