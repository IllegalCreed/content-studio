// @env node

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ContentStudioRepository } from '../control-plane/service'
import type { ProductionTaskDependencies } from '../jobs/production'
import type {
  ChannelContentFormat,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  ExecutionTaskStore,
  Locale,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  VideoFormat,
} from '../types'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { CHANNEL_BLUEPRINTS } from '../constants'
import {
  ContentStudioApplicationService,
  ProjectScopeError,
  RecordConflictError,
  RecordNotFoundError,
} from '../control-plane/service'
import { SqliteContentStudioRepository } from '../control-plane/sqlite'
import { SqliteExecutionTaskStore } from '../jobs/sqlite'
import {
  InMemoryExecutionTaskStore,
  TaskNotFoundError,
  TaskScopeError,
  TaskStateError,
} from '../jobs/task'
import { recordWithPlaywright } from '../recording/playwright'
import { assertNoSensitiveKeys } from '../validation'

const MAX_BODY_BYTES = 256 * 1024
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LOCALES = new Set<Locale>(['en', 'zh-CN'])
const ACTIVITY_GOALS = new Set(['education', 'feedback', 'launch'])
const ACTIVITY_STATUSES = new Set([
  'active',
  'archived',
  'completed',
  'draft',
  'planned',
])
const CONTENT_FORMATS = new Set<ChannelContentFormat>(['article', 'video'])
const VIDEO_FORMATS = new Set<VideoFormat>(['landscape', 'portrait', 'square'])

export interface ContentStudioServerOptions {
  databasePath?: string
  production?: ProductionTaskDependencies
  productionOutputRoot?: string
  project: ProjectRecord
  projectChannelBindings?: ProjectChannelBinding[]
  repository?: ContentStudioRepository
  snapshot: ProjectSnapshot
  taskStore?: ExecutionTaskStore
}

export interface ContentStudioServerHandle {
  close: () => Promise<void>
  repository: ContentStudioRepository
  server: Server
  service: ContentStudioApplicationService
  taskStore: ExecutionTaskStore
}

export interface ContentStudioApplicationHandle {
  close: () => void
  repository: ContentStudioRepository
  service: ContentStudioApplicationService
  taskStore: ExecutionTaskStore
}

export function createContentStudioServer(
  options: ContentStudioServerOptions,
): ContentStudioServerHandle {
  const application = createContentStudioApplication(options)
  const production = options.production ?? {
    record: recordWithPlaywright,
  }
  const productionOutputRoot = options.productionOutputRoot
    ?? resolve(
      dirname(options.databasePath ?? '.content-studio/content-studio.sqlite'),
      'production',
    )
  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      application.service,
      options.project.projectId,
      { dependencies: production, outputRoot: productionOutputRoot },
    )
  })

  return {
    close: () => closeServer(server, application.repository, application.taskStore),
    repository: application.repository,
    server,
    service: application.service,
    taskStore: application.taskStore,
  }
}

export function createContentStudioApplication(
  options: ContentStudioServerOptions,
): ContentStudioApplicationHandle {
  const repository = options.repository
    ?? new SqliteContentStudioRepository(
      options.databasePath ?? '.content-studio/content-studio.sqlite',
    )
  const taskStore = options.taskStore
    ?? (options.repository === undefined
      ? new SqliteExecutionTaskStore(
          options.databasePath ?? '.content-studio/content-studio.sqlite',
        )
      : new InMemoryExecutionTaskStore())
  const service = new ContentStudioApplicationService(repository, taskStore)
  registerInitialProject(service, repository, options)

  return {
    close: () => closeApplication(repository, taskStore),
    repository,
    service,
    taskStore,
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: ContentStudioApplicationService,
  projectId: string,
  production: RuntimeProductionOptions,
): Promise<void> {
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST')
  response.setHeader('Access-Control-Allow-Origin', '*')
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const segments = url.pathname.split('/').filter(Boolean)
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      service.getProjectView(projectId)
      sendJson(response, 200, {
        contractVersion: 1,
        projectId,
        status: 'ready',
      })
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 4
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
    ) {
      const projectId = decodeSegment(segments[3]!)
      sendJson(response, 200, service.getProjectView(projectId))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'tasks'
      && segments[6] === 'record'
    ) {
      const requestProjectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const taskId = identifierField(
        decodeSegment(segments[5]!),
        'taskId',
      )
      const input = parseRecordProductionInput(await readJsonBody(request))
      const result = await service.runActivityProductionTask(
        requestProjectId,
        taskId,
        {
          ...input,
          outputDirectory: join(production.outputRoot, requestProjectId, taskId),
        },
        production.dependencies,
      )
      sendJson(response, 200, result)
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 5
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const input = parseCreateActivityInput(await readJsonBody(request), projectId)
      sendJson(response, 201, service.createActivity(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'content-groups'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const activityId = decodeSegment(segments[5]!)
      const input = parseCreateContentGroupInput(
        await readJsonBody(request),
        projectId,
        activityId,
      )
      sendJson(response, 201, service.createContentGroup(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 9
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'content-groups'
      && segments[8] === 'contents'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const activityId = decodeSegment(segments[5]!)
      const contentGroupId = decodeSegment(segments[7]!)
      const input = parseCreateChannelContentInput(
        await readJsonBody(request),
        projectId,
        activityId,
        contentGroupId,
      )
      sendJson(response, 201, service.createChannelContent(input))
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'tasks'
      && segments[6] === 'events'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const taskId = decodeSegment(segments[5]!)
      sendJson(response, 200, {
        events: service.listTaskEvents(projectId, taskId),
        taskId,
      })
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'tasks'
      && (
        segments[6] === 'cancel'
        || segments[6] === 'retry'
        || segments[6] === 'start'
      )
    ) {
      const projectId = decodeSegment(segments[3]!)
      const taskId = decodeSegment(segments[5]!)
      const task = segments[6] === 'cancel'
        ? service.cancelTask(projectId, taskId)
        : segments[6] === 'retry'
          ? service.retryTask(projectId, taskId)
          : service.startProductionTask(projectId, taskId)
      sendJson(response, 200, task)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  }
  catch (error: unknown) {
    const status = error instanceof RequestError
      ? error.status
      : error instanceof RecordNotFoundError || error instanceof TaskNotFoundError
        ? 404
        : error instanceof ProjectScopeError || error instanceof TaskScopeError
          ? 403
          : error instanceof RecordConflictError || error instanceof TaskStateError
            ? 409
            : 400
    sendJson(response, status, {
      error: error instanceof Error ? error.message : 'Request failed',
    })
  }
}

function registerInitialProject(
  service: ContentStudioApplicationService,
  repository: ContentStudioRepository,
  options: ContentStudioServerOptions,
): void {
  const existingProject = repository.getProject(options.project.projectId)
  if (existingProject === undefined) {
    service.registerProject(options.project, options.snapshot)
  }
  else if (existingProject.currentSnapshotId !== options.snapshot.snapshotId) {
    throw new Error(
      `Registered project ${options.project.projectId} uses a different snapshot`,
    )
  }

  for (const binding of options.projectChannelBindings ?? []) {
    const exists = repository
      .listProjectChannelBindings(options.project.projectId)
      .some(candidate => candidate.channel === binding.channel)
    if (!exists)
      service.bindProjectChannel(binding)
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES)
      throw new RequestError(413, 'Request body is too large')
    chunks.push(buffer)
  }
  const source = Buffer.concat(chunks).toString('utf8').trim()
  if (source === '')
    throw new RequestError(400, 'Request body must be JSON')
  try {
    return JSON.parse(source) as unknown
  }
  catch {
    throw new RequestError(400, 'Request body must be valid JSON')
  }
}

function parseRecordProductionInput(input: unknown): {
  baseUrl: string
  projectOrigin: string
} {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'record task')
  const supportedKeys = new Set(['baseUrl', 'projectOrigin'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `record task contains unsupported field: ${key}`)
  }
  return {
    baseUrl: httpUrlField(value.baseUrl, 'baseUrl'),
    projectOrigin: httpUrlField(value.projectOrigin, 'projectOrigin'),
  }
}

export function parseCreateActivityInput(
  input: unknown,
  projectId: string,
): CreatePublishingActivityInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'activity')
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const channels = channelsField(value.channels)
  const targetUrl = httpsUrlField(value.targetUrl, 'targetUrl')
  return {
    activityId: identifierField(value.activityId, 'activityId'),
    campaignId: identifierField(value.campaignId, 'campaignId'),
    channels,
    goal: goalField(value.goal),
    projectId,
    projectSnapshotId: stringField(value.projectSnapshotId, 'projectSnapshotId'),
    status: statusField(value.status),
    targetUrl,
    topic: localizedTextField(value.topic, 'topic'),
    ...(value.video === undefined ? {} : { video: videoField(value.video) }),
  }
}

export function parseCreateContentGroupInput(
  input: unknown,
  projectId: string,
  activityId: string,
): CreateContentGroupInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'contentGroup')
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  return {
    activityId,
    contentGroupId: identifierField(value.contentGroupId, 'contentGroupId'),
    coreMessage: stringField(value.coreMessage, 'coreMessage'),
    projectId,
    title: stringField(value.title, 'title'),
  }
}

export function parseCreateChannelContentInput(
  input: unknown,
  projectId: string,
  activityId: string,
  contentGroupId: string,
): CreateChannelContentInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'channelContent')
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const inputContentGroupId = identifierField(value.contentGroupId, 'contentGroupId')
  if (inputContentGroupId !== contentGroupId)
    throw new RequestError(400, 'contentGroupId must match the URL')
  const format = stringField(value.format, 'format')
  if (!CONTENT_FORMATS.has(format as ChannelContentFormat))
    throw new RequestError(400, `Unsupported content format: ${format}`)
  const locale = stringField(value.locale, 'locale')
  if (!LOCALES.has(locale as Locale))
    throw new RequestError(400, `Unsupported locale: ${locale}`)
  const channel = stringField(value.channel, 'channel')
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${channel}`)
  return {
    activityId,
    artifactIds: artifactIdsField(value.artifactIds),
    body: stringField(value.body, 'body'),
    channel: channel as CreateChannelContentInput['channel'],
    contentGroupId,
    contentId: identifierField(value.contentId, 'contentId'),
    format: format as ChannelContentFormat,
    locale: locale as Locale,
    projectId,
    title: stringField(value.title, 'title'),
  }
}

function channelsField(input: unknown): CreatePublishingActivityInput['channels'] {
  if (!Array.isArray(input) || input.length === 0)
    throw new RequestError(400, 'channels must be a non-empty array')
  const channels = input.map((item, index) => {
    const value = asRecord(item, `channels[${index}]`)
    const id = stringField(value.id, `channels[${index}].id`)
    if (!(id in CHANNEL_BLUEPRINTS))
      throw new RequestError(400, `Unsupported channel: ${id}`)
    const locale = stringField(value.locale, `channels[${index}].locale`)
    if (!LOCALES.has(locale as Locale))
      throw new RequestError(400, `Unsupported locale: ${locale}`)
    return { id: id as CreatePublishingActivityInput['channels'][number]['id'], locale: locale as Locale }
  })
  const ids = new Set<string>()
  for (const channel of channels) {
    if (ids.has(channel.id))
      throw new RequestError(400, `Duplicate channel: ${channel.id}`)
    ids.add(channel.id)
  }
  return channels
}

function localizedTextField(input: unknown, name: string): CreatePublishingActivityInput['topic'] {
  const value = asRecord(input, name)
  return {
    'en': stringField(value.en, `${name}.en`),
    'zh-CN': stringField(value['zh-CN'], `${name}.zh-CN`),
  }
}

function goalField(input: unknown): CreatePublishingActivityInput['goal'] {
  const value = stringField(input, 'goal')
  if (!ACTIVITY_GOALS.has(value))
    throw new RequestError(400, `Unsupported activity goal: ${value}`)
  return value as CreatePublishingActivityInput['goal']
}

function statusField(input: unknown): CreatePublishingActivityInput['status'] {
  const value = stringField(input, 'status')
  if (!ACTIVITY_STATUSES.has(value))
    throw new RequestError(400, `Unsupported activity status: ${value}`)
  return value as CreatePublishingActivityInput['status']
}

function videoField(input: unknown): NonNullable<CreatePublishingActivityInput['video']> {
  const value = asRecord(input, 'video')
  if (!Array.isArray(value.flowIds) || value.flowIds.length === 0)
    throw new RequestError(400, 'video.flowIds must be a non-empty array')
  const flowIds = value.flowIds.map((flowId, index) =>
    identifierField(flowId, `video.flowIds[${index}]`),
  )
  if (new Set(flowIds).size !== flowIds.length)
    throw new RequestError(400, 'video.flowIds must not contain duplicates')
  const format = stringField(value.format, 'video.format')
  if (!VIDEO_FORMATS.has(format as VideoFormat))
    throw new RequestError(400, `Unsupported video format: ${format}`)
  return {
    flowIds,
    format: format as VideoFormat,
  }
}

function httpsUrlField(input: unknown, name: string): string {
  const value = stringField(input, name)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new RequestError(400, `${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    throw new RequestError(400, `${name} must be a public HTTPS URL without credentials`)
  return url.toString()
}

function httpUrlField(input: unknown, name: string): string {
  const value = stringField(input, name)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new RequestError(400, `${name} must be a valid HTTP(S) URL`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username !== ''
    || url.password !== ''
  ) {
    throw new RequestError(400, `${name} must be an HTTP(S) URL without credentials`)
  }
  return url.toString()
}

function identifierField(input: unknown, name: string): string {
  const value = stringField(input, name)
  if (!IDENTIFIER_PATTERN.test(value))
    throw new RequestError(400, `${name} must use lowercase kebab-case`)
  return value
}

function artifactIdsField(input: unknown): string[] {
  if (input === undefined)
    return []
  if (!Array.isArray(input))
    throw new RequestError(400, 'artifactIds must be an array')
  const ids = new Set<string>()
  for (const item of input) {
    const id = identifierField(item, 'artifactIds')
    if (ids.has(id))
      throw new RequestError(400, `Duplicate artifactId: ${id}`)
    ids.add(id)
  }
  return [...ids]
}

function stringField(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim() === '')
    throw new RequestError(400, `${name} must be a non-empty string`)
  return input.trim()
}

function asRecord(input: unknown, name: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new RequestError(400, `${name} must be an object`)
  return input as Record<string, unknown>
}

function decodeSegment(input: string): string {
  try {
    return decodeURIComponent(input)
  }
  catch {
    throw new RequestError(400, 'Path contains an invalid encoded segment')
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function closeServer(
  server: Server,
  repository: ContentStudioRepository,
  taskStore: ExecutionTaskStore,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const closeRepository = (): void => {
      closeApplication(repository, taskStore)
    }
    if (!server.listening) {
      closeRepository()
      resolve()
      return
    }
    server.close((error) => {
      closeRepository()
      if (error === undefined)
        resolve()
      else
        reject(error)
    })
  })
}

function closeApplication(
  repository: ContentStudioRepository,
  taskStore: ExecutionTaskStore,
): void {
  const close = (repository as ContentStudioRepository & { close?: () => void }).close
  close?.call(repository)
  const closeTaskStore = (taskStore as ExecutionTaskStore & { close?: () => void }).close
  closeTaskStore?.call(taskStore)
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RequestError'
  }
}

interface RuntimeProductionOptions {
  dependencies: ProductionTaskDependencies
  outputRoot: string
}
