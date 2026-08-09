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

export type ContentFormat = 'article' | 'image-text' | 'short-post' | 'video-metadata'

export type ContentMediaKind = 'image' | 'video'

export interface ContentMediaRequirement {
  allowedKinds: readonly ContentMediaKind[]
  maxCount?: number
  minCount: number
}

export interface ChannelContentReadiness {
  artifactIds: string[]
  matchingArtifactIds: string[]
  missingMediaKinds: ContentMediaKind[]
  ready: boolean
  reason: string | null
  requirement: ContentMediaRequirement
}

export interface ContentFormBlueprint {
  format: ContentFormat
  maxBodyLength: number
  maxTitleLength: number
  media: ContentMediaRequirement
}

export type VideoFormat = 'landscape' | 'portrait' | 'square'

export type VideoColorScheme = 'dark' | 'light' | 'no-preference'

export interface VideoViewport {
  height: number
  width: number
}

export interface VideoRecordingConfigOverrides {
  colorScheme?: VideoColorScheme
  deviceScaleFactor?: number
  /**
   * Channel-variant orientation override. Only meaningful in channelVariants;
   * global defaults keep the activity video format.
   */
  format?: VideoFormat
  locale?: Locale
  outputSize?: VideoViewport
  viewport?: VideoViewport
}

export interface VideoRecordingProfile {
  channelVariants?: Partial<Record<ChannelId, VideoRecordingConfigOverrides>>
  defaults?: VideoRecordingConfigOverrides
}

export interface VideoRecordingConfig {
  colorScheme: VideoColorScheme
  deviceScaleFactor: number
  format?: VideoFormat
  locale: Locale
  outputSize: VideoViewport
  viewport: VideoViewport
}

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

export type ProjectCaptureTargetPurpose = 'control' | 'result' | 'state'

export interface ProjectCaptureTarget {
  id: string
  label: LocalizedText
  locator: SemanticLocator
  purpose: ProjectCaptureTargetPurpose
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

/**
 * The intentionally smaller action vocabulary available to a web-assisted
 * browser host. It excludes text entry and key presses so owner input cannot
 * become a replayable recording step.
 */
export type AssistedCaptureStep = Extract<
  CaptureStep,
  { kind: 'capture' | 'click' | 'wait' | 'wait-for' }
>

export interface AssistedPageObservation {
  observationId: string
  observedAt: string
  pageUrl: string
  title: string
}

/**
 * An AI/browser-host planning boundary for projects without source code.
 * Content Studio validates and records this shape, but does not execute it.
 */
export interface AssistedRecordingPlan {
  entryUrl: string
  observations: AssistedPageObservation[]
  planVersion: number
  projectId: string
  requiresOwner: true
  steps: AssistedCaptureStep[]
}

export interface CaptureFlow {
  id: string
  title: LocalizedText
  startPath: string
  steps: CaptureStep[]
}

export interface ProjectManifest {
  adapterId?: string
  schemaVersion: 1
  projectId: string
  name: string
  canonicalUrl: string
  repositoryUrl: string
  locales: Locale[]
  tagline: LocalizedText
  facts: ProjectFact[]
  captureFlows: CaptureFlow[]
  captureTargets?: ProjectCaptureTarget[]
  sourceAccess?: ProjectAccessMode
  captureMode?: ProjectCaptureMode
  repeatability?: ProjectRepeatability
  ownerTakeover?: boolean
  videoRecordingDefaults?: VideoRecordingConfigOverrides
}

export interface CampaignChannel {
  contentFormats?: ContentFormat[]
  id: ChannelId
  locale: Locale
}

export interface VideoOutlineScene {
  flowId: string
  objective: LocalizedText
  title: LocalizedText
}

export interface CampaignVideo {
  flowIds: string[]
  format: VideoFormat
  outline?: VideoOutlineScene[]
  planVersion?: number
  recordingProfile?: VideoRecordingProfile
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
  ownerTakeover?: boolean
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
  activityArtifacts: ActivityArtifact[]
  channelBlueprints: Readonly<Record<ChannelId, ChannelBlueprint>>
  channelContents: ChannelContent[]
  channelContentReadiness: Record<string, ChannelContentReadiness>
  compositionReceipts: CompositionAttemptReceipt[]
  contentGroups: ContentGroup[]
  monitoringObservations: MonitoringObservation[]
  ownerHandoffs: OwnerHandoff[]
  publicationPlans: PublicationPlan[]
  publicationReceipts: PublicationReceipt[]
  recordingReceipts: RecordingAttemptRecord[]
  project: ProjectRecord
  projectAssets: ProjectAsset[]
  projectChannelBindings: ProjectChannelBinding[]
  reports: ContentStudioReport[]
  snapshot: ProjectSnapshot
  tasks: ExecutionTask[]
  taskEvents: Record<string, ExecutionTaskEvent[]>
}

/**
 * Read-only summary used by the cross-project control surface.
 *
 * It is intentionally smaller than `ContentStudioProjectView`: account
 * references and project records stay scoped, while the global index can
 * show enough information to choose a project without loading its assets.
 */
export interface ContentStudioProjectIndexItem {
  activityCount: number
  enabledChannels: Array<{
    accountAlias?: string
    channel: ChannelId
    delivery: DeliveryMode
  }>
  previewReady: boolean
  project: ProjectRecord
  snapshotId: string
  snapshotVersion: number
  taskCount: number
  taskCounts: Record<ExecutionTaskKind, number>
}

export interface ContentStudioProjectIndex {
  projects: ContentStudioProjectIndexItem[]
}

/**
 * Safe, read-only project slice used by the cross-project control surface.
 *
 * Unlike `ContentStudioProjectView`, channel bindings deliberately omit the
 * opaque account reference. The global page needs the project account alias
 * to explain a task, but it must not broaden the scope of account handles.
 */
export interface ContentStudioGlobalProjectView {
  activities: PublishingActivity[]
  activityArtifacts: ActivityArtifact[]
  channelContents: ChannelContent[]
  channelContentReadiness: Record<string, ChannelContentReadiness>
  compositionReceipts: CompositionAttemptReceipt[]
  contentGroups: ContentGroup[]
  ownerHandoffs: OwnerHandoff[]
  project: ProjectRecord
  projectAssets: ProjectAsset[]
  projectChannelBindings: Array<Omit<ProjectChannelBinding, 'accountRef'>>
  recordingReceipts: RecordingAttemptRecord[]
  snapshot: ProjectSnapshot
  taskEvents: Record<string, ExecutionTaskEvent[]>
  tasks: ExecutionTask[]
}

export interface ContentStudioGlobalView {
  projectViews: ContentStudioGlobalProjectView[]
  projects: ContentStudioProjectIndexItem[]
}

export interface ProjectChannelBinding {
  accountAlias?: string
  accountRef?: string
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
  videoPlanReviewStatus?: VideoPlanReviewStatus
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
  video?: CampaignVideo
}

export interface ConfirmActivityVideoPlanInput {
  activityId: string
  baseVersion: number
  projectId: string
}

export type VideoPlanReviewStatus = 'confirmed' | 'pending'

export interface ContentGroup {
  activityId: string
  contentGroupId: string
  coreMessage: string
  projectId: string
  title: string
  version: number
}

export type CreateContentGroupInput = Omit<ContentGroup, 'version'>

export type ChannelContentFormat = 'article' | 'image-text' | 'short-post' | 'video'

export interface ChannelContent {
  activityId: string
  /**
   * 本渠道内容引用的活动素材 ID。素材(ActivityArtifact)按 sha256 不可变,
   * 多个渠道内容可以引用同一素材;引用只记录本活动内的素材,不跨项目、不跨活动。
   */
  artifactIds: string[]
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

export type ChannelContentMediaRevisionMode = 'append' | 'replace'

export interface ChannelContentMediaRevisionInput {
  artifactIds: string[]
  baseVersion: number
  contentId: string
  mode: ChannelContentMediaRevisionMode
  projectId: string
}

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

export type StorageRetentionClass
  = | 'activity-artifact'
    | 'long-lived-asset'
    | 'rebuildable-cache'

export interface StorageRetentionPolicy {
  activityArtifactDays: number
  rebuildableCacheDays: number
  recycleRecoveryDays: number
}

export type StorageCleanupPreviewItemStatus
  = | 'missing'
    | 'protected'
    | 'recycled'
    | 'review'
    | 'unsafe'

export interface StorageCleanupPreviewItem {
  id: string
  kind: ActivityArtifactKind | ProjectAssetKind
  name: string
  reason: string
  retentionClass: StorageRetentionClass
  retentionEligibleAfter?: string
  relativePath: string
  sha256: string
  scope: 'activity-artifact' | 'project-asset'
  sizeBytes?: number
  status: StorageCleanupPreviewItemStatus
  version: number
}

export interface StorageCleanupPreviewTotals {
  files: number
  missingFiles: number
  protectedBytes: number
  protectedFiles: number
  reviewBytes: number
  reviewFiles: number
  recycledBytes: number
  recycledFiles: number
  totalBytes: number
}

export interface StorageCleanupPreview {
  generatedAt: string
  items: StorageCleanupPreviewItem[]
  previewId: string
  projectId: string
  retentionPolicy: StorageRetentionPolicy
  totals: StorageCleanupPreviewTotals
}

export interface StorageCleanupConfirmation {
  itemIds: string[]
  previewId: string
  projectId: string
}

export interface StorageRecycleEntry {
  expiresAt: string
  itemId: string
  kind: ActivityArtifactKind | ProjectAssetKind
  originalRelativePath: string
  projectId: string
  recycleId: string
  recycledAt: string
  recycledRelativePath: string
  retentionClass?: StorageRetentionClass
  scope: 'activity-artifact' | 'project-asset'
  sha256: string
  sizeBytes: number
  version: number
}

export interface StorageCleanupResult {
  previewId: string
  projectId: string
  recycled: StorageRecycleEntry[]
  skipped: StorageCleanupPreviewItem[]
}

export interface StorageRestoreResult {
  projectId: string
  restored: StorageRecycleEntry
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
  source?: 'marketing-ops'
  status: 'failed' | 'published'
  accountRef?: string
  issuedAt?: string
}

export interface MarketingOpsPublicationRequest {
  accountRef?: string
  activityId: string
  channel: ChannelId
  contentSha256?: string
  projectId: string
  publicationId: string
}

export interface MarketingOpsPublicationReceipt extends PublicationReceipt {
  issuedAt: string
  source: 'marketing-ops'
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
  contentForms: readonly ContentFormBlueprint[]
  delivery: DeliveryMode
  format: ContentFormat
  maxBodyLength: number
  maxTitleLength: number
  supportedFormats: readonly ContentFormat[]
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
  outline?: VideoOutlineScene[]
  planVersion?: number
  reviewStatus?: VideoPlanReviewStatus
  recordingConfig: VideoRecordingConfig
  scenes: CompiledScene[]
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
    | 'completed'
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

export type ProductionTaskType = 'article' | 'video'

export type ExecutionTaskStatus = CampaignJobStatus

export type ExecutionTaskSkipStage = 'generating' | 'recording'

export interface ExecutionTask {
  activityId: string
  attempt: number
  channel?: ChannelId
  contentId?: string
  kind: ExecutionTaskKind
  productionType?: ProductionTaskType
  projectId: string
  createdAt?: string
  skipStages: ExecutionTaskSkipStage[]
  status: ExecutionTaskStatus
  taskId: string
  updatedAt?: string
}

export interface CreateExecutionTaskInput {
  activityId: string
  kind: ExecutionTaskKind
  channel?: ChannelId
  contentId?: string
  productionType?: ProductionTaskType
  projectId: string
  skipStages?: ExecutionTaskSkipStage[]
  taskId: string
}

export interface ExecutionTaskTransitionOptions {
  hasMatchingOwnerHandoff?: boolean
  hasMatchingPublicationReceipt?: boolean
}

export type ExecutionTaskEventKind
  = | 'attempt-cancelled'
    | 'attempt-retried'
    | 'composition-cancelled'
    | 'composition-completed'
    | 'composition-cover-ready'
    | 'composition-failed'
    | 'composition-gif-ready'
    | 'composition-started'
    | 'composition-video-ready'
    | 'stage-skipped'
    | 'status-changed'
    | 'task-created'

export interface ExecutionTaskEvent {
  attempt: number
  artifact?: CompositionArtifact
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
  compositionReceipts: CompositionAttemptReceipt[]
  events: ExecutionTaskEvent[]
  recordingReceipts: RecorderAttemptReceipt[]
  tasks: ExecutionTask[]
}

export interface ExecutionTaskStore {
  cancelTask: (projectId: string, taskId: string) => ExecutionTask
  createTask: (input: CreateExecutionTaskInput) => ExecutionTask
  getTask: (projectId: string, taskId: string) => ExecutionTask | undefined
  listCompositionReceipts: (projectId: string, taskId: string) => CompositionAttemptReceipt[]
  listEvents: (projectId: string, taskId: string) => ExecutionTaskEvent[]
  listRecordingReceipts: (projectId: string, taskId: string) => RecorderAttemptReceipt[]
  listTasks: (projectId?: string) => ExecutionTask[]
  saveCompositionReceipt: (
    projectId: string,
    taskId: string,
    receipt: CompositionAttemptReceipt,
  ) => CompositionAttemptReceipt
  saveRecordingReceipt: (
    projectId: string,
    taskId: string,
    receipt: RecorderAttemptReceipt,
  ) => RecorderAttemptReceipt
  appendCompositionEvent: (
    projectId: string,
    taskId: string,
    input: CompositionTaskEventInput,
  ) => ExecutionTaskEvent
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
  = | 'assisted-mode-unsupported'
    | 'authentication-page'
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

export interface OwnerTakeoverRequest {
  jobId: string
  pageUrl: string
  projectId: string
}

/**
 * The confirmation boundary for an owner takeover. The controller only
 * signals when the owner is ready; it never carries or replays manual input.
 */
export interface OwnerTakeoverController {
  request: (request: OwnerTakeoverRequest) => Promise<void>
}

/**
 * Timestamp record for an owner takeover window. Deliberately contains no
 * input, credentials, or page content.
 */
export interface OwnerTakeoverRecord {
  confirmedAt: string
  requestedAt: string
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
  ownerTakeover?: OwnerTakeoverRecord
  outcome: RecorderOutcome
  planSha256: string
  previousAttempt?: number
  projectId: string
  recordingContext?: RecordingContext
  recordingConfig: VideoRecordingConfig
  receiptVersion: 1
  totalActions: number
  totalScenes: number
}

/**
 * Safe project-view representation of a recorder receipt. The local absolute
 * artifact directory never crosses the runtime boundary.
 */
export type RecordingAttemptRecord = Omit<RecorderAttemptReceipt, 'artifactDirectory'>

export type CompositionArtifactKind = 'cover' | 'gif' | 'video'

export interface CompositionArtifact {
  artifactId: string
  durationSeconds?: number
  fps?: number
  height?: number
  kind: CompositionArtifactKind
  relativePath?: string
  sha256: string
  sizeBytes: number
  width?: number
}

export type CompositionOutcome = 'cancelled' | 'failed' | 'succeeded'

export interface CompositionFailure {
  code: 'cancelled' | 'runtime-error'
  message: string
  retryable: boolean
}

export interface CompositionAttemptReceipt {
  artifacts: CompositionArtifact[]
  attempt: number
  failure?: CompositionFailure
  jobId: string
  outcome: CompositionOutcome
  projectId: string
  receiptVersion: 1
}

export type CompositionTaskEventKind
  = | 'composition-cancelled'
    | 'composition-completed'
    | 'composition-cover-ready'
    | 'composition-failed'
    | 'composition-gif-ready'
    | 'composition-started'
    | 'composition-video-ready'

export interface CompositionTaskEventInput {
  artifact?: CompositionArtifact
  kind: CompositionTaskEventKind
  message: string
}

export interface RecordingContext {
  captureMode: ProjectCaptureMode
  humanIntervention: boolean
  ownerTakeover?: boolean
  planVersion: number
  repeatability: ProjectRepeatability
  sourceAccess: ProjectAccessMode
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
  initialAttempt?: number
  jobId: string
  maxAttempts?: number
  outputDirectory: string
  plan: VideoPlan
  projectId: string
  recordingContext?: RecordingContext
  signal?: AbortSignal
}

export interface RecordingAttemptContext {
  artifactDirectory: string
  attempt: number
  baseUrl: string
  jobId: string
  plan: VideoPlan
  projectId: string
  recordingContext?: RecordingContext
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
  ownerTakeover?: OwnerTakeoverRecord
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

export interface ComposeProductionInput {
  clipPaths: string[]
  cover?: ProductionCoverSpec
  emit?: (event: CompositionProgressEvent) => Promise<void> | void
  gif?: ProductionGifSpec
  normalizeLoudness?: boolean
  outputPath: string
  outputSize?: VideoViewport
  signal?: AbortSignal
  transitionDurationMs?: number
}

export interface ComposeProductionResult extends ProductionVideoResult {
  cover?: ProductionCoverResult
  gif?: ProductionGifResult
}

export interface ProductionVideoResult {
  artifactPath: string
  durationSeconds: number
  reencoded: boolean
  sha256: string
  sizeBytes: number
}

export interface ProductionCoverSpec {
  outputPath: string
  subtitle?: string
  title: string
}

export interface ProductionCoverResult {
  artifactPath: string
  height: number
  sha256: string
  sizeBytes: number
  width: number
}

export interface ProductionGifSpec {
  durationSeconds?: number
  fps?: number
  outputPath: string
  outputSize?: VideoViewport
  startSeconds?: number
}

export interface ProductionGifResult {
  artifactPath: string
  durationSeconds: number
  fps: number
  height: number
  sha256: string
  sizeBytes: number
  width: number
}

export type CompositionProgressEvent
  = | { artifact: ProductionVideoResult, kind: 'video-ready' }
    | { artifact: ProductionCoverResult, kind: 'cover-ready' }
    | { artifact: ProductionGifResult, kind: 'gif-ready' }

export type ComposeProduction = (
  input: ComposeProductionInput,
) => Promise<ComposeProductionResult>

export interface PlaywrightRecordingOptions {
  actionTimeoutMs?: number
  emit?: (
    event: RecordingProgressEvent,
  ) => Promise<void> | void
  headless?: boolean
  ownerTakeover?: OwnerTakeoverController
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
