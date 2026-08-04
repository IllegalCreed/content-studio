// @env node

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { ContentStudioRepository } from '../control-plane/service'
import type { ProductionTaskDependencies } from '../jobs/production'
import type { ProductionWorkerJob } from '../jobs/worker'
import type {
  ActivityArtifact,
  ActivityRevisionInput,
  ChannelContentFormat,
  ChannelId,
  ContentStudioGlobalView,
  ContentStudioProjectIndex,
  ContentStudioProjectView,
  CreateActivityArtifactInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  DeliveryMode,
  ExecutionTask,
  ExecutionTaskStore,
  Locale,
  MonitoringObservation,
  ObservationMetric,
  ObservationSource,
  OwnerHandoff,
  ProjectAssetKind,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  PromoteActivityArtifactInput,
  PublicationPlan,
  PublicationReceipt,
  StorageCleanupConfirmation,
  StorageCleanupPreview,
  StorageCleanupPreviewItem,
  StorageCleanupPreviewItemStatus,
  StorageCleanupPreviewTotals,
  StorageCleanupResult,
  StorageRecycleEntry,
  StorageRestoreResult,
  StorageRetentionClass,
  VideoFormat,
  VideoOutlineScene,
  VideoViewport,
} from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { CHANNEL_BLUEPRINTS, DEFAULT_STORAGE_RETENTION_POLICY } from '../constants'
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
import { ProductionWorker } from '../jobs/worker'
import { recordWithPlaywright } from '../recording/playwright'
import {
  listStorageRecycleEntries,
  moveToRecycleBin,
  restoreFromRecycleBin,
} from '../storage/recycle'
import {
  classifyStorageRetention,
  evaluateStorageRetention,
} from '../storage/retention'
import { assertNoSensitiveKeys } from '../validation'
import { validateVideoViewport } from '../video/viewport'

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
const DELIVERY_MODES = new Set<DeliveryMode>([
  'automatic-candidate',
  'content-only',
  'owner-assisted',
])
const VIDEO_FORMATS = new Set<VideoFormat>(['landscape', 'portrait', 'square'])
const OBSERVATION_METRICS = new Set<ObservationMetric>([
  'clicks',
  'comments',
  'favorites',
  'likes',
  'reads',
  'replies',
  'shares',
  'views',
])
const OBSERVATION_SOURCES = new Set<ObservationSource>([
  'authorized-adapter',
  'owner-entered',
  'public',
])
const ACTIVITY_ARTIFACT_KINDS = new Set<ActivityArtifact['kind']>([
  'article-version',
  'audio',
  'image',
  'preview-frame',
  'video-clip',
  'video',
])
const PROJECT_ASSET_KINDS = new Set<ProjectAssetKind>([
  'audio',
  'font',
  'image',
  'logo',
  'template',
  'video',
])

export interface ContentStudioServerOptions {
  additionalProjects?: Array<{
    project: ProjectRecord
    projectChannelBindings?: ProjectChannelBinding[]
    snapshot: ProjectSnapshot
  }>
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
  worker: ProductionWorker
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
  const worker = new ProductionWorker({
    onError: (_error, job) => {
      const task = application.taskStore.getTask(job.projectId, job.taskId)
      if (task?.status === 'generating' || task?.status === 'recording') {
        application.taskStore.transitionTask(job.projectId, job.taskId, 'failed')
      }
    },
    run: async ({
      baseUrl,
      outputDirectory,
      projectId,
      projectOrigin,
      signal,
      taskId,
    }) => application.service.runActivityProductionTask(
      projectId,
      taskId,
      {
        baseUrl,
        outputDirectory,
        projectOrigin,
        signal,
      },
      production,
    ),
  })
  const server = createServer((request, response) => {
    void handleRequest(
      request,
      response,
      application.service,
      options.project.projectId,
      {
        dependencies: production,
        outputRoot: productionOutputRoot,
        worker,
      },
    )
  })
  server.once('listening', () => {
    worker.start()
  })

  return {
    close: () => closeServer(server, application.repository, application.taskStore, worker),
    repository: application.repository,
    server,
    service: application.service,
    taskStore: application.taskStore,
    worker,
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
      && segments.length === 10
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'tasks'
      && segments[6] === 'recording-attempts'
      && segments[8] === 'artifacts'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const taskId = identifierField(decodeSegment(segments[5]!), 'taskId')
      const attempt = positiveIntegerField(
        Number(decodeSegment(segments[7]!)),
        'attempt',
      )
      const artifactId = identifierField(decodeSegment(segments[9]!), 'artifactId')
      const resource = service.getRecordingArtifact(
        projectId,
        taskId,
        attempt,
        artifactId,
      )
      const artifactPath = resolve(resource.artifactDirectory, resource.artifact.relativePath)
      const artifactRelativePath = relative(resource.artifactDirectory, artifactPath)
      if (
        artifactRelativePath === ''
        || artifactRelativePath.startsWith('..')
        || isAbsolute(artifactRelativePath)
      ) {
        throw new RequestError(400, 'Recording artifact path is unsafe')
      }
      const content = await readFile(artifactPath)
      response.setHeader('Cache-Control', 'private, max-age=60')
      response.setHeader('Content-Type', recordingArtifactContentType(artifactPath))
      response.writeHead(200)
      response.end(content)
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activity-artifacts'
      && segments[6] === 'preview'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const artifactId = identifierField(decodeSegment(segments[5]!), 'artifactId')
      const artifact = service.getActivityArtifact(projectId, artifactId)
      if (artifact === undefined)
        throw new RecordNotFoundError('Activity artifact', artifactId)
      await serveRegisteredPreview(
        response,
        production.outputRoot,
        projectId,
        artifact.relativePath,
        artifact.sha256,
        artifact.version,
      )
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 6
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'storage'
      && segments[5] === 'cleanup-preview'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      sendJson(
        response,
        200,
        await createStorageCleanupPreview(
          production.outputRoot,
          service.getProjectView(projectId),
        ),
      )
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 6
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'storage'
      && segments[5] === 'recycle'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      service.getProjectView(projectId)
      sendJson(response, 200, {
        entries: await listStorageRecycleEntries(
          recycleRootForOutput(production.outputRoot),
          projectId,
        ),
        projectId,
      })
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'storage'
      && segments[5] === 'cleanup'
      && segments[6] === 'confirm'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const input = parseStorageCleanupConfirmation(
        await readJsonBody(request),
        projectId,
      )
      sendJson(
        response,
        200,
        await confirmStorageCleanup(
          production.outputRoot,
          service.getProjectView(projectId),
          input,
        ),
      )
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 8
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'storage'
      && segments[5] === 'recycle'
      && segments[7] === 'restore'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const recycleId = identifierField(decodeSegment(segments[6]!), 'recycleId')
      service.getProjectView(projectId)
      sendJson(
        response,
        200,
        await restoreStorageItem(
          production.outputRoot,
          projectId,
          recycleId,
        ),
      )
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'project-assets'
      && segments[6] === 'preview'
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const assetId = identifierField(decodeSegment(segments[5]!), 'assetId')
      const asset = service.getProjectAsset(projectId, assetId)
      if (asset === undefined)
        throw new RecordNotFoundError('Project asset', assetId)
      await serveRegisteredPreview(
        response,
        production.outputRoot,
        projectId,
        asset.relativePath,
        asset.sha256,
        asset.version,
      )
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 3
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'global'
    ) {
      const payload: ContentStudioGlobalView = service.getGlobalView()
      sendJson(response, 200, payload)
      return
    }

    if (
      request.method === 'GET'
      && segments.length === 3
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
    ) {
      const payload: ContentStudioProjectIndex = {
        projects: service.listProjects(),
      }
      sendJson(response, 200, payload)
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
      && segments.length === 6
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'channel-bindings'
    ) {
      const requestProjectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const channel = channelIdField(
        decodeSegment(segments[5]!),
        'channel',
      )
      const input = parseUpdateProjectChannelBindingInput(
        await readJsonBody(request),
        requestProjectId,
        channel,
      )
      sendJson(response, 200, service.setProjectChannelBinding(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'owner-handoffs'
      && (segments[6] === 'complete' || segments[6] === 'cancel')
    ) {
      const projectId = identifierField(decodeSegment(segments[3]!), 'projectId')
      const handoffId = identifierField(decodeSegment(segments[5]!), 'handoffId')
      const handoff = segments[6] === 'complete'
        ? service.completeOwnerHandoff(projectId, handoffId)
        : service.cancelOwnerHandoff(projectId, handoffId)
      sendJson(response, 200, handoff)
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
      if (production.worker.has(requestProjectId, taskId)) {
        throw new TaskStateError(
          `Production task ${taskId} is already scheduled by the local Worker`,
        )
      }
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
      && segments.length === 8
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'video-plan'
      && segments[7] === 'confirm'
    ) {
      const projectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const activityId = identifierField(
        decodeSegment(segments[5]!),
        'activityId',
      )
      const input = parseConfirmActivityVideoPlanInput(await readJsonBody(request))
      sendJson(response, 200, service.confirmActivityVideoPlan({
        activityId,
        baseVersion: input.baseVersion,
        projectId,
      }))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'revise'
    ) {
      const projectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const activityId = identifierField(
        decodeSegment(segments[5]!),
        'activityId',
      )
      const input = parseReviseActivityInput(
        await readJsonBody(request),
        projectId,
        activityId,
      )
      sendJson(response, 200, service.reviseActivity(input))
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
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'artifacts'
    ) {
      const projectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const activityId = identifierField(
        decodeSegment(segments[5]!),
        'activityId',
      )
      const input = parseCreateActivityArtifactInput(
        await readJsonBody(request),
        projectId,
        activityId,
      )
      sendJson(response, 201, service.createActivityArtifact(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activity-artifacts'
      && segments[6] === 'promote'
    ) {
      const projectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const artifactId = identifierField(
        decodeSegment(segments[5]!),
        'artifactId',
      )
      const input = parsePromoteActivityArtifactInput(
        await readJsonBody(request),
        projectId,
        artifactId,
      )
      sendJson(response, 201, service.promoteActivityArtifact(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'publication-plans'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const activityId = decodeSegment(segments[5]!)
      const input = parseCreatePublicationPlanInput(
        await readJsonBody(request),
        projectId,
        activityId,
      )
      sendJson(response, 201, service.createPublicationPlan(input))
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 9
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'publication-plans'
      && (segments[8] === 'receipts' || segments[8] === 'observations')
    ) {
      const requestProjectId = identifierField(
        decodeSegment(segments[3]!),
        'projectId',
      )
      const activityId = identifierField(
        decodeSegment(segments[5]!),
        'activityId',
      )
      const publicationId = identifierField(
        decodeSegment(segments[7]!),
        'publicationId',
      )
      const body = await readJsonBody(request)
      if (segments[8] === 'receipts') {
        const receipt = parseRecordPublicationReceiptInput(
          body,
          requestProjectId,
          activityId,
          publicationId,
        )
        sendJson(response, 201, service.recordPublicationReceipt(receipt))
      }
      else {
        const observation = parseRecordMonitoringObservationInput(
          body,
          requestProjectId,
          activityId,
          publicationId,
        )
        sendJson(response, 201, service.recordMonitoringObservation(observation))
      }
      return
    }

    if (
      request.method === 'POST'
      && segments.length === 7
      && segments[0] === 'api'
      && segments[1] === 'v1'
      && segments[2] === 'projects'
      && segments[4] === 'activities'
      && segments[6] === 'owner-handoffs'
    ) {
      const projectId = decodeSegment(segments[3]!)
      const activityId = decodeSegment(segments[5]!)
      const input = parseCreateOwnerHandoffInput(
        await readJsonBody(request),
        projectId,
        activityId,
      )
      sendJson(response, 201, service.createOwnerHandoff(input))
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
      if (segments[6] === 'cancel')
        production.worker.cancel(projectId, taskId)
      const task = segments[6] === 'cancel'
        ? service.cancelTask(projectId, taskId)
        : segments[6] === 'retry'
          ? service.retryTask(projectId, taskId)
          : service.startProductionTask(projectId, taskId)
      if (segments[6] === 'retry' || segments[6] === 'start') {
        const job = createProductionWorkerJob(
          service,
          production.outputRoot,
          task,
        )
        if (job !== undefined)
          production.worker.enqueue(job)
      }
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
  registerProjectIfMissing(
    service,
    repository,
    options.project,
    options.snapshot,
    options.projectChannelBindings,
  )
  for (const registration of options.additionalProjects ?? []) {
    registerProjectIfMissing(
      service,
      repository,
      registration.project,
      registration.snapshot,
      registration.projectChannelBindings,
    )
  }
}

function registerProjectIfMissing(
  service: ContentStudioApplicationService,
  repository: ContentStudioRepository,
  project: ProjectRecord,
  snapshot: ProjectSnapshot,
  projectChannelBindings: ProjectChannelBinding[] = [],
): void {
  const existingProject = repository.getProject(project.projectId)
  if (existingProject === undefined) {
    service.registerProject(project, snapshot)
  }
  else if (existingProject.currentSnapshotId !== snapshot.snapshotId) {
    throw new Error(
      `Registered project ${project.projectId} uses a different snapshot`,
    )
  }

  for (const binding of projectChannelBindings) {
    const exists = repository
      .listProjectChannelBindings(project.projectId)
      .some(candidate => candidate.channel === binding.channel)
    if (!exists)
      service.bindProjectChannel(binding)
  }
}

export function createProductionWorkerJob(
  service: ContentStudioApplicationService,
  outputRoot: string,
  task: ExecutionTask | undefined,
): ProductionWorkerJob | undefined {
  if (task === undefined || task.kind !== 'production' || task.productionType !== 'video')
    return undefined
  const view = service.getProjectView(task.projectId)
  if (view.project.sourceAccess !== 'source-owned' || view.project.captureMode !== 'deterministic')
    return undefined
  const canonicalUrl = view.snapshot.manifest.canonicalUrl
  const origin = new URL(canonicalUrl).origin
  return {
    baseUrl: origin,
    outputDirectory: join(outputRoot, task.projectId, task.taskId),
    projectId: task.projectId,
    projectOrigin: origin,
    taskId: task.taskId,
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

function parseConfirmActivityVideoPlanInput(input: unknown): { baseVersion: number } {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'confirm video plan')
  const supportedKeys = new Set(['baseVersion'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `confirm video plan contains unsupported field: ${key}`)
  }
  return {
    baseVersion: positiveIntegerField(value.baseVersion, 'baseVersion'),
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

export function parseReviseActivityInput(
  input: unknown,
  projectId: string,
  activityId: string,
): ActivityRevisionInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'activity revision')
  const supportedKeys = new Set(['activityId', 'baseVersion', 'projectId', 'topic', 'video'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `activity revision contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const video = value.video === undefined ? undefined : videoField(value.video)
  return {
    activityId,
    baseVersion: positiveIntegerField(value.baseVersion, 'baseVersion'),
    projectId,
    topic: localizedTextField(value.topic, 'topic'),
    ...(video === undefined ? {} : { video }),
  }
}

export function parseUpdateProjectChannelBindingInput(
  input: unknown,
  projectId: string,
  channel: ChannelId,
): ProjectChannelBinding {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'project channel binding')
  const supportedKeys = new Set(['accountAlias', 'accountRef', 'delivery', 'enabled'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `Unsupported project channel binding field: ${key}`)
  }
  const delivery = stringField(value.delivery, 'delivery')
  if (!DELIVERY_MODES.has(delivery as DeliveryMode))
    throw new RequestError(400, `Unsupported delivery mode: ${delivery}`)
  if (typeof value.enabled !== 'boolean')
    throw new RequestError(400, 'enabled must be a boolean')
  const accountAlias = optionalTextField(value.accountAlias, 'accountAlias')
  const accountRef = optionalAccountRefField(value.accountRef)
  return {
    ...(accountAlias === undefined ? {} : { accountAlias }),
    ...(accountRef === undefined ? {} : { accountRef }),
    channel,
    delivery: delivery as DeliveryMode,
    enabled: value.enabled,
    projectId,
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

export function parseCreateActivityArtifactInput(
  input: unknown,
  projectId: string,
  activityId: string,
): CreateActivityArtifactInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'activityArtifact')
  const supportedKeys = new Set([
    'activityId',
    'artifactId',
    'kind',
    'projectId',
    'relativePath',
    'sha256',
  ])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `activityArtifact contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const kind = stringField(value.kind, 'kind')
  if (!ACTIVITY_ARTIFACT_KINDS.has(kind as ActivityArtifact['kind']))
    throw new RequestError(400, `Unsupported activity artifact kind: ${kind}`)
  return {
    activityId,
    artifactId: identifierField(value.artifactId, 'artifactId'),
    kind: kind as ActivityArtifact['kind'],
    projectId,
    relativePath: relativePathField(value.relativePath),
    sha256: sha256Field(value.sha256),
  }
}

export function parsePromoteActivityArtifactInput(
  input: unknown,
  projectId: string,
  artifactId: string,
): PromoteActivityArtifactInput {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'promoteActivityArtifact')
  const supportedKeys = new Set(['artifactId', 'assetId', 'kind', 'projectId'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `promoteActivityArtifact contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputArtifactId = identifierField(value.artifactId, 'artifactId')
  if (inputArtifactId !== artifactId)
    throw new RequestError(400, 'artifactId must match the URL')
  const kind = stringField(value.kind, 'kind')
  if (!PROJECT_ASSET_KINDS.has(kind as ProjectAssetKind))
    throw new RequestError(400, `Unsupported project asset kind: ${kind}`)
  return {
    artifactId,
    assetId: identifierField(value.assetId, 'assetId'),
    kind: kind as ProjectAssetKind,
    projectId,
  }
}

export function parseStorageCleanupConfirmation(
  input: unknown,
  projectId: string,
): StorageCleanupConfirmation {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'storage cleanup confirmation')
  const supportedKeys = new Set(['itemIds', 'previewId', 'projectId'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `storage cleanup confirmation contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  return {
    itemIds: identifierListField(value.itemIds, 'itemIds'),
    previewId: stringField(value.previewId, 'previewId'),
    projectId,
  }
}

export function parseCreatePublicationPlanInput(
  input: unknown,
  projectId: string,
  activityId: string,
): PublicationPlan {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'publicationPlan')
  const supportedKeys = new Set([
    'activityId',
    'channel',
    'contentId',
    'projectId',
    'publicationId',
  ])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `publicationPlan contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const channel = stringField(value.channel, 'channel')
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${channel}`)
  return {
    activityId,
    channel: channel as PublicationPlan['channel'],
    contentId: identifierField(value.contentId, 'contentId'),
    projectId,
    publicationId: identifierField(value.publicationId, 'publicationId'),
  }
}

export function parseCreateOwnerHandoffInput(
  input: unknown,
  projectId: string,
  activityId: string,
): OwnerHandoff {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'ownerHandoff')
  const supportedKeys = new Set([
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
  ])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `ownerHandoff contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const channel = stringField(value.channel, 'channel')
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${channel}`)
  const status = stringField(value.status, 'status')
  if (status !== 'pending')
    throw new RequestError(400, 'New owner handoff status must be pending')
  return {
    activityId,
    artifactChecksums: stringListField(value.artifactChecksums, 'artifactChecksums'),
    channel: channel as OwnerHandoff['channel'],
    checklist: stringListField(value.checklist, 'checklist'),
    expiresAt: dateTimeField(value.expiresAt, 'expiresAt'),
    handoffId: identifierField(value.handoffId, 'handoffId'),
    officialTargetUrl: httpsUrlField(value.officialTargetUrl, 'officialTargetUrl'),
    projectId,
    publicationId: identifierField(value.publicationId, 'publicationId'),
    status: 'pending',
  }
}

export function parseRecordPublicationReceiptInput(
  input: unknown,
  projectId: string,
  activityId: string,
  publicationId: string,
): PublicationReceipt {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'publicationReceipt')
  const supportedKeys = new Set([
    'activityId',
    'accountRef',
    'channel',
    'externalReceiptId',
    'issuedAt',
    'projectId',
    'publicationId',
    'publicUrl',
    'receiptId',
    'source',
    'status',
  ])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `publicationReceipt contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const inputPublicationId = identifierField(value.publicationId, 'publicationId')
  if (inputPublicationId !== publicationId)
    throw new RequestError(400, 'publicationId must match the URL')
  const channel = stringField(value.channel, 'channel')
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${channel}`)
  const status = stringField(value.status, 'status')
  if (status !== 'failed' && status !== 'published')
    throw new RequestError(400, `Unsupported publication receipt status: ${status}`)
  const source = value.source === undefined
    ? undefined
    : stringField(value.source, 'source')
  if (source !== undefined && source !== 'marketing-ops')
    throw new RequestError(400, `Unsupported publication receipt source: ${source}`)
  if (status === 'published' && source !== 'marketing-ops')
    throw new RequestError(400, 'Published publication receipts must come from marketing-ops')
  const issuedAt = value.issuedAt === undefined
    ? undefined
    : dateTimeField(value.issuedAt, 'issuedAt')
  if (status === 'published' && issuedAt === undefined)
    throw new RequestError(400, 'Published publication receipts require issuedAt')
  return {
    activityId,
    ...(value.accountRef === undefined ? {} : { accountRef: stringField(value.accountRef, 'accountRef') }),
    channel: channel as PublicationReceipt['channel'],
    externalReceiptId: stringField(value.externalReceiptId, 'externalReceiptId'),
    ...(issuedAt === undefined ? {} : { issuedAt }),
    projectId,
    publicationId,
    ...(value.publicUrl === undefined
      ? {}
      : { publicUrl: httpsUrlField(value.publicUrl, 'publicUrl') }),
    receiptId: identifierField(value.receiptId, 'receiptId'),
    ...(source === undefined ? {} : { source: source as PublicationReceipt['source'] }),
    status,
  }
}

export function parseRecordMonitoringObservationInput(
  input: unknown,
  projectId: string,
  activityId: string,
  publicationId: string,
): MonitoringObservation {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'monitoringObservation')
  const supportedKeys = new Set([
    'activityId',
    'channel',
    'collectedAt',
    'metrics',
    'observationId',
    'projectId',
    'publicationId',
    'source',
  ])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `monitoringObservation contains unsupported field: ${key}`)
  }
  const inputProjectId = stringField(value.projectId, 'projectId')
  if (inputProjectId !== projectId)
    throw new RequestError(400, 'projectId must match the URL')
  const inputActivityId = identifierField(value.activityId, 'activityId')
  if (inputActivityId !== activityId)
    throw new RequestError(400, 'activityId must match the URL')
  const inputPublicationId = identifierField(value.publicationId, 'publicationId')
  if (inputPublicationId !== publicationId)
    throw new RequestError(400, 'publicationId must match the URL')
  const channel = stringField(value.channel, 'channel')
  if (!(channel in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${channel}`)
  const source = stringField(value.source, 'source')
  if (!OBSERVATION_SOURCES.has(source as ObservationSource))
    throw new RequestError(400, `Unsupported observation source: ${source}`)
  return {
    activityId,
    channel: channel as MonitoringObservation['channel'],
    collectedAt: dateTimeField(value.collectedAt, 'collectedAt'),
    metrics: observationMetricsField(value.metrics),
    observationId: identifierField(value.observationId, 'observationId'),
    projectId,
    publicationId,
    source: source as ObservationSource,
  }
}

function observationMetricsField(
  input: unknown,
): Partial<Record<ObservationMetric, number | null>> {
  const value = asRecord(input, 'metrics')
  const metrics: Partial<Record<ObservationMetric, number | null>> = {}
  for (const [key, metric] of Object.entries(value)) {
    if (!OBSERVATION_METRICS.has(key as ObservationMetric))
      throw new RequestError(400, `Unsupported observation metric: ${key}`)
    if (metric !== null && (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0))
      throw new RequestError(400, `metrics.${key} must be a non-negative number or null`)
    metrics[key as ObservationMetric] = metric
  }
  return metrics
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
  const supportedKeys = new Set(['flowIds', 'format', 'outline', 'planVersion', 'viewport'])
  for (const key of Object.keys(value)) {
    if (!supportedKeys.has(key))
      throw new RequestError(400, `video contains unsupported field: ${key}`)
  }
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
  const planVersion = value.planVersion === undefined
    ? undefined
    : positiveIntegerField(value.planVersion, 'video.planVersion')
  const outline = value.outline === undefined
    ? undefined
    : videoOutlineField(value.outline)
  let viewport: VideoViewport | undefined
  if (value.viewport !== undefined) {
    try {
      viewport = validateVideoViewport(value.viewport, format as VideoFormat)
    }
    catch (error: unknown) {
      throw new RequestError(
        400,
        error instanceof Error ? error.message : 'Invalid video viewport',
      )
    }
  }
  return {
    flowIds,
    format: format as VideoFormat,
    ...(outline === undefined ? {} : { outline }),
    ...(planVersion === undefined ? {} : { planVersion }),
    ...(viewport === undefined ? {} : { viewport }),
  }
}

function videoOutlineField(input: unknown): VideoOutlineScene[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new RequestError(400, 'video.outline must be a non-empty array')
  const scenes = input.map((item, index) => {
    const value = asRecord(item, `video.outline[${index}]`)
    return {
      flowId: identifierField(value.flowId, `video.outline[${index}].flowId`),
      objective: localizedTextField(
        value.objective,
        `video.outline[${index}].objective`,
      ),
      title: localizedTextField(
        value.title,
        `video.outline[${index}].title`,
      ),
    }
  })
  const flowIds = new Set<string>()
  for (const scene of scenes) {
    if (flowIds.has(scene.flowId))
      throw new RequestError(400, `Duplicate video outline flowId: ${scene.flowId}`)
    flowIds.add(scene.flowId)
  }
  return scenes
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

function channelIdField(input: unknown, name: string): ChannelId {
  const value = stringField(input, name)
  if (!(value in CHANNEL_BLUEPRINTS))
    throw new RequestError(400, `Unsupported channel: ${value}`)
  return value as ChannelId
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

function identifierListField(input: unknown, name: string): string[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new RequestError(400, `${name} must be a non-empty array`)
  const values = input.map((item, index) => identifierField(item, `${name}[${index}]`))
  if (new Set(values).size !== values.length)
    throw new RequestError(400, `${name} must not contain duplicates`)
  return values
}

function stringListField(input: unknown, name: string): string[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new RequestError(400, `${name} must be a non-empty array`)
  const values = input.map((item, index) => stringField(item, `${name}[${index}]`))
  if (new Set(values).size !== values.length)
    throw new RequestError(400, `${name} must not contain duplicates`)
  return values
}

function relativePathField(input: unknown): string {
  const value = stringField(input, 'relativePath')
  const segments = value.split(/[\\/]/u)
  if (
    value.startsWith('/')
    || /^[a-zA-Z]:[\\/]/u.test(value)
    || segments.includes('..')
    || value.includes('\u0000')
  ) {
    throw new RequestError(400, 'relativePath must stay inside the project output directory')
  }
  return value
}

function sha256Field(input: unknown): string {
  const value = stringField(input, 'sha256')
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new RequestError(400, 'sha256 must be a lowercase 64-character hexadecimal digest')
  return value
}

function dateTimeField(input: unknown, name: string): string {
  const value = stringField(input, name)
  if (Number.isNaN(Date.parse(value)))
    throw new RequestError(400, `${name} must be an ISO date-time`)
  return value
}

function stringField(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim() === '')
    throw new RequestError(400, `${name} must be a non-empty string`)
  return input.trim()
}

function optionalTextField(input: unknown, name: string): string | undefined {
  if (input === undefined)
    return undefined
  const value = stringField(input, name)
  if (
    value.length > 128
    || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new RequestError(400, `${name} is too long or contains control characters`)
  }
  return value
}

function optionalAccountRefField(input: unknown): string | undefined {
  if (input === undefined)
    return undefined
  const value = stringField(input, 'accountRef')
  if (!/^\w[\w.:-]{0,127}$/u.test(value))
    throw new RequestError(400, 'accountRef must be an opaque account reference')
  return value
}

function positiveIntegerField(input: unknown, name: string): number {
  if (!Number.isInteger(input) || (input as number) < 1)
    throw new RequestError(400, `${name} must be a positive integer`)
  return input as number
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

function recordingArtifactContentType(path: string): string {
  const extension = extname(path).toLowerCase()
  return extension === '.png'
    ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.gif'
        ? 'image/gif'
        : extension === '.svg'
          ? 'image/svg+xml'
          : extension === '.webm'
            ? 'video/webm'
            : extension === '.mp4'
              ? 'video/mp4'
              : extension === '.mp3'
                ? 'audio/mpeg'
                : extension === '.wav'
                  ? 'audio/wav'
                  : extension === '.ogg' || extension === '.oga'
                    ? 'audio/ogg'
                    : extension === '.md' || extension === '.markdown'
                      ? 'text/markdown; charset=utf-8'
                      : extension === '.txt'
                        ? 'text/plain; charset=utf-8'
                        : extension === '.json'
                          ? 'application/json; charset=utf-8'
                          : 'application/octet-stream'
}

async function serveRegisteredPreview(
  response: ServerResponse,
  outputRoot: string,
  projectId: string,
  relativePath: string,
  sha256: string,
  version: number,
): Promise<void> {
  const safePath = await resolveRegisteredPreviewPath(outputRoot, projectId, relativePath)

  let content: Buffer
  try {
    content = await readFile(safePath)
  }
  catch {
    throw new RequestError(404, 'Registered preview file is unavailable')
  }
  response.setHeader('Cache-Control', 'private, max-age=60')
  response.setHeader('Content-Length', content.byteLength)
  response.setHeader('Content-Type', recordingArtifactContentType(safePath))
  response.setHeader('X-Content-Studio-Sha256', sha256)
  response.setHeader('X-Content-Studio-Version', String(version))
  response.writeHead(200)
  response.end(content)
}

async function createStorageCleanupPreview(
  outputRoot: string,
  projectView: ContentStudioProjectView,
): Promise<StorageCleanupPreview> {
  const recycleRoot = recycleRootForOutput(outputRoot)
  const recycledEntries = await listStorageRecycleEntries(
    recycleRoot,
    projectView.project.projectId,
  )
  const recycledByItemId = new Map(
    recycledEntries.map(entry => [entry.itemId, entry]),
  )
  const promotedArtifactIds = new Set(
    projectView.projectAssets
      .map(asset => asset.sourceArtifactId)
      .filter((artifactId): artifactId is string => artifactId !== undefined),
  )
  const candidates: Array<{
    id: string
    kind: StorageCleanupPreviewItem['kind']
    name: string
    reason: string
    retentionClass: StorageRetentionClass
    relativePath: string
    sha256: string
    scope: StorageCleanupPreviewItem['scope']
    status: Extract<StorageCleanupPreviewItemStatus, 'protected' | 'review'>
    version: number
  }> = [
    ...projectView.activityArtifacts
      .filter(artifact => !promotedArtifactIds.has(artifact.artifactId))
      .map(artifact => ({
        id: artifact.artifactId,
        kind: artifact.kind,
        name: fileNameFromRelativePath(artifact.relativePath),
        reason: '活动产物尚未晋升为项目素材，清理前需要用户确认。',
        retentionClass: classifyStorageRetention('activity-artifact', artifact.kind),
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
        scope: 'activity-artifact' as const,
        status: 'review' as const,
        version: artifact.version,
      })),
    ...projectView.projectAssets.map(asset => ({
      id: asset.assetId,
      kind: asset.kind,
      name: fileNameFromRelativePath(asset.relativePath),
      reason: '项目素材默认长期保留，不会进入自动清理。',
      retentionClass: classifyStorageRetention('project-asset', asset.kind),
      relativePath: asset.relativePath,
      sha256: asset.sha256,
      scope: 'project-asset' as const,
      status: 'protected' as const,
      version: asset.version,
    })),
  ]
  const items: StorageCleanupPreviewItem[] = await Promise.all(
    candidates.map(async (candidate) => {
      const inspection = await inspectRegisteredPreview(
        outputRoot,
        projectView.project.projectId,
        candidate.relativePath,
      )
      const recycledEntry = recycledByItemId.get(candidate.id)
      if (recycledEntry !== undefined) {
        return {
          ...candidate,
          reason: '文件已移入回收区，仍在恢复窗口内。',
          sizeBytes: recycledEntry.sizeBytes,
          status: 'recycled' as const,
        }
      }
      if (inspection.status === 'available') {
        const retention = evaluateStorageRetention({
          createdAt: inspection.modifiedAt!,
          now: new Date(),
          retentionClass: candidate.retentionClass,
        })
        return {
          ...candidate,
          reason: retention.retentionClass === 'long-lived-asset'
            ? retention.reason
            : `${candidate.reason} ${retention.reason}`,
          ...(retention.eligibleAfter === undefined
            ? {}
            : { retentionEligibleAfter: retention.eligibleAfter }),
          sizeBytes: inspection.sizeBytes,
          status: candidate.status,
        }
      }
      return {
        ...candidate,
        reason: inspection.status === 'unsafe'
          ? '登记路径越过了项目输出目录，已阻止读取。'
          : '登记文件不存在，当前没有可回收的文件。',
        status: inspection.status,
      }
    }),
  )
  const totals = items.reduce<StorageCleanupPreviewTotals>((summary, item) => {
    const sizeBytes = item.sizeBytes ?? 0
    summary.totalBytes += sizeBytes
    if (item.status === 'protected') {
      summary.protectedBytes += sizeBytes
      summary.protectedFiles += 1
    }
    if (item.status === 'review') {
      summary.reviewBytes += sizeBytes
      summary.reviewFiles += 1
    }
    if (item.status === 'recycled') {
      summary.recycledBytes += sizeBytes
      summary.recycledFiles += 1
    }
    if (item.status === 'missing' || item.status === 'unsafe')
      summary.missingFiles += 1
    return summary
  }, {
    files: items.length,
    missingFiles: 0,
    protectedBytes: 0,
    protectedFiles: 0,
    reviewBytes: 0,
    reviewFiles: 0,
    recycledBytes: 0,
    recycledFiles: 0,
    totalBytes: 0,
  })
  const previewId = createStorageCleanupPreviewId(
    projectView.project.projectId,
    items,
  )
  return {
    generatedAt: new Date().toISOString(),
    items,
    previewId,
    projectId: projectView.project.projectId,
    retentionPolicy: DEFAULT_STORAGE_RETENTION_POLICY,
    totals,
  }
}

async function confirmStorageCleanup(
  outputRoot: string,
  projectView: ContentStudioProjectView,
  input: StorageCleanupConfirmation,
): Promise<StorageCleanupResult> {
  const preview = await createStorageCleanupPreview(outputRoot, projectView)
  if (input.previewId !== preview.previewId) {
    throw new RequestError(
      409,
      '清理预览已经变化，请重新读取预览后再确认。',
    )
  }
  const selectedIds = new Set(input.itemIds)
  const selectedItems = preview.items.filter(item => selectedIds.has(item.id))
  if (selectedItems.length !== selectedIds.size)
    throw new RequestError(400, '清理确认包含当前预览中不存在的文件')

  const recycled: StorageRecycleEntry[] = []
  const skipped: StorageCleanupPreviewItem[] = []
  for (const item of selectedItems) {
    if (item.status !== 'review') {
      skipped.push(item)
      continue
    }
    try {
      recycled.push(await moveToRecycleBin({
        item,
        outputRoot,
        projectId: projectView.project.projectId,
        recycleRoot: recycleRootForOutput(outputRoot),
      }))
    }
    catch (error: unknown) {
      throw new RequestError(
        409,
        error instanceof Error ? error.message : '文件在确认前发生变化，请重新读取预览。',
      )
    }
  }
  return {
    previewId: preview.previewId,
    projectId: projectView.project.projectId,
    recycled,
    skipped,
  }
}

async function restoreStorageItem(
  outputRoot: string,
  projectId: string,
  recycleId: string,
): Promise<StorageRestoreResult> {
  const recycleRoot = recycleRootForOutput(outputRoot)
  const entries = await listStorageRecycleEntries(recycleRoot, projectId)
  if (!entries.some(entry => entry.recycleId === recycleId))
    throw new RecordNotFoundError('Recycle entry', recycleId)
  try {
    return {
      projectId,
      restored: await restoreFromRecycleBin({
        outputRoot,
        projectId,
        recycleId,
        recycleRoot,
      }),
    }
  }
  catch (error: unknown) {
    if (error instanceof RecordNotFoundError)
      throw error
    throw new RequestError(
      409,
      error instanceof Error ? error.message : '回收文件恢复失败，请重新读取回收区。',
    )
  }
}

function recycleRootForOutput(outputRoot: string): string {
  return resolve(outputRoot, '..', 'recycle')
}

function createStorageCleanupPreviewId(
  projectId: string,
  items: StorageCleanupPreviewItem[],
): string {
  const fingerprint = items
    .map(item => ({
      id: item.id,
      relativePath: item.relativePath,
      scope: item.scope,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes ?? null,
      status: item.status,
      retentionClass: item.retentionClass,
      retentionEligibleAfter: item.retentionEligibleAfter ?? null,
      version: item.version,
    }))
    .sort((left, right) => `${left.scope}:${left.id}`.localeCompare(`${right.scope}:${right.id}`))
  return createHash('sha256')
    .update(JSON.stringify({ items: fingerprint, projectId }))
    .digest('hex')
    .slice(0, 24)
}

async function inspectRegisteredPreview(
  outputRoot: string,
  projectId: string,
  relativePath: string,
): Promise<{
  modifiedAt?: string
  sizeBytes?: number
  status: 'available' | 'missing' | 'unsafe'
}> {
  let safePath: string
  try {
    safePath = await resolveRegisteredPreviewPath(outputRoot, projectId, relativePath)
  }
  catch (error: unknown) {
    return {
      status: error instanceof RequestError && error.status === 400
        ? 'unsafe'
        : 'missing',
    }
  }
  try {
    const fileStatus = await stat(safePath)
    return fileStatus.isFile()
      ? {
          modifiedAt: fileStatus.mtime.toISOString(),
          sizeBytes: fileStatus.size,
          status: 'available',
        }
      : { status: 'missing' }
  }
  catch {
    return { status: 'missing' }
  }
}

async function resolveRegisteredPreviewPath(
  outputRoot: string,
  projectId: string,
  relativePath: string,
): Promise<string> {
  const projectRoot = resolve(outputRoot, projectId)
  const candidatePath = resolve(projectRoot, relativePath)
  const candidateRelativePath = relative(projectRoot, candidatePath)
  if (
    candidateRelativePath === ''
    || candidateRelativePath.startsWith('..')
    || isAbsolute(candidateRelativePath)
  ) {
    throw new RequestError(400, 'Registered preview path is unsafe')
  }

  try {
    const [safeProjectRoot, safeCandidatePath] = await Promise.all([
      realpath(projectRoot),
      realpath(candidatePath),
    ])
    const safeRelativePath = relative(safeProjectRoot, safeCandidatePath)
    if (
      safeRelativePath === ''
      || safeRelativePath.startsWith('..')
      || isAbsolute(safeRelativePath)
    ) {
      throw new RequestError(400, 'Registered preview path is unsafe')
    }
    return safeCandidatePath
  }
  catch (error: unknown) {
    if (error instanceof RequestError)
      throw error
    throw new RequestError(404, 'Registered preview file is unavailable')
  }
}

function fileNameFromRelativePath(relativePath: string): string {
  return relativePath.split(/[\\/]/u).at(-1) ?? relativePath
}

function closeServer(
  server: Server,
  repository: ContentStudioRepository,
  taskStore: ExecutionTaskStore,
  worker: ProductionWorker,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const closeRepository = (): void => {
      closeApplication(repository, taskStore)
    }
    if (!server.listening) {
      void worker.stop().then(() => {
        closeRepository()
        resolve()
      }, reject)
      return
    }
    server.close((error) => {
      void worker.stop().then(() => {
        closeRepository()
        if (error === undefined)
          resolve()
        else
          reject(error)
      }, reject)
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
  worker: ProductionWorker
}
