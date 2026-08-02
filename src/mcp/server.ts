// @env node

import type { ContentStudioApplicationService } from '../control-plane/service'
import type {
  CreateActivityContentPackInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskStatus,
} from '../types'
import { createInterface } from 'node:readline'
import {
  ProjectScopeError,
  RecordConflictError,
  RecordNotFoundError,
} from '../control-plane/service'
import {
  TaskNotFoundError,
  TaskScopeError,
  TaskStateError,
} from '../jobs/task'
import {
  parseCreateActivityInput,
  parseCreateChannelContentInput,
  parseCreateContentGroupInput,
  parseCreatePublicationPlanInput,
} from '../runtime/server'
import { assertNoSensitiveKeys } from '../validation'

const PROTOCOL_VERSION = '2026-07-28'
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PROJECT_URI_PATTERN = /^content-studio:\/\/projects\/([^/]+)\/(view|activities|content|tasks)$/

type McpTaskStatus = 'cancelled' | 'completed' | 'failed' | 'input_required' | 'working'

export interface McpJsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface ContentStudioMcpServerOptions {
  projectId: string
  service: ContentStudioApplicationService
}

export interface ContentStudioMcpServer {
  handleMessage: (
    message: unknown,
  ) => Promise<McpJsonRpcResponse | undefined>
}

export interface McpStdioStreams {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  signal?: AbortSignal
}

export function createContentStudioMcpServer(
  options: ContentStudioMcpServerOptions,
): ContentStudioMcpServer {
  return {
    handleMessage: async (message) => {
      const request = parseRequest(message)
      if (request === undefined)
        return protocolError(null, -32600, 'Invalid Request')
      if (request.id === undefined)
        return undefined

      try {
        return await dispatchRequest(request, options)
      }
      catch (error: unknown) {
        return protocolError(
          request.id,
          errorCode(error),
          error instanceof Error ? error.message : 'Request failed',
        )
      }
    },
  }
}

export async function serveMcpStdio(
  server: ContentStudioMcpServer,
  streams: McpStdioStreams,
): Promise<void> {
  const readline = createInterface({
    crlfDelay: Infinity,
    input: streams.input,
  })
  const onAbort = (): void => readline.close()
  streams.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (streams.signal?.aborted)
      return
    for await (const line of readline) {
      if (streams.signal?.aborted)
        break
      if (line.trim() === '')
        continue
      let message: unknown
      try {
        message = JSON.parse(line) as unknown
      }
      catch {
        await writeLine(streams.output, JSON.stringify(protocolError(null, -32700, 'Parse error')))
        continue
      }
      const response = await server.handleMessage(message)
      if (response !== undefined)
        await writeLine(streams.output, JSON.stringify(response))
    }
  }
  finally {
    streams.signal?.removeEventListener('abort', onAbort)
    readline.close()
  }
}

async function dispatchRequest(
  request: McpJsonRpcRequest,
  options: ContentStudioMcpServerOptions,
): Promise<McpJsonRpcResponse> {
  switch (request.method) {
    case 'server/discover':
      return success(request.id!, {
        capabilities: {
          resources: {},
          tasks: {},
          tools: {},
        },
        projectId: options.projectId,
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: {
          name: 'content-studio',
          version: '0.1.0',
        },
        state: {
          mode: 'local',
          scope: 'project',
        },
      })
    case 'resources/list':
      return success(request.id!, {
        resources: projectResources(options.projectId),
      })
    case 'resources/read':
      return success(request.id!, readResource(request.params, options))
    case 'tools/list':
      return success(request.id!, { tools: toolDefinitions() })
    case 'tools/call':
      return toolCall(request.id!, request.params, options)
    case 'tasks/get':
      return success(request.id!, getMcpTask(request.params, options))
    case 'tasks/update':
      return success(request.id!, updateMcpTask(request.params, options))
    case 'tasks/cancel':
      return success(request.id!, cancelMcpTask(request.params, options))
    default:
      return protocolError(request.id!, -32601, `Method not found: ${request.method}`)
  }
}

function projectResources(projectId: string): Array<Record<string, string>> {
  return [
    resource(
      `content-studio://projects/${projectId}/view`,
      '项目工作视图',
      '项目事实、活动、渠道内容、素材和任务的只读快照。',
    ),
    resource(
      `content-studio://projects/${projectId}/activities`,
      '发布活动',
      '项目下发布活动的只读列表。',
    ),
    resource(
      `content-studio://projects/${projectId}/content`,
      '活动内容',
      '项目下内容组和渠道内容的只读列表。',
    ),
    resource(
      `content-studio://projects/${projectId}/tasks`,
      '执行任务',
      '项目下制作、发布和监测任务的只读列表。',
    ),
  ]
}

function resource(
  uri: string,
  name: string,
  description: string,
): Record<string, string> {
  return {
    description,
    mimeType: 'application/json',
    name,
    uri,
  }
}

function readResource(
  params: unknown,
  options: ContentStudioMcpServerOptions,
): { contents: Array<Record<string, string>> } {
  const value = asRecord(params, 'resources/read params')
  assertKeys(value, ['uri'], 'resources/read params')
  const uri = stringField(value.uri, 'uri')
  const match = PROJECT_URI_PATTERN.exec(uri)
  if (match === null || decodeURIComponent(match[1]!) !== options.projectId)
    throw new McpResourceError(`Resource is outside project ${options.projectId}`)
  const view = options.service.getProjectView(options.projectId)
  const kind = match[2]
  const payload = kind === 'view'
    ? view
    : kind === 'activities'
      ? view.activities
      : kind === 'content'
        ? {
            channelContents: view.channelContents,
            contentGroups: view.contentGroups,
          }
        : {
            taskEvents: view.taskEvents,
            tasks: view.tasks,
          }
  return {
    contents: [{
      mimeType: 'application/json',
      text: JSON.stringify(payload),
      uri,
    }],
  }
}

function toolDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: '读取当前项目的事实、活动、内容、素材和任务快照。不会执行外部发布。',
      inputSchema: projectIdSchema(),
      name: 'get_project_view',
      title: '读取项目工作视图',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '在指定项目中创建发布活动，并创建一条可观察的制作任务。',
      inputSchema: {
        properties: {
          activityId: { type: 'string' },
          campaignId: { type: 'string' },
          channels: {
            items: {
              properties: {
                id: { type: 'string' },
                locale: { enum: ['en', 'zh-CN'], type: 'string' },
              },
              required: ['id', 'locale'],
              type: 'object',
            },
            minItems: 1,
            type: 'array',
          },
          goal: { enum: ['education', 'feedback', 'launch'], type: 'string' },
          projectId: { type: 'string' },
          projectSnapshotId: { type: 'string' },
          status: {
            enum: ['active', 'archived', 'completed', 'draft', 'planned'],
            type: 'string',
          },
          targetUrl: { format: 'uri', type: 'string' },
          topic: {
            properties: {
              'en': { type: 'string' },
              'zh-CN': { type: 'string' },
            },
            required: ['en', 'zh-CN'],
            type: 'object',
          },
          video: {
            properties: {
              flowIds: {
                items: { type: 'string' },
                minItems: 1,
                type: 'array',
              },
              format: { enum: ['landscape', 'portrait', 'square'], type: 'string' },
              outline: {
                items: {
                  properties: {
                    flowId: { type: 'string' },
                    objective: localizedTextSchema(),
                    title: localizedTextSchema(),
                  },
                  required: ['flowId', 'objective', 'title'],
                  type: 'object',
                },
                minItems: 1,
                type: 'array',
              },
              planVersion: { minimum: 1, type: 'integer' },
            },
            required: ['flowIds', 'format'],
            type: 'object',
          },
        },
        required: [
          'activityId',
          'campaignId',
          'channels',
          'goal',
          'projectId',
          'projectSnapshotId',
          'status',
          'targetUrl',
          'topic',
        ],
        type: 'object',
      },
      name: 'create_publishing_activity',
      title: '创建发布活动',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '为活动中的一个渠道成品建立本地发布安排和发布任务，不会执行渠道发布。',
      inputSchema: publicationPlanSchema(),
      name: 'create_publication_plan',
      title: '创建发布安排',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: '读取活动编译后的版本化视频拍摄计划，不会启动浏览器或发布内容。',
      inputSchema: activityVideoPlanSchema(),
      name: 'get_activity_video_plan',
      title: '读取活动视频计划',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '在发布活动中保存一次主题内容组。',
      inputSchema: contentGroupSchema(),
      name: 'create_content_group',
      title: '创建内容组',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '一次保存 AI 宿主生成的内容组和多个渠道版本，不会发布到渠道。',
      inputSchema: activityContentPackSchema(),
      name: 'save_activity_content_pack',
      title: '保存活动内容包',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '保存某个渠道的文章或视频内容版本，不会发布到渠道。',
      inputSchema: channelContentSchema(),
      name: 'save_channel_content',
      title: '保存渠道内容',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: '列出项目下的制作、发布和监测任务。',
      inputSchema: projectIdSchema(),
      name: 'list_project_tasks',
      title: '列出项目任务',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '启动项目制作任务的生成阶段；不会启动浏览器，也不会声称录制已完成。',
      inputSchema: taskSchema(),
      name: 'start_production_task',
      title: '启动制作任务',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: '读取项目中一条任务及其追加式事件。',
      inputSchema: {
        properties: {
          projectId: { type: 'string' },
          taskId: { type: 'string' },
        },
        required: ['projectId', 'taskId'],
        type: 'object',
      },
      name: 'get_task',
      title: '读取任务',
    },
    {
      annotations: {
        destructiveHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '请求取消项目中的当前任务尝试。不会删除任务或外部渠道内容。',
      inputSchema: taskSchema(),
      name: 'cancel_task',
      title: '取消任务',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '为失败或已取消的任务创建新的尝试并保留旧事件。',
      inputSchema: taskSchema(),
      name: 'retry_task',
      title: '重试任务',
    },
  ]
}

function projectIdSchema(): Record<string, unknown> {
  return {
    properties: {
      projectId: { type: 'string' },
    },
    required: ['projectId'],
    type: 'object',
  }
}

function activityVideoPlanSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      projectId: { type: 'string' },
    },
    required: ['activityId', 'projectId'],
    type: 'object',
  }
}

function localizedTextSchema(): Record<string, unknown> {
  return {
    properties: {
      'en': { type: 'string' },
      'zh-CN': { type: 'string' },
    },
    required: ['en', 'zh-CN'],
    type: 'object',
  }
}

function contentGroupSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      contentGroupId: { type: 'string' },
      coreMessage: { type: 'string' },
      projectId: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['activityId', 'contentGroupId', 'coreMessage', 'projectId', 'title'],
    type: 'object',
  }
}

function publicationPlanSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      channel: { type: 'string' },
      contentId: { type: 'string' },
      projectId: { type: 'string' },
      publicationId: { type: 'string' },
    },
    required: ['activityId', 'channel', 'contentId', 'projectId', 'publicationId'],
    type: 'object',
  }
}

function channelContentSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      artifactIds: {
        description: '引用本活动内的活动素材 ID,缺省为空数组',
        items: { type: 'string' },
        type: 'array',
      },
      body: { type: 'string' },
      channel: { type: 'string' },
      contentGroupId: { type: 'string' },
      contentId: { type: 'string' },
      format: { enum: ['article', 'video'], type: 'string' },
      locale: { enum: ['en', 'zh-CN'], type: 'string' },
      projectId: { type: 'string' },
      title: { type: 'string' },
    },
    required: [
      'activityId',
      'body',
      'channel',
      'contentGroupId',
      'contentId',
      'format',
      'locale',
      'projectId',
      'title',
    ],
    type: 'object',
  }
}

function activityContentPackSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      contentGroupId: { type: 'string' },
      contents: {
        items: {
          properties: {
            artifactIds: {
              description: '引用本活动内的活动素材 ID,缺省为空数组',
              items: { type: 'string' },
              type: 'array',
            },
            body: { type: 'string' },
            channel: { type: 'string' },
            contentId: { type: 'string' },
            format: { enum: ['article', 'video'], type: 'string' },
            locale: { enum: ['en', 'zh-CN'], type: 'string' },
            title: { type: 'string' },
          },
          required: ['body', 'channel', 'contentId', 'format', 'locale', 'title'],
          type: 'object',
        },
        minItems: 1,
        type: 'array',
      },
      coreMessage: { type: 'string' },
      projectId: { type: 'string' },
      title: { type: 'string' },
    },
    required: [
      'activityId',
      'contentGroupId',
      'contents',
      'coreMessage',
      'projectId',
      'title',
    ],
    type: 'object',
  }
}

function taskSchema(): Record<string, unknown> {
  return {
    properties: {
      projectId: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['projectId', 'taskId'],
    type: 'object',
  }
}

function toolCall(
  id: string | number,
  params: unknown,
  options: ContentStudioMcpServerOptions,
): McpJsonRpcResponse {
  try {
    const value = asRecord(params, 'tools/call params')
    assertKeys(value, ['arguments', 'name'], 'tools/call params')
    const name = stringField(value.name, 'name')
    const input = value.arguments ?? {}
    assertNoSensitiveKeys(input)
    const result = executeTool(name, input, options)
    return success(id, toolResult(result))
  }
  catch (error: unknown) {
    return success(id, {
      content: [{
        text: error instanceof Error ? error.message : 'Tool execution failed',
        type: 'text',
      }],
      isError: true,
    })
  }
}

function executeTool(
  name: string,
  input: unknown,
  options: ContentStudioMcpServerOptions,
): unknown {
  switch (name) {
    case 'get_project_view': {
      const value = scopedRecord(input, options.projectId, ['projectId'])
      return options.service.getProjectView(value.projectId)
    }
    case 'create_publishing_activity': {
      const value = asRecord(input, 'activity')
      assertKeys(value, [
        'activityId',
        'campaignId',
        'channels',
        'goal',
        'projectId',
        'projectSnapshotId',
        'status',
        'targetUrl',
        'topic',
        'video',
      ], 'activity')
      const activity = parseCreateActivityInput(input, options.projectId)
      return options.service.createActivity(activity)
    }
    case 'create_publication_plan': {
      const value = asRecord(input, 'publicationPlan')
      assertKeys(value, [
        'activityId',
        'channel',
        'contentId',
        'projectId',
        'publicationId',
      ], 'publicationPlan')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      return options.service.createPublicationPlan(
        parseCreatePublicationPlanInput(value, projectId, activityId),
      )
    }
    case 'get_activity_video_plan': {
      const value = scopedRecord(input, options.projectId, ['activityId', 'projectId'])
      const activityId = identifierField(value.activityId, 'activityId')
      return options.service.getActivityVideoPlan(value.projectId, activityId)
    }
    case 'create_content_group': {
      const value = asRecord(input, 'contentGroup')
      assertKeys(value, [
        'activityId',
        'contentGroupId',
        'coreMessage',
        'projectId',
        'title',
      ], 'contentGroup')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      return options.service.createContentGroup(
        parseCreateContentGroupInput(value, projectId, activityId),
      )
    }
    case 'save_activity_content_pack': {
      const value = asRecord(input, 'contentPack')
      assertKeys(value, [
        'activityId',
        'contentGroupId',
        'contents',
        'coreMessage',
        'projectId',
        'title',
      ], 'contentPack')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      const contentGroupId = identifierField(value.contentGroupId, 'contentGroupId')
      const group = parseCreateContentGroupInput({
        activityId,
        contentGroupId,
        coreMessage: value.coreMessage,
        projectId,
        title: value.title,
      }, projectId, activityId)
      if (!Array.isArray(value.contents))
        throw new McpToolError('contents must be a non-empty array')
      const contents = value.contents.map((inputContent, index) => {
        const content = asRecord(inputContent, `contents[${index}]`)
        assertKeys(content, [
          'artifactIds',
          'body',
          'channel',
          'contentId',
          'format',
          'locale',
          'title',
        ], `contents[${index}]`)
        const parsed = parseCreateChannelContentInput({
          ...content,
          activityId,
          contentGroupId,
          projectId,
        }, projectId, activityId, contentGroupId)
        return {
          artifactIds: parsed.artifactIds,
          body: parsed.body,
          channel: parsed.channel,
          contentId: parsed.contentId,
          format: parsed.format,
          locale: parsed.locale,
          title: parsed.title,
        }
      })
      const pack: CreateActivityContentPackInput = {
        ...group,
        contents,
      }
      return options.service.saveActivityContentPack(pack)
    }
    case 'save_channel_content': {
      const value = asRecord(input, 'channelContent')
      assertKeys(value, [
        'activityId',
        'artifactIds',
        'body',
        'channel',
        'contentGroupId',
        'contentId',
        'format',
        'locale',
        'projectId',
        'title',
      ], 'channelContent')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      const contentGroupId = identifierField(value.contentGroupId, 'contentGroupId')
      return options.service.createChannelContent(
        parseCreateChannelContentInput(value, projectId, activityId, contentGroupId),
      )
    }
    case 'list_project_tasks': {
      const value = scopedRecord(input, options.projectId, ['projectId'])
      return options.service.getProjectView(value.projectId).tasks
    }
    case 'start_production_task':
      return startMcpProductionTask(input, options)
    case 'get_task':
      return getTask(input, options)
    case 'cancel_task':
      return changeTask(input, options, 'cancel')
    case 'retry_task':
      return changeTask(input, options, 'retry')
    default:
      throw new McpToolError(`Unknown tool: ${name}`)
  }
}

function getTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): { events: ReturnType<ContentStudioApplicationService['listTaskEvents']>, task: ExecutionTask } {
  const value = scopedRecord(input, options.projectId, ['projectId', 'taskId'])
  const taskId = identifierField(value.taskId, 'taskId')
  const view = options.service.getProjectView(value.projectId)
  const task = view.tasks.find(candidate => candidate.taskId === taskId)
  if (task === undefined)
    throw new RecordNotFoundError('Task', taskId)
  return {
    events: options.service.listTaskEvents(value.projectId, taskId),
    task,
  }
}

function startMcpProductionTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const handle = parseTaskHandle(input, options, false)
  const task = options.service.startProductionTask(handle.projectId, handle.taskId)
  const events = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return toMcpTask(task, events)
}

function changeTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
  operation: 'cancel' | 'retry',
): ExecutionTask {
  const value = scopedRecord(input, options.projectId, ['projectId', 'taskId'])
  const taskId = identifierField(value.taskId, 'taskId')
  return operation === 'cancel'
    ? options.service.cancelTask(value.projectId, taskId)
    : options.service.retryTask(value.projectId, taskId)
}

function toolResult(value: unknown): Record<string, unknown> {
  return {
    content: [{
      text: JSON.stringify(value),
      type: 'text',
    }],
    isError: false,
    structuredContent: value,
  }
}

function getMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): { events: ExecutionTaskEvent[], task: Record<string, unknown> } {
  const handle = parseTaskHandle(input, options, false)
  const view = options.service.getProjectView(handle.projectId)
  const task = requireTask(view.tasks, handle.taskId)
  const events = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return {
    events,
    task: toMcpTask(task, events),
  }
}

function updateMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): { events: ExecutionTaskEvent[], task: Record<string, unknown> } {
  const handle = parseTaskHandle(input, options, true)
  const view = options.service.getProjectView(handle.projectId)
  const task = requireTask(view.tasks, handle.taskId)
  const events = options.service
    .listTaskEvents(handle.projectId, handle.taskId)
    .filter(event => handle.cursor === undefined || event.sequence > handle.cursor)
  const allEvents = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return {
    events,
    task: toMcpTask(task, allEvents),
  }
}

function cancelMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): { task: Record<string, unknown> } {
  const handle = parseTaskHandle(input, options, false)
  const task = options.service.cancelTask(handle.projectId, handle.taskId)
  const events = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return { task: toMcpTask(task, events) }
}

function parseTaskHandle(
  input: unknown,
  options: ContentStudioMcpServerOptions,
  allowCursor: boolean,
): { cursor?: number, projectId: string, taskId: string } {
  const value = asRecord(input, 'task params')
  assertKeys(
    value,
    allowCursor ? ['cursor', 'projectId', 'taskId'] : ['projectId', 'taskId'],
    'task params',
  )
  const projectId = scopedId(value.projectId, options.projectId, 'projectId')
  const taskId = identifierField(value.taskId, 'taskId')
  if (value.cursor === undefined)
    return { projectId, taskId }
  if (
    (typeof value.cursor !== 'string' && typeof value.cursor !== 'number')
    || (typeof value.cursor === 'string' && value.cursor.trim() === '')
  ) {
    throw new McpToolError('cursor must be a non-negative integer')
  }
  const cursor = Number(value.cursor)
  if (!Number.isInteger(cursor) || cursor < 0)
    throw new McpToolError('cursor must be a non-negative integer')
  return { cursor, projectId, taskId }
}

function requireTask(
  tasks: ExecutionTask[],
  taskId: string,
): ExecutionTask {
  const task = tasks.find(candidate => candidate.taskId === taskId)
  if (task === undefined)
    throw new RecordNotFoundError('Task', taskId)
  return task
}

function toMcpTask(
  task: ExecutionTask,
  events: ExecutionTaskEvent[],
): Record<string, unknown> {
  const lastEvent = events.at(-1)
  return {
    attempt: task.attempt,
    eventCursor: String(lastEvent?.sequence ?? 0),
    internalStatus: task.status,
    ...(lastEvent === undefined ? {} : { lastEvent }),
    pollIntervalMs: 1000,
    projectId: task.projectId,
    status: mapTaskStatus(task.status),
    taskId: task.taskId,
  }
}

function mapTaskStatus(status: ExecutionTaskStatus): McpTaskStatus {
  if (status === 'awaiting-owner')
    return 'input_required'
  if (status === 'cancelled')
    return 'cancelled'
  if (status === 'failed')
    return 'failed'
  if (status === 'published')
    return 'completed'
  return 'working'
}

function scopedRecord(
  input: unknown,
  projectId: string,
  keys: string[],
): Record<string, any> {
  const value = asRecord(input, 'tool arguments')
  assertKeys(value, keys, 'tool arguments')
  for (const key of keys) {
    if (key === 'projectId')
      scopedId(value[key], projectId, key)
    else
      identifierField(value[key], key)
  }
  return value
}

function assertKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  name: string,
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new McpToolError(`${name} contains unsupported field: ${key}`)
  }
}

function scopedId(input: unknown, expected: string, name: string): string {
  const value = identifierField(input, name)
  if (value !== expected)
    throw new ProjectScopeError(expected, value)
  return value
}

function parseRequest(input: unknown): McpJsonRpcRequest | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return undefined
  const value = input as Record<string, unknown>
  if (value.jsonrpc !== '2.0' || typeof value.method !== 'string')
    return undefined
  if (
    value.id !== undefined
    && value.id !== null
    && typeof value.id !== 'string'
    && typeof value.id !== 'number'
  ) {
    return undefined
  }
  return value as unknown as McpJsonRpcRequest
}

function asRecord(input: unknown, name: string): Record<string, any> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new McpToolError(`${name} must be an object`)
  return input as Record<string, any>
}

function stringField(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim() === '')
    throw new McpToolError(`${name} must be a non-empty string`)
  return input.trim()
}

function identifierField(input: unknown, name: string): string {
  const value = stringField(input, name)
  if (!IDENTIFIER_PATTERN.test(value))
    throw new McpToolError(`${name} must use lowercase kebab-case`)
  return value
}

function success(id: string | number, result: unknown): McpJsonRpcResponse {
  return {
    id,
    jsonrpc: '2.0',
    result,
  }
}

function protocolError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): McpJsonRpcResponse {
  return {
    error: {
      ...(data === undefined ? {} : { data }),
      code,
      message,
    },
    id,
    jsonrpc: '2.0',
  }
}

function errorCode(error: unknown): number {
  if (error instanceof McpResourceError)
    return -32003
  if (error instanceof ProjectScopeError)
    return -32003
  if (error instanceof RecordNotFoundError)
    return -32002
  if (error instanceof RecordConflictError)
    return -32009
  if (error instanceof TaskNotFoundError)
    return -32002
  if (error instanceof TaskScopeError)
    return -32003
  if (error instanceof TaskStateError)
    return -32602
  return -32602
}

function writeLine(output: NodeJS.WritableStream, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    output.write(`${line}\n`, error => error == null ? resolve() : reject(error))
  })
}

class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

class McpResourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpResourceError'
  }
}
