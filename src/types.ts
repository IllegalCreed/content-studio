export type Locale = 'en' | 'zh-CN'

export type ChannelId
  = | 'bilibili'
    | 'bluesky'
    | 'dev'
    | 'douyin'
    | 'facebook'
    | 'github'
    | 'hacker-news'
    | 'jianshu'
    | 'juejin'
    | 'mastodon'
    | 'product-hunt'
    | 'reddit'
    | 'v2ex'
    | 'wechat'
    | 'weibo'
    | 'x'
    | 'xiaohongshu'
    | 'youtube'
    | 'zhihu'

export type DeliveryMode
  = | 'automatic-candidate'
    | 'content-only'
    | 'owner-assisted'

export type ContentFormat = 'article' | 'short-post' | 'video-metadata'

export type VideoFormat = 'landscape' | 'portrait' | 'square'

export type LocalizedText = Record<Locale, string>

export interface ProjectFact {
  id: string
  text: LocalizedText
}

export interface SemanticLocator {
  by: 'label' | 'role' | 'test-id' | 'text'
  value: string
  name?: string
}

export type CaptureStep
  = | {
    kind: 'capture'
    label: string
    durationMs?: number
  }
  | {
    kind: 'click'
    locator: SemanticLocator
    durationMs?: number
  }
  | {
    kind: 'fill'
    locator: SemanticLocator
    value: string
    durationMs?: number
  }
  | {
    kind: 'press'
    key: string
    durationMs?: number
  }
  | {
    kind: 'wait'
    durationMs: number
  }
  | {
    kind: 'wait-for'
    locator: SemanticLocator
    durationMs?: number
  }

export interface CaptureFlow {
  id: string
  title: LocalizedText
  startPath: string
  steps: CaptureStep[]
}

export interface ProjectManifest {
  schemaVersion: 1
  projectId: string
  name: string
  canonicalUrl: string
  repositoryUrl: string
  locales: Locale[]
  tagline: LocalizedText
  facts: ProjectFact[]
  captureFlows: CaptureFlow[]
}

export interface CampaignChannel {
  id: ChannelId
  locale: Locale
}

export interface CampaignVideo {
  flowIds: string[]
  format: VideoFormat
}

export interface CampaignSpec {
  schemaVersion: 1
  campaignId: string
  topic: LocalizedText
  goal: 'education' | 'feedback' | 'launch'
  targetUrl: string
  highlights: string[]
  tags: string[]
  channels: CampaignChannel[]
  video?: CampaignVideo
}

export type ProjectAccessMode = 'source-owned' | 'web-assisted'

export type ProjectCaptureMode = 'assisted' | 'deterministic'

export type ProjectRepeatability = 'conditional' | 'high' | 'low'

export interface ProjectRecord {
  captureMode: ProjectCaptureMode
  currentSnapshotId: string
  name: string
  projectId: string
  repeatability: ProjectRepeatability
  sourceAccess: ProjectAccessMode
}

export interface ProjectSnapshot {
  manifest: ProjectManifest
  projectId: string
  snapshotId: string
  version: number
}

export interface ContentStudioProjectView {
  activities: PublishingActivity[]
  channelContents: ChannelContent[]
  contentGroups: ContentGroup[]
  project: ProjectRecord
  projectAssets: ProjectAsset[]
  projectChannelBindings: ProjectChannelBinding[]
  snapshot: ProjectSnapshot
  tasks: ExecutionTask[]
  taskEvents: Record<string, ExecutionTaskEvent[]>
}

export interface ProjectChannelBinding {
  channel: ChannelId
  delivery: DeliveryMode
  enabled: boolean
  projectId: string
}

export type ActivityStatus
  = | 'active'
    | 'archived'
    | 'completed'
    | 'draft'
    | 'planned'

export interface PublishingActivity {
  activityId: string
  campaignId: string
  channels: CampaignChannel[]
  goal: CampaignSpec['goal']
  projectId: string
  projectSnapshotId: string
  status: ActivityStatus
  targetUrl: string
  topic: LocalizedText
  video?: CampaignVideo
  version: number
}

export type CreatePublishingActivityInput
  = Omit<PublishingActivity, 'version'>

export interface ActivityRevisionInput {
  activityId: string
  baseVersion: number
  projectId: string
  topic: LocalizedText
}

export interface ContentGroup {
  activityId: string
  contentGroupId: string
  coreMessage: string
  projectId: string
  title: string
  version: number
}

export type CreateContentGroupInput = Omit<ContentGroup, 'version'>

export type ChannelContentFormat = 'article' | 'video'

export interface ChannelContent {
  activityId: string
  body: string
  channel: ChannelId
  contentGroupId: string
  contentId: string
  format: ChannelContentFormat
  locale: Locale
  projectId: string
  title: string
  version: number
}

export type CreateChannelContentInput = Omit<ChannelContent, 'version'>

export interface CreateActivityContentPackInput {
  activityId: string
  contentGroupId: string
  contents: Array<Omit<ChannelContent, 'activityId' | 'contentGroupId' | 'projectId' | 'version'>>
  coreMessage: string
  projectId: string
  title: string
}

export interface ActivityContentPack {
  contentGroup: ContentGroup
  contents: ChannelContent[]
}

export type ActivityArtifactKind
  = | 'article-version'
    | 'audio'
    | 'image'
    | 'preview-frame'
    | 'video-clip'
    | 'video'

export interface ActivityArtifact {
  activityId: string
  artifactId: string
  kind: ActivityArtifactKind
  projectId: string
  relativePath: string
  sha256: string
  version: number
}

export type CreateActivityArtifactInput = Omit<ActivityArtifact, 'version'>

export type ProjectAssetKind
  = | 'audio'
    | 'font'
    | 'image'
    | 'logo'
    | 'template'
    | 'video'

export interface ProjectAsset {
  assetId: string
  kind: ProjectAssetKind
  projectId: string
  relativePath: string
  sourceArtifactId?: string
  sha256: string
  version: number
}

export interface PromoteActivityArtifactInput {
  artifactId: string
  assetId: string
  kind: ProjectAssetKind
  projectId: string
}

export interface PublicationPlan {
  activityId: string
  channel: ChannelId
  contentId: string
  projectId: string
  publicationId: string
}

export interface PublicationReceipt {
  activityId: string
  channel: ChannelId
  externalReceiptId: string
  projectId: string
  publicationId: string
  publicUrl?: string
  receiptId: string
  status: 'failed' | 'published'
}

export type OwnerHandoffStatus = 'cancelled' | 'completed' | 'expired' | 'pending'

export interface OwnerHandoff {
  activityId: string
  artifactChecksums: string[]
  channel: ChannelId
  checklist: string[]
  expiresAt: string
  handoffId: string
  officialTargetUrl: string
  projectId: string
  publicationId: string
  status: OwnerHandoffStatus
}

export type ObservationMetric
  = | 'clicks'
    | 'comments'
    | 'favorites'
    | 'likes'
    | 'reads'
    | 'replies'
    | 'shares'
    | 'views'

export type ObservationSource = 'authorized-adapter' | 'owner-entered' | 'public'

export interface MonitoringObservation {
  activityId: string
  channel: ChannelId
  collectedAt: string
  metrics: Partial<Record<ObservationMetric, number | null>>
  observationId: string
  projectId: string
  publicationId: string
  source: ObservationSource
}

export type ReportScope = 'activity' | 'project'

export interface ContentStudioReport {
  activityId?: string
  generatedAt: string
  metrics: Partial<Record<ObservationMetric, number | null>>
  observationIds: string[]
  projectId: string
  reportId: string
  scope: ReportScope
}

export interface ChannelBlueprint {
  delivery: DeliveryMode
  format: ContentFormat
  maxBodyLength: number
  maxTitleLength: number
}

export interface ContentPackage {
  body: string
  campaignId: string
  channel: ChannelId
  delivery: DeliveryMode
  format: ContentFormat
  locale: Locale
  tags: string[]
  targetUrl: string
  title: string
}

export type CompiledCaptureAction = CaptureStep & {
  durationMs: number
  startMs: number
}

export interface CompiledScene {
  actions: CompiledCaptureAction[]
  id: string
  startMs: number
  startPath: string
  title: string
}

export interface VideoPlan {
  campaignId: string
  durationMs: number
  format: VideoFormat
  scenes: CompiledScene[]
  viewport: {
    height: number
    width: number
  }
}

export interface StudioBundle {
  bundleVersion: 1
  campaignId: string
  contentPackages: ContentPackage[]
  projectId: string
  videoPlan: VideoPlan | null
}

export type CampaignJobStatus
  = | 'awaiting-owner'
    | 'cancelled'
    | 'composing'
    | 'failed'
    | 'generating'
    | 'monitoring'
    | 'published'
    | 'queued'
    | 'recording'

export interface CampaignJobState {
  attempt: number
  status: CampaignJobStatus
}

export interface CampaignJobTransitionOptions {
  hasPublicationReceipt?: boolean
}

export type ExecutionTaskKind = 'monitoring' | 'production' | 'publication'

export type ExecutionTaskStatus = CampaignJobStatus

export type ExecutionTaskSkipStage = 'generating' | 'recording'

export interface ExecutionTask {
  activityId: string
  attempt: number
  kind: ExecutionTaskKind
  projectId: string
  skipStages: ExecutionTaskSkipStage[]
  status: ExecutionTaskStatus
  taskId: string
}

export interface CreateExecutionTaskInput {
  activityId: string
  kind: ExecutionTaskKind
  projectId: string
  skipStages?: ExecutionTaskSkipStage[]
  taskId: string
}

export interface ExecutionTaskTransitionOptions {
  hasMatchingPublicationReceipt?: boolean
}

export type ExecutionTaskEventKind
  = | 'attempt-cancelled'
    | 'attempt-retried'
    | 'stage-skipped'
    | 'status-changed'
    | 'task-created'

export interface ExecutionTaskEvent {
  attempt: number
  eventId: string
  fromStatus?: ExecutionTaskStatus
  kind: ExecutionTaskEventKind
  message: string
  previousAttempt?: number
  projectId: string
  sequence: number
  stage?: ExecutionTaskStatus
  status: ExecutionTaskStatus
  taskId: string
  toStatus?: ExecutionTaskStatus
  schemaVersion: 1
}

export interface ExecutionTaskStoreState {
  events: ExecutionTaskEvent[]
  tasks: ExecutionTask[]
}

export interface ExecutionTaskStore {
  cancelTask: (projectId: string, taskId: string) => ExecutionTask
  createTask: (input: CreateExecutionTaskInput) => ExecutionTask
  getTask: (projectId: string, taskId: string) => ExecutionTask | undefined
  listEvents: (projectId: string, taskId: string) => ExecutionTaskEvent[]
  listTasks: (projectId?: string) => ExecutionTask[]
  retryTask: (projectId: string, taskId: string) => ExecutionTask
  skipStage: (
    projectId: string,
    taskId: string,
    stage: ExecutionTaskSkipStage,
  ) => ExecutionTask
  transitionTask: (
    projectId: string,
    taskId: string,
    nextStatus: ExecutionTaskStatus,
    options?: ExecutionTaskTransitionOptions,
  ) => ExecutionTask
}

export type RecorderFailureCode
  = | 'authentication-page'
    | 'cancelled'
    | 'cross-origin-navigation'
    | 'dialog-opened'
    | 'download-started'
    | 'locator-not-found'
    | 'locator-not-unique'
    | 'runtime-error'

export type RecorderArtifactKind
  = | 'diagnostic'
    | 'preview-frame'
    | 'video-clip'

export interface RecorderArtifact {
  id: string
  kind: RecorderArtifactKind
  relativePath: string
  sceneId?: string
  sha256: string
  sizeBytes: number
}

export interface RecorderLogSummary {
  consoleErrors: number
  consoleWarnings: number
  entries: string[]
  pageErrors: number
}

export interface RecorderFailure {
  code: RecorderFailureCode
  message: string
  retryable: boolean
}

export type RecorderOutcome = 'cancelled' | 'failed' | 'succeeded'

export interface RecorderAttemptReceipt {
  artifactDirectory: string
  artifacts: RecorderArtifact[]
  attempt: number
  campaignId: string
  completedActions: number
  completedScenes: number
  failure?: RecorderFailure
  jobId: string
  logs: RecorderLogSummary
  outcome: RecorderOutcome
  planSha256: string
  previousAttempt?: number
  projectId: string
  receiptVersion: 1
  totalActions: number
  totalScenes: number
}

export interface RecordingJobResult {
  attempts: RecorderAttemptReceipt[]
  receipt: RecorderAttemptReceipt
}

export type RecordingProgressEventKind
  = | 'action-completed'
    | 'action-started'
    | 'attempt-cancelled'
    | 'attempt-completed'
    | 'attempt-failed'
    | 'attempt-started'
    | 'preview-ready'
    | 'scene-completed'
    | 'scene-started'

export interface RecordingProgressEvent {
  artifact?: RecorderArtifact
  attempt: number
  jobId: string
  kind: RecordingProgressEventKind
  message: string
  progress: {
    completed: number
    total: number
  }
  schemaVersion: 1
  sequence: number
  stage: 'recording'
}

export interface RecordingJobInput {
  baseUrl: string
  jobId: string
  maxAttempts?: number
  outputDirectory: string
  plan: VideoPlan
  projectId: string
  signal?: AbortSignal
}

export interface RecordingAttemptContext {
  artifactDirectory: string
  attempt: number
  baseUrl: string
  jobId: string
  plan: VideoPlan
  projectId: string
  signal?: AbortSignal
}

export interface RecordingSceneContext {
  sceneIndex: number
  signal?: AbortSignal
}

export interface RecordingActionContext extends RecordingSceneContext {
  actionIndex: number
}

export interface RecordingActionResult {
  preview?: RecorderArtifact
}

export interface RecordingSessionSummary {
  artifacts: RecorderArtifact[]
  logs: RecorderLogSummary
}

export interface RecordingSession {
  beginScene: (
    scene: CompiledScene,
    context: RecordingSceneContext,
  ) => Promise<void>
  close: () => Promise<RecordingSessionSummary>
  endScene: (
    scene: CompiledScene,
    context: RecordingSceneContext,
  ) => Promise<void>
  runAction: (
    action: CompiledCaptureAction,
    context: RecordingActionContext,
  ) => Promise<RecordingActionResult>
}

export interface RecordingJobDependencies {
  createSession: (
    context: RecordingAttemptContext,
  ) => Promise<RecordingSession>
  emit?: (
    event: RecordingProgressEvent,
  ) => Promise<void> | void
  persistReceipt?: (
    receipt: RecorderAttemptReceipt,
  ) => Promise<void> | void
  prepareAttempt?: (
    context: RecordingAttemptContext,
  ) => Promise<void> | void
}

export interface PlaywrightRecordingOptions {
  actionTimeoutMs?: number
  emit?: (
    event: RecordingProgressEvent,
  ) => Promise<void> | void
  headless?: boolean
}

export interface ProjectPreviewContext {
  projectId: string
  signal?: AbortSignal
}

export interface ProjectPreviewHandle {
  baseUrl: string
  close: () => Promise<void>
}

export interface ProjectPreviewAdapter {
  adapterId: string
  open: (
    context: ProjectPreviewContext,
  ) => Promise<ProjectPreviewHandle>
}

export type ProjectRecordingJobInput = Omit<RecordingJobInput, 'baseUrl'>
