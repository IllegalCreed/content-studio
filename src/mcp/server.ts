// @env node

import type { ContentStudioApplicationService } from '../control-plane/service'
import type { OwnerTakeoverRegistry } from '../jobs/owner-takeover'
import type { ProductionWorker, ProductionWorkerJob } from '../jobs/worker'
import type {
  CompositionAttemptReceipt,
  CreateActivityContentPackInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskStatus,
  MarketingOpsChannelsStatusSnapshot,
  MarketingOpsPublicationPackage,
  MarketingOpsPublishClient,
  MarketingOpsPublishResult,
  MarketingOpsStatusClient,
  PrepareMarketingOpsPublicationPackageInput,
} from '../types'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import {
  MARKETING_OPS_MEDIA_KINDS,
  MARKETING_OPS_PACKAGE_FORMAT_VALUES,
  MARKETING_OPS_PUBLISH_UNAVAILABLE_MESSAGE,
  MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE,
  MARKETING_OPS_UTM_MEDIUM_VALUES,
  MCP_LIST_TTL_MS,
  MCP_RESOURCE_TTL_MS,
} from '../constants'
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
import { isMarketingOpsStatusSnapshotFresh } from '../marketing-ops/client'
import {
  buildMarketingOpsCampaignRequest,
  createMarketingOpsCampaignSpec,
} from '../marketing-ops/publish'
import {
  parseCreateActivityArtifactInput,
  parseCreateActivityInput,
  parseCreateChannelContentInput,
  parseCreateContentGroupInput,
  parseCreateOwnerHandoffInput,
  parseCreatePublicationPlanInput,
  parsePrepareMarketingOpsPublicationPackageInput,
  parsePromoteActivityArtifactInput,
  parseReviseChannelContentMediaInput,
} from '../runtime/server'
import { assertNoSensitiveKeys } from '../validation'

const PROTOCOL_VERSION = '2026-07-28'
const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks'
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PROJECT_URI_PATTERN = /^content-studio:\/\/projects\/([^/]+)\/(view|activities|content|tasks|assets|receipts|reports)$/

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
  marketingOpsPublish?: MarketingOpsPublishClient
  marketingOpsStatus?: MarketingOpsStatusClient
  ownerTakeovers?: OwnerTakeoverRegistry
  projectId: string
  productionWorker?: Pick<ProductionWorker, 'cancel' | 'enqueue'>
  productionWorkerJob?: (task: ExecutionTask) => ProductionWorkerJob | undefined
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
    case 'initialize':
      return success(
        request.id!,
        initializeStandardClient(request.params, options.projectId),
      )
    case 'ping':
      assertMetadataParams(request.params, 'ping params')
      return success(request.id!, {})
    case 'server/discover':
      assertMetadataParams(request.params, 'server/discover params')
      return success(request.id!, {
        cacheScope: 'private',
        resultType: 'complete',
        supportedVersions: [PROTOCOL_VERSION],
        capabilities: {
          extensions: {
            [TASKS_EXTENSION]: {},
          },
          resources: {},
          tools: {},
        },
        _meta: {
          'io.content-studio/project': {
            mode: 'local',
            projectId: options.projectId,
            scope: 'project',
          },
          'io.modelcontextprotocol/serverInfo': {
            name: 'content-studio',
            version: '0.1.0',
          },
        },
        instructions: 'Use explicit project-scoped handles. Content Studio prepares local content and handoffs but never grants channel publishing authority.',
        ttlMs: MCP_LIST_TTL_MS,
      })
    case 'resources/list':
      return success(request.id!, {
        cacheScope: 'private',
        resources: projectResources(options.projectId),
        resultType: 'complete',
        ttlMs: MCP_LIST_TTL_MS,
      })
    case 'resources/templates/list':
      assertMetadataParams(request.params, 'resources/templates/list params')
      return success(request.id!, {
        cacheScope: 'private',
        resourceTemplates: [],
        resultType: 'complete',
        ttlMs: MCP_LIST_TTL_MS,
      })
    case 'resources/read':
      return success(request.id!, {
        ...readResource(request.params, options),
        cacheScope: 'private',
        resultType: 'complete',
        ttlMs: MCP_RESOURCE_TTL_MS,
      })
    case 'tools/list':
      return success(request.id!, {
        cacheScope: 'private',
        resultType: 'complete',
        tools: toolDefinitions(),
        ttlMs: MCP_LIST_TTL_MS,
      })
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

function initializeStandardClient(
  params: unknown,
  projectId: string,
): Record<string, unknown> {
  const value = asRecord(params, 'initialize params')
  assertKeys(
    value,
    ['_meta', 'capabilities', 'clientInfo', 'protocolVersion'],
    'initialize params',
  )
  const protocolVersion = stringField(
    value.protocolVersion,
    'initialize protocolVersion',
  )
  asRecord(value.capabilities, 'initialize capabilities')
  const clientInfo = asRecord(value.clientInfo, 'initialize clientInfo')
  stringField(clientInfo.name, 'initialize clientInfo name')
  stringField(clientInfo.version, 'initialize clientInfo version')

  return {
    capabilities: {
      resources: {},
      tools: {},
    },
    instructions: 'Use explicit project-scoped handles. Content Studio prepares local content and handoffs but never grants channel publishing authority.',
    protocolVersion,
    serverInfo: {
      name: 'content-studio',
      version: '0.1.0',
    },
    _meta: {
      'io.content-studio/project': {
        mode: 'local',
        projectId,
        scope: 'project',
      },
    },
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
      '项目下制作、发布和监测任务、事件及本地合成回执的只读列表。',
    ),
    resource(
      `content-studio://projects/${projectId}/assets`,
      '素材资产',
      '项目素材库和活动产物的只读列表，不包含本地绝对路径或凭据。',
    ),
    resource(
      `content-studio://projects/${projectId}/receipts`,
      '发布回执',
      '项目发布安排和 marketing-ops 回执的只读列表，不会触发渠道写入。',
    ),
    resource(
      `content-studio://projects/${projectId}/reports`,
      '监测报告',
      '项目监测观测和报告的只读列表。',
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
  assertKeys(value, ['_meta', 'uri'], 'resources/read params')
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
            channelContentReadiness: view.channelContentReadiness,
            channelContents: view.channelContents,
            contentGroups: view.contentGroups,
          }
        : kind === 'tasks'
          ? {
              compositionReceipts: view.compositionReceipts,
              taskEvents: view.taskEvents,
              tasks: view.tasks,
            }
          : kind === 'assets'
            ? {
                activityArtifacts: view.activityArtifacts,
                projectAssets: view.projectAssets,
              }
            : kind === 'receipts'
              ? {
                  publicationPlans: view.publicationPlans,
                  publicationReceipts: view.publicationReceipts,
                }
              : {
                  monitoringObservations: view.monitoringObservations,
                  reports: view.reports,
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
      description: '读取当前项目的事实、活动、内容、逐形态规格、发布资源 readiness、素材和任务快照。不会执行外部发布。',
      inputSchema: projectIdSchema(),
      name: 'get_project_view',
      title: '读取项目工作视图',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description: '读取受管 marketing-ops 的当前渠道健康和适配器状态。快照过期、版本不兼容或 runtime 未连接时保持阻塞，不代表获得外部写入授权。',
      inputSchema: projectIdSchema(),
      name: 'get_marketing_ops_channels_status',
      title: '读取 Marketing Ops 渠道状态',
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
                contentFormats: {
                  items: {
                    enum: ['article', 'image-text', 'short-post', 'video-metadata'],
                    type: 'string',
                  },
                  minItems: 1,
                  type: 'array',
                  uniqueItems: true,
                },
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
              recordingProfile: videoRecordingProfileSchema(),
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
      description: '登记活动生成的本地文件摘要，不读取文件、不接受任意路径或凭据。',
      inputSchema: activityArtifactSchema(),
      name: 'register_activity_artifact',
      title: '登记活动产物',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '在用户明确选择后，把已登记的活动产物晋升为项目素材，不删除原产物。',
      inputSchema: promoteActivityArtifactSchema(),
      name: 'promote_activity_artifact',
      title: '晋升为项目素材',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '为活动中已满足逐形态媒体要求的渠道成品建立本地发布安排和发布任务，不会执行渠道发布。',
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
      description: '根据项目内发布安排、版本化素材和当前渠道绑定准备并校验 marketing-ops 包。只返回本地结果，不调用渠道、不创建授权或发布回执。',
      inputSchema: marketingOpsPackagePreparationSchema(),
      name: 'prepare_marketing_ops_package',
      title: '准备 Marketing Ops 发布包',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description: '调用受管 marketing-ops 准备或确认一份已锁定的人工辅助发布包。准备阶段不会远程发布；确认阶段只接收 Owner 已在官方页面发布后的公开地址并写入匹配回执。需要当前任务中明确的 Owner 授权。',
      inputSchema: marketingOpsAssistedPublicationSchema(),
      name: 'publish_marketing_ops_package',
      title: '人工辅助发布 Marketing Ops 包',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '为发布安排准备人工确认包，只保存校验和、清单和官方页面地址，不保存凭据。',
      inputSchema: ownerHandoffSchema(),
      name: 'create_owner_handoff',
      title: '准备人工确认包',
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
      description: '一次保存 AI 宿主生成的内容组和多个渠道版本，可引用同活动的最终媒体产物；不会发布到渠道。',
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
      description: '保存某个渠道的文章、图文、动态或视频内容版本，可引用同活动的最终媒体产物；不会发布到渠道。',
      inputSchema: channelContentSchema(),
      name: 'save_channel_content',
      title: '保存渠道内容',
    },
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '为已有渠道内容追加或替换最终 image/video 引用，保留正文版本并要求匹配当前 content version；不会发布到渠道。',
      inputSchema: channelContentMediaRevisionSchema(),
      name: 'revise_channel_content_media',
      title: '修订渠道内容媒体',
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
      description: '启动项目制作任务并交给已配置的本地执行器；视频任务会异步录制，文章任务等待对应生成器，不会执行渠道发布。',
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
    {
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description: '确认等待 owner 人工接管的制作任务；任务回到录制并继续同一会话，不接收凭据。',
      inputSchema: taskSchema(),
      name: 'confirm_owner_takeover',
      title: '确认 owner 接管',
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

function videoRecordingConfigOverridesSchema(
  includeFormat = false,
): Record<string, unknown> {
  return {
    properties: {
      colorScheme: { enum: ['dark', 'light', 'no-preference'], type: 'string' },
      deviceScaleFactor: { enum: [1, 2], type: 'number' },
      ...(includeFormat
        ? { format: { enum: ['landscape', 'portrait', 'square'], type: 'string' } }
        : {}),
      locale: { enum: ['en', 'zh-CN'], type: 'string' },
      outputSize: {
        properties: {
          height: { minimum: 320, type: 'integer' },
          width: { minimum: 320, type: 'integer' },
        },
        required: ['width', 'height'],
        type: 'object',
      },
      viewport: {
        properties: {
          height: { minimum: 320, type: 'integer' },
          width: { minimum: 320, type: 'integer' },
        },
        required: ['width', 'height'],
        type: 'object',
      },
    },
    type: 'object',
  }
}

function videoRecordingProfileSchema(): Record<string, unknown> {
  return {
    properties: {
      channelVariants: {
        additionalProperties: videoRecordingConfigOverridesSchema(true),
        type: 'object',
      },
      defaults: videoRecordingConfigOverridesSchema(),
    },
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

function activityArtifactSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      artifactId: { type: 'string' },
      kind: {
        enum: ['article-version', 'audio', 'image', 'preview-frame', 'video-clip', 'video'],
        type: 'string',
      },
      locale: { enum: ['en', 'zh-CN', 'neutral'], type: 'string' },
      projectId: { type: 'string' },
      relativePath: { type: 'string' },
      sha256: { pattern: '^[a-f0-9]{64}$', type: 'string' },
    },
    required: ['activityId', 'artifactId', 'kind', 'projectId', 'relativePath', 'sha256'],
    type: 'object',
  }
}

function promoteActivityArtifactSchema(): Record<string, unknown> {
  return {
    properties: {
      artifactId: { type: 'string' },
      assetId: { type: 'string' },
      kind: {
        enum: ['audio', 'font', 'image', 'logo', 'template', 'video'],
        type: 'string',
      },
      projectId: { type: 'string' },
    },
    required: ['artifactId', 'assetId', 'kind', 'projectId'],
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

function marketingOpsPackagePreparationSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties: {
      projectId: { type: 'string' },
      publicationId: { type: 'string' },
      renderer: {
        additionalProperties: false,
        properties: {
          canonicalUrl: { format: 'uri', pattern: '^https://', type: 'string' },
          format: {
            enum: [...MARKETING_OPS_PACKAGE_FORMAT_VALUES],
            type: 'string',
          },
          links: {
            items: { format: 'uri', pattern: '^https://', type: 'string' },
            maxItems: 10,
            minItems: 1,
            type: 'array',
            uniqueItems: true,
          },
          media: {
            items: { enum: [...MARKETING_OPS_MEDIA_KINDS], type: 'string' },
            maxItems: 3,
            type: 'array',
            uniqueItems: true,
          },
          utmMedium: {
            enum: [...MARKETING_OPS_UTM_MEDIUM_VALUES],
            type: 'string',
          },
        },
        required: ['canonicalUrl', 'format', 'links', 'media', 'utmMedium'],
        type: 'object',
      },
    },
    required: ['projectId', 'publicationId', 'renderer'],
    type: 'object',
  }
}

function marketingOpsAssistedPublicationSchema(): Record<string, unknown> {
  return {
    oneOf: [{
      additionalProperties: false,
      properties: {
        authorization: marketingOpsOwnerAuthorizationSchema(),
        execution: {
          additionalProperties: false,
          properties: { mode: { const: 'assisted-prepare', type: 'string' } },
          required: ['mode'],
          type: 'object',
        },
        projectId: { type: 'string' },
        publicationId: { type: 'string' },
        renderer: marketingOpsRendererSchema(),
      },
      required: ['authorization', 'execution', 'projectId', 'publicationId', 'renderer'],
      type: 'object',
    }, {
      additionalProperties: false,
      properties: {
        authorization: marketingOpsOwnerAuthorizationSchema(),
        execution: {
          additionalProperties: false,
          properties: {
            mode: { const: 'assisted-confirm', type: 'string' },
            publicUrl: { format: 'uri', pattern: '^https://', type: 'string' },
          },
          required: ['mode', 'publicUrl'],
          type: 'object',
        },
        handoffId: { type: 'string' },
        projectId: { type: 'string' },
      },
      required: ['authorization', 'execution', 'handoffId', 'projectId'],
      type: 'object',
    }],
  }
}

function marketingOpsOwnerAuthorizationSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties: {
      authorizedAt: { format: 'date-time', type: 'string' },
      source: { const: 'owner-prompt', type: 'string' },
    },
    required: ['authorizedAt', 'source'],
    type: 'object',
  }
}

function marketingOpsRendererSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties: {
      canonicalUrl: { format: 'uri', pattern: '^https://', type: 'string' },
      format: {
        enum: [...MARKETING_OPS_PACKAGE_FORMAT_VALUES],
        type: 'string',
      },
      links: {
        items: { format: 'uri', pattern: '^https://', type: 'string' },
        maxItems: 10,
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      },
      media: {
        items: { enum: [...MARKETING_OPS_MEDIA_KINDS], type: 'string' },
        maxItems: 3,
        type: 'array',
        uniqueItems: true,
      },
      utmMedium: {
        enum: [...MARKETING_OPS_UTM_MEDIUM_VALUES],
        type: 'string',
      },
    },
    required: ['canonicalUrl', 'format', 'links', 'media', 'utmMedium'],
    type: 'object',
  }
}

function ownerHandoffSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      artifactChecksums: { items: { type: 'string' }, type: 'array' },
      channel: { type: 'string' },
      checklist: { items: { type: 'string' }, type: 'array' },
      expiresAt: { format: 'date-time', type: 'string' },
      handoffId: { type: 'string' },
      officialTargetUrl: { format: 'uri', type: 'string' },
      projectId: { type: 'string' },
      publicationId: { type: 'string' },
      status: { enum: ['pending'], type: 'string' },
    },
    required: [
      'activityId',
      'artifactChecksums',
      'channel',
      'checklist',
      'expiresAt',
      'handoffId',
      'officialTargetUrl',
      'projectId',
      'publicationId',
      'status',
    ],
    type: 'object',
  }
}

function channelContentSchema(): Record<string, unknown> {
  return {
    properties: {
      activityId: { type: 'string' },
      artifactIds: {
        description: '引用本活动内的活动素材 ID；发布 readiness 只把最终 image/video 计入逐形态媒体要求，缺省为空数组',
        items: { type: 'string' },
        type: 'array',
      },
      body: { type: 'string' },
      channel: { type: 'string' },
      contentGroupId: { type: 'string' },
      contentId: { type: 'string' },
      format: { enum: ['article', 'image-text', 'short-post', 'video'], type: 'string' },
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

function channelContentMediaRevisionSchema(): Record<string, unknown> {
  return {
    properties: {
      artifactIds: {
        description: '最终 image/video 活动产物 ID；replace 只替换媒体引用并保留文章、音频等非媒体引用。',
        items: { type: 'string' },
        type: 'array',
      },
      baseVersion: { minimum: 1, type: 'integer' },
      contentId: { type: 'string' },
      mode: { enum: ['append', 'replace'], type: 'string' },
      projectId: { type: 'string' },
    },
    required: ['artifactIds', 'baseVersion', 'contentId', 'mode', 'projectId'],
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
              description: '引用本活动内的活动素材 ID；发布 readiness 只把最终 image/video 计入逐形态媒体要求，缺省为空数组',
              items: { type: 'string' },
              type: 'array',
            },
            body: { type: 'string' },
            channel: { type: 'string' },
            contentId: { type: 'string' },
            format: { enum: ['article', 'image-text', 'short-post', 'video'], type: 'string' },
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

async function toolCall(
  id: string | number,
  params: unknown,
  options: ContentStudioMcpServerOptions,
): Promise<McpJsonRpcResponse> {
  try {
    const value = asRecord(params, 'tools/call params')
    assertKeys(value, ['_meta', 'arguments', 'name'], 'tools/call params')
    const name = stringField(value.name, 'name')
    const input = value.arguments ?? {}
    assertNoSensitiveKeys(input)
    const result = name === 'get_marketing_ops_channels_status'
      ? await executeMarketingOpsStatus(input, options)
      : await executeTool(name, input, options)
    if (name === 'start_production_task' && supportsTasks(value._meta)) {
      return success(id, {
        ...asRecord(result, 'task result'),
        resultType: 'task',
      })
    }
    return success(id, toolResult(result))
  }
  catch (error: unknown) {
    return success(id, {
      content: [{
        text: error instanceof Error ? error.message : 'Tool execution failed',
        type: 'text',
      }],
      isError: true,
      resultType: 'complete',
    })
  }
}

async function executeMarketingOpsStatus(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Promise<MarketingOpsChannelsStatusSnapshot> {
  const value = scopedRecord(input, options.projectId, ['projectId'])
  if (options.marketingOpsStatus === undefined)
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  try {
    const status = await options.marketingOpsStatus.getChannelsStatus(value.projectId)
    if (
      status.projectId !== value.projectId
      || status.authorizesExternalWrite !== false
      || !isMarketingOpsStatusSnapshotFresh(status)
    ) {
      throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
    }
    return status
  }
  catch {
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  }
}

interface ParsedMarketingOpsAssistedPublicationInput {
  authorization: {
    authorizedAt: string
    source: 'owner-prompt'
  }
}

interface ParsedMarketingOpsAssistedPreparation
  extends ParsedMarketingOpsAssistedPublicationInput {
  execution: { mode: 'assisted-prepare' }
  preparation: PrepareMarketingOpsPublicationPackageInput
}

interface ParsedMarketingOpsAssistedConfirmation
  extends ParsedMarketingOpsAssistedPublicationInput {
  execution: { mode: 'assisted-confirm', publicUrl: string }
  handoffId: string
  projectId: string
}

async function executeMarketingOpsAssistedPublication(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Promise<unknown> {
  if (options.marketingOpsPublish === undefined)
    throw new Error(MARKETING_OPS_PUBLISH_UNAVAILABLE_MESSAGE)
  const parsed = parseMarketingOpsAssistedPublicationInput(input, options.projectId)
  if ('preparation' in parsed)
    return executeMarketingOpsAssistedPreparation(parsed, options)
  return executeMarketingOpsAssistedConfirmation(parsed, options)
}

async function executeMarketingOpsAssistedPreparation(
  parsed: ParsedMarketingOpsAssistedPreparation,
  options: ContentStudioMcpServerOptions,
): Promise<unknown> {
  const status = await executeMarketingOpsStatus({ projectId: parsed.preparation.projectId }, options)
  assertBilibiliAssistedReady(status)
  const prepared = options.service.prepareMarketingOpsPublicationPackage(parsed.preparation)
  const packageValue = prepared.package
  assertBilibiliAssistedPackage(packageValue)
  const result = await options.marketingOpsPublish!.publishCampaign(
    buildMarketingOpsCampaignRequest({
      authorization: parsed.authorization,
      campaignId: packageValue.campaignId,
      execution: { mode: 'assisted-prepare' },
      idempotencyKey: publicationIdempotencyKey(packageValue),
      packages: [packageValue],
      spec: createMarketingOpsCampaignSpec([packageValue]),
    }),
  )
  if (
    result.failures.length > 0
    || !result.handoffs.some(handoff =>
      handoff.packageId === packageValue.packageId
      && handoff.publicationId === packageValue.publicationId
      && handoff.form === packageValue.contentFormat
      && handoff.status === 'awaiting-owner',
    )
  ) {
    throw new Error('Marketing Ops did not prepare the owner handoff')
  }
  const handoff = options.service.createMarketingOpsPublicationHandoff(packageValue)
  return {
    ...result,
    handoff,
    mode: 'assisted-prepare',
    package: packageValue,
  }
}

async function executeMarketingOpsAssistedConfirmation(
  parsed: ParsedMarketingOpsAssistedConfirmation,
  options: ContentStudioMcpServerOptions,
): Promise<unknown> {
  const handoff = options.service.getMarketingOpsPublicationHandoff(
    parsed.projectId,
    parsed.handoffId,
  )
  const packageValue = handoff.marketingOpsPackage
  if (packageValue === undefined)
    throw new Error('Owner handoff does not contain a marketing-ops package')
  assertBilibiliAssistedPackage(packageValue)
  assertCurrentBilibiliOwnerAssistedBinding(options.service, packageValue)
  const status = await executeMarketingOpsStatus({ projectId: packageValue.projectId }, options)
  assertBilibiliAssistedReady(status)
  options.service.claimMarketingOpsPublicationConfirmation(
    parsed.projectId,
    parsed.handoffId,
    parsed.execution.publicUrl,
  )
  const result = await options.marketingOpsPublish!.publishCampaign(
    buildMarketingOpsCampaignRequest({
      authorization: parsed.authorization,
      campaignId: packageValue.campaignId,
      execution: {
        confirmations: [{
          channel: packageValue.channel,
          form: packageValue.contentFormat,
          packageId: packageValue.packageId,
          publicUrl: parsed.execution.publicUrl,
          publicationId: packageValue.publicationId,
        }],
        mode: 'assisted-confirm',
      },
      idempotencyKey: publicationIdempotencyKey(packageValue),
      packages: [packageValue],
      spec: createMarketingOpsCampaignSpec([packageValue]),
    }),
  )
  const receipt = assertMarketingOpsAssistedConfirmationResult(
    result,
    packageValue,
    parsed.execution.publicUrl,
  )
  const receipts = [options.service.recordPublicationReceipt(receipt)]
  const completedHandoff = options.service.completeMarketingOpsPublicationHandoff(
    parsed.projectId,
    parsed.handoffId,
    parsed.execution.publicUrl,
  )
  return {
    ...result,
    handoff: completedHandoff,
    mode: 'assisted-confirm',
    package: packageValue,
    receipts,
  }
}

function assertCurrentBilibiliOwnerAssistedBinding(
  service: ContentStudioApplicationService,
  packageValue: MarketingOpsPublicationPackage,
): void {
  const binding = service
    .getProjectView(packageValue.projectId)
    .projectChannelBindings
    .find(candidate => candidate.channel === 'bilibili')
  if (
    binding?.enabled !== true
    || binding.delivery !== 'owner-assisted'
    || binding.accountRef !== packageValue.accountRef
  ) {
    throw new Error(
      'Bilibili owner-assisted confirmation requires the current matching channel binding',
    )
  }
}

function assertMarketingOpsAssistedConfirmationResult(
  result: MarketingOpsPublishResult,
  packageValue: MarketingOpsPublicationPackage,
  publicUrl: string,
): MarketingOpsPublishResult['receipts'][number] {
  if (result.failures.length > 0)
    throw new Error('Marketing Ops returned failures for the owner confirmation')
  if (result.receipts.length !== 1)
    throw new Error('Marketing Ops must return exactly one confirmation receipt')
  const receipt = result.receipts[0]!
  if (
    receipt.projectId !== packageValue.projectId
    || receipt.activityId !== packageValue.activityId
    || receipt.publicationId !== packageValue.publicationId
    || receipt.channel !== packageValue.channel
    || receipt.accountRef !== packageValue.accountRef
    || receipt.contentSha256 !== packageValue.contentHash
    || receipt.videoOrientation !== packageValue.videoOrientation
    || receipt.publicUrl !== publicUrl
    || receipt.status !== 'published'
  ) {
    throw new Error('Marketing Ops did not return a matching confirmation receipt')
  }
  return receipt
}

function parseMarketingOpsAssistedPublicationInput(
  input: unknown,
  projectId: string,
): ParsedMarketingOpsAssistedPreparation | ParsedMarketingOpsAssistedConfirmation {
  const value = asRecord(input, 'marketingOpsAssistedPublication')
  const scopedProjectId = scopedId(value.projectId, projectId, 'projectId')
  const authorization = asRecord(value.authorization, 'marketingOps authorization')
  assertKeys(authorization, ['authorizedAt', 'source'], 'marketingOps authorization')
  if (authorization.source !== 'owner-prompt')
    throw new McpToolError('marketingOps authorization source must be owner-prompt')
  const authorizedAt = stringField(
    authorization.authorizedAt,
    'marketingOps authorization authorizedAt',
  )
  if (Number.isNaN(Date.parse(authorizedAt)))
    throw new McpToolError('marketingOps authorization authorizedAt must be a date-time')
  const execution = asRecord(value.execution, 'marketingOps execution')
  const mode = stringField(execution.mode, 'marketingOps execution mode')
  if (mode === 'assisted-prepare') {
    assertKeys(
      value,
      ['authorization', 'execution', 'projectId', 'publicationId', 'renderer'],
      'marketingOpsAssistedPublication',
    )
    assertKeys(execution, ['mode'], 'marketingOps execution')
    const publicationId = identifierField(value.publicationId, 'publicationId')
    const preparation = parsePrepareMarketingOpsPublicationPackageInput({
      projectId: scopedProjectId,
      publicationId,
      renderer: value.renderer,
    }, scopedProjectId, publicationId)
    return {
      authorization: { authorizedAt, source: 'owner-prompt' },
      execution: { mode },
      preparation,
    }
  }
  if (mode !== 'assisted-confirm')
    throw new McpToolError('marketingOps execution mode is unsupported')
  assertKeys(
    value,
    ['authorization', 'execution', 'handoffId', 'projectId'],
    'marketingOpsAssistedPublication',
  )
  assertKeys(execution, ['mode', 'publicUrl'], 'marketingOps execution')
  const publicUrl = safeHttpsUrl(
    execution.publicUrl,
    'marketingOps execution publicUrl',
  )
  return {
    authorization: { authorizedAt, source: 'owner-prompt' },
    execution: { mode, publicUrl },
    handoffId: identifierField(value.handoffId, 'handoffId'),
    projectId: scopedProjectId,
  }
}

function assertBilibiliAssistedPackage(
  packageValue: MarketingOpsPublicationPackage,
): void {
  if (packageValue.channel !== 'bilibili')
    throw new McpToolError('Only Bilibili owner-assisted packages are enabled')
}

function assertBilibiliAssistedReady(
  status: MarketingOpsChannelsStatusSnapshot,
): void {
  if (!status.capabilities?.includes('content-studio-assisted-publication-v1'))
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  const bilibili = status.channels.find(channel => channel.channel === 'bilibili')
  if (
    bilibili === undefined
    || bilibili.health !== 'ready'
    || bilibili.assistedPublicationReady !== true
  ) {
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  }
}

function publicationIdempotencyKey(
  packageValue: { contentHash: string, publicationId: string, projectId: string },
): string {
  const digest = createHash('sha256')
    .update(`${packageValue.projectId}:${packageValue.publicationId}:${packageValue.contentHash}`)
    .digest('hex')
  return `content-studio/${digest}`
}

function safeHttpsUrl(input: unknown, name: string): string {
  const value = stringField(input, name)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new McpToolError(`${name} must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new McpToolError(`${name} must be an HTTPS URL without credentials or fragments`)
  return value
}
async function executeTool(
  name: string,
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Promise<unknown> {
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
    case 'register_activity_artifact': {
      const value = asRecord(input, 'activityArtifact')
      assertKeys(value, [
        'activityId',
        'artifactId',
        'kind',
        'locale',
        'projectId',
        'relativePath',
        'sha256',
      ], 'activityArtifact')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      return options.service.createActivityArtifact(
        parseCreateActivityArtifactInput(value, projectId, activityId),
      )
    }
    case 'promote_activity_artifact': {
      const value = asRecord(input, 'promoteActivityArtifact')
      assertKeys(value, ['artifactId', 'assetId', 'kind', 'projectId'], 'promoteActivityArtifact')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const artifactId = identifierField(value.artifactId, 'artifactId')
      return options.service.promoteActivityArtifact(
        parsePromoteActivityArtifactInput(value, projectId, artifactId),
      )
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
    case 'prepare_marketing_ops_package': {
      const value = asRecord(input, 'marketingOpsPackagePreparation')
      assertKeys(
        value,
        ['projectId', 'publicationId', 'renderer'],
        'marketingOpsPackagePreparation',
      )
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const publicationId = identifierField(value.publicationId, 'publicationId')
      return options.service.prepareMarketingOpsPublicationPackage(
        parsePrepareMarketingOpsPublicationPackageInput(
          value,
          projectId,
          publicationId,
        ),
      )
    }
    case 'publish_marketing_ops_package': {
      return executeMarketingOpsAssistedPublication(input, options)
    }
    case 'create_owner_handoff': {
      const value = asRecord(input, 'ownerHandoff')
      assertKeys(value, [
        'activityId',
        'artifactChecksums',
        'channel',
        'checklist',
        'expiresAt',
        'handoffId',
        'officialTargetUrl',
        'projectId',
        'publicationId',
        'status',
      ], 'ownerHandoff')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const activityId = identifierField(value.activityId, 'activityId')
      return options.service.createOwnerHandoff(
        parseCreateOwnerHandoffInput(value, projectId, activityId),
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
    case 'revise_channel_content_media': {
      const value = asRecord(input, 'channelContentMediaRevision')
      assertKeys(value, [
        'artifactIds',
        'baseVersion',
        'contentId',
        'mode',
        'projectId',
      ], 'channelContentMediaRevision')
      const projectId = scopedId(value.projectId, options.projectId, 'projectId')
      const contentId = identifierField(value.contentId, 'contentId')
      return options.service.reviseChannelContentMedia(
        parseReviseChannelContentMediaInput(value, projectId, contentId),
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
    case 'confirm_owner_takeover':
      return confirmOwnerTakeover(input, options)
    default:
      throw new McpToolError(`Unknown tool: ${name}`)
  }
}

function confirmOwnerTakeover(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const value = scopedRecord(input, options.projectId, ['projectId', 'taskId'])
  const taskId = identifierField(value.taskId, 'taskId')
  if (options.ownerTakeovers === undefined) {
    throw new McpToolError(
      'Owner takeover confirmation is not wired into this runtime',
    )
  }
  const ownerTakeover = options.ownerTakeovers.confirm(value.projectId, taskId)
  const task = options.service
    .getProjectView(value.projectId)
    .tasks
    .find(candidate => candidate.taskId === taskId)
  return {
    ...(task === undefined ? {} : { task }),
    ownerTakeover,
    projectId: value.projectId,
    taskId,
  }
}

function getTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): {
  compositionReceipts: ReturnType<ContentStudioApplicationService['listCompositionReceipts']>
  events: ReturnType<ContentStudioApplicationService['listTaskEvents']>
  task: ExecutionTask
} {
  const value = scopedRecord(input, options.projectId, ['projectId', 'taskId'])
  const taskId = identifierField(value.taskId, 'taskId')
  const view = options.service.getProjectView(value.projectId)
  const task = view.tasks.find(candidate => candidate.taskId === taskId)
  if (task === undefined)
    throw new RecordNotFoundError('Task', taskId)
  return {
    compositionReceipts: options.service.listCompositionReceipts(value.projectId, taskId),
    events: options.service.listTaskEvents(value.projectId, taskId),
    task,
  }
}

function startMcpProductionTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const handle = parseTaskHandle(input, options)
  const task = options.service.startProductionTask(handle.projectId, handle.taskId)
  enqueueMcpProductionTask(options, task)
  const events = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return toMcpTask(
    task,
    events,
    options.service.listCompositionReceipts(handle.projectId, handle.taskId),
  )
}

function changeTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
  operation: 'cancel' | 'retry',
): ExecutionTask {
  const value = scopedRecord(input, options.projectId, ['projectId', 'taskId'])
  const taskId = identifierField(value.taskId, 'taskId')
  if (operation === 'cancel') {
    options.ownerTakeovers?.dismiss(value.projectId, taskId)
    options.productionWorker?.cancel(value.projectId, taskId)
    return options.service.cancelTask(value.projectId, taskId)
  }
  const task = options.service.retryTask(value.projectId, taskId)
  enqueueMcpProductionTask(options, task)
  return task
}

function enqueueMcpProductionTask(
  options: ContentStudioMcpServerOptions,
  task: ExecutionTask,
): void {
  const job = options.productionWorkerJob?.(task)
  if (job !== undefined)
    options.productionWorker?.enqueue(job)
}

function toolResult(value: unknown): Record<string, unknown> {
  return {
    content: [{
      text: JSON.stringify(value),
      type: 'text',
    }],
    isError: false,
    resultType: 'complete',
    structuredContent: value,
  }
}

function getMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const handle = parseTaskHandle(input, options)
  const view = options.service.getProjectView(handle.projectId)
  const task = requireTask(view.tasks, handle.taskId)
  const events = options.service.listTaskEvents(handle.projectId, handle.taskId)
  return {
    ...toMcpTask(
      task,
      events,
      options.service.listCompositionReceipts(handle.projectId, handle.taskId),
    ),
    resultType: 'complete',
  }
}

function updateMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const value = asRecord(input, 'tasks/update params')
  assertKeys(
    value,
    ['_meta', 'inputResponses', 'projectId', 'taskId'],
    'tasks/update params',
  )
  const handle = parseTaskHandle(value, options, ['inputResponses'])
  const view = options.service.getProjectView(handle.projectId)
  const task = requireTask(view.tasks, handle.taskId)
  const inputResponses = asRecord(value.inputResponses, 'inputResponses')
  assertNoSensitiveKeys(inputResponses)
  if (task.status === 'awaiting-owner') {
    const response = inputResponses['owner-confirmation']
    if (isAcceptedOwnerConfirmation(response)) {
      if (options.ownerTakeovers === undefined) {
        throw new McpToolError(
          'Owner takeover confirmation is not wired into this runtime',
        )
      }
      options.ownerTakeovers.confirm(handle.projectId, handle.taskId)
    }
  }
  return { resultType: 'complete' }
}

function cancelMcpTask(
  input: unknown,
  options: ContentStudioMcpServerOptions,
): Record<string, unknown> {
  const handle = parseTaskHandle(input, options)
  const task = requireTask(
    options.service.getProjectView(handle.projectId).tasks,
    handle.taskId,
  )
  if (mapTaskStatus(task.status) === 'completed'
    || task.status === 'cancelled'
    || task.status === 'failed') {
    return { resultType: 'complete' }
  }
  options.ownerTakeovers?.dismiss(handle.projectId, handle.taskId)
  options.productionWorker?.cancel(handle.projectId, handle.taskId)
  try {
    options.service.cancelTask(handle.projectId, handle.taskId)
  }
  catch (error: unknown) {
    if (!(error instanceof TaskStateError))
      throw error
  }
  return { resultType: 'complete' }
}

function parseTaskHandle(
  input: unknown,
  options: ContentStudioMcpServerOptions,
  additionalKeys: readonly string[] = [],
): { projectId: string, taskId: string } {
  const value = asRecord(input, 'task params')
  assertKeys(
    value,
    ['_meta', 'projectId', 'taskId', ...additionalKeys],
    'task params',
  )
  const projectId = value.projectId === undefined
    ? options.projectId
    : scopedId(value.projectId, options.projectId, 'projectId')
  const taskId = identifierField(value.taskId, 'taskId')
  return { projectId, taskId }
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
  compositionReceipts: CompositionAttemptReceipt[] = [],
): Record<string, unknown> {
  const lastEvent = events.at(-1)
  const status = mapTaskStatus(task.status)
  const compositionEvents = events.filter(event => event.kind.startsWith('composition-'))
  const composition = compositionEvents.length === 0 && compositionReceipts.length === 0
    ? undefined
    : {
        events: compositionEvents,
        receipts: compositionReceipts,
      }
  const base = {
    attempt: task.attempt,
    createdAt: task.createdAt ?? task.updatedAt ?? new Date(0).toISOString(),
    internalStatus: task.status,
    lastUpdatedAt: task.updatedAt ?? task.createdAt ?? new Date(0).toISOString(),
    pollIntervalMs: 1000,
    projectId: task.projectId,
    status,
    ...(lastEvent === undefined ? {} : { statusMessage: lastEvent.message }),
    ...(composition === undefined ? {} : { composition }),
    taskId: task.taskId,
    ttlMs: null,
  }
  if (status === 'input_required') {
    return {
      ...base,
      inputRequests: {
        'owner-confirmation': ownerConfirmationRequest(task),
      },
    }
  }
  if (status === 'completed') {
    return {
      ...base,
      result: toolResult({
        ...(composition === undefined ? {} : { composition }),
        task,
      }),
    }
  }
  if (status === 'failed') {
    return {
      ...base,
      error: {
        code: -32000,
        message: lastEvent?.message ?? `Task ${task.taskId} failed`,
      },
    }
  }
  return base
}

function mapTaskStatus(status: ExecutionTaskStatus): McpTaskStatus {
  if (status === 'awaiting-owner')
    return 'input_required'
  if (status === 'cancelled')
    return 'cancelled'
  if (status === 'failed')
    return 'failed'
  if (status === 'completed' || status === 'published')
    return 'completed'
  return 'working'
}

function ownerConfirmationRequest(task: ExecutionTask): Record<string, unknown> {
  return {
    method: 'elicitation/create',
    params: {
      message: `Confirm owner takeover for task ${task.taskId} after the owner has completed authentication.`,
      requestedSchema: {
        properties: {
          confirmed: {
            description: 'The owner confirms authentication is complete and recording may resume.',
            title: 'Resume recording',
            type: 'boolean',
          },
        },
        required: ['confirmed'],
        type: 'object',
      },
    },
  }
}

function isAcceptedOwnerConfirmation(input: unknown): boolean {
  if (!isRecord(input) || input.action !== 'accept' || !isRecord(input.content))
    return false
  return input.content.confirmed === true
}

function supportsTasks(input: unknown): boolean {
  if (!isRecord(input))
    return false
  const capabilities = input['io.modelcontextprotocol/clientCapabilities']
  if (!isRecord(capabilities) || !isRecord(capabilities.extensions))
    return false
  return isRecord(capabilities.extensions[TASKS_EXTENSION])
}

function assertMetadataParams(input: unknown, name: string): void {
  if (input === undefined)
    return
  const value = asRecord(input, name)
  assertKeys(value, ['_meta'], name)
  if (value._meta !== undefined)
    asRecord(value._meta, `${name} _meta`)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
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
