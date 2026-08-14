import type {
  ProductionTaskDependencies,
  ProductionTaskInput,
  ProductionTaskResult,
} from '../jobs/production'
import type {
  ActivityArtifact,
  ActivityContentPack,
  ActivityRevisionInput,
  BilibiliVideoExportResult,
  ChannelContent,
  ChannelContentFormat,
  ChannelContentMediaRevisionInput,
  ChannelContentReadiness,
  ChannelId,
  ComposeProduction,
  ComposeProductionResult,
  CompositionArtifact,
  CompositionAttemptReceipt,
  CompositionProgressEvent,
  CompositionTaskEventKind,
  ConfirmActivityVideoPlanInput,
  ContentFormat,
  ContentGroup,
  ContentStudioGlobalProjectView,
  ContentStudioGlobalView,
  ContentStudioProjectIndexItem,
  ContentStudioProjectView,
  ContentStudioReport,
  CreateActivityArtifactInput,
  CreateActivityContentPackInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskKind,
  ExecutionTaskStore,
  Locale,
  MarketingOpsPublicationConfirmationState,
  MarketingOpsPublicationPackage,
  MarketingOpsPublicationPackagePreparation,
  MonitoringObservation,
  OwnerHandoff,
  PrepareMarketingOpsPublicationPackageInput,
  ProjectAsset,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  PromoteActivityArtifactInput,
  PublicationPlan,
  PublicationReceipt,
  PublishingActivity,
  RecorderArtifact,
  RecorderAttemptReceipt,
  RecordingAttemptRecord,
  VideoPlan,
  VideoViewport,
} from '../types'
import { createHash } from 'node:crypto'
import { join, relative, resolve } from 'node:path'
import {
  CHANNEL_BLUEPRINTS,
  selectedContentFormatsForChannel,
} from '../constants'
import {
  assessChannelContentReadiness,
  assessChannelContentsReadiness,
} from '../content/readiness'
import { runProductionTask as executeProductionTask } from '../jobs/production'
import { InMemoryExecutionTaskStore } from '../jobs/task'
import { assertMatchingMarketingOpsReceipt } from '../marketing-ops/client'
import { compileMarketingOpsPublicationPackage } from '../marketing-ops/package'
import { resolveGifOutputSize } from '../media/gif'
import { compileVideoPlan } from '../video/compile'
import {
  resolveVideoFormatForChannel,
  validateVideoRecordingProfile,
} from '../video/recording-config'

export class ProjectScopeError extends Error {
  constructor(projectId: string, recordId: string) {
    super(`Record ${recordId} is not available in project ${projectId}`)
    this.name = 'ProjectScopeError'
  }
}

export class RecordConflictError extends Error {
  constructor(recordId: string, version: number) {
    super(`Record ${recordId} version ${version} already exists`)
    this.name = 'RecordConflictError'
  }
}

export class RecordNotFoundError extends Error {
  constructor(recordType: string, recordId: string) {
    super(`${recordType} ${recordId} was not found`)
    this.name = 'RecordNotFoundError'
  }
}

const MARKETING_OPS_OWNER_HANDOFF_TARGETS: Partial<Record<ChannelId, string>> = {
  bilibili: 'https://member.bilibili.com/',
  youtube: 'https://studio.youtube.com/',
}

const MARKETING_OPS_OWNER_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000

export interface ContentStudioRepository {
  saveActivity: (activity: PublishingActivity) => PublishingActivity
  saveActivityArtifact: (artifact: ActivityArtifact) => ActivityArtifact
  saveChannelContent: (content: ChannelContent) => ChannelContent
  saveContentGroup: (group: ContentGroup) => ContentGroup
  saveProject: (project: ProjectRecord) => ProjectRecord
  updateProject: (project: ProjectRecord) => ProjectRecord
  saveProjectAsset: (asset: ProjectAsset) => ProjectAsset
  saveProjectChannelBinding: (
    binding: ProjectChannelBinding,
  ) => ProjectChannelBinding
  updateProjectChannelBinding: (
    binding: ProjectChannelBinding,
  ) => ProjectChannelBinding
  setProjectChannelBinding: (
    binding: ProjectChannelBinding,
  ) => ProjectChannelBinding
  saveProjectSnapshot: (snapshot: ProjectSnapshot) => ProjectSnapshot
  saveOwnerHandoff: (handoff: OwnerHandoff) => OwnerHandoff
  updateOwnerHandoff: (handoff: OwnerHandoff) => OwnerHandoff
  savePublicationPlan: (plan: PublicationPlan) => PublicationPlan
  savePublicationReceipt: (receipt: PublicationReceipt) => PublicationReceipt
  saveMonitoringObservation: (
    observation: MonitoringObservation,
  ) => MonitoringObservation
  saveReport: (report: ContentStudioReport) => ContentStudioReport
  getActivity: (
    projectId: string,
    activityId: string,
    version?: number,
  ) => PublishingActivity | undefined
  getActivityArtifact: (
    projectId: string,
    artifactId: string,
    version?: number,
  ) => ActivityArtifact | undefined
  getChannelContent: (
    projectId: string,
    contentId: string,
    version?: number,
  ) => ChannelContent | undefined
  getContentGroup: (
    projectId: string,
    contentGroupId: string,
    version?: number,
  ) => ContentGroup | undefined
  getProject: (projectId: string) => ProjectRecord | undefined
  listProjects: () => ProjectRecord[]
  getProjectAsset: (
    projectId: string,
    assetId: string,
    version?: number,
  ) => ProjectAsset | undefined
  getProjectSnapshot: (
    projectId: string,
    snapshotId: string,
    version?: number,
  ) => ProjectSnapshot | undefined
  getOwnerHandoff: (
    projectId: string,
    handoffId: string,
  ) => OwnerHandoff | undefined
  getPublicationPlan: (
    projectId: string,
    publicationId: string,
  ) => PublicationPlan | undefined
  getPublicationReceipt: (
    projectId: string,
    receiptId: string,
  ) => PublicationReceipt | undefined
  getPublicationReceiptForPublication: (
    projectId: string,
    publicationId: string,
  ) => PublicationReceipt | undefined
  getMonitoringObservation: (
    projectId: string,
    observationId: string,
  ) => MonitoringObservation | undefined
  getReport: (projectId: string, reportId: string) => ContentStudioReport | undefined
  listActivityArtifacts: (projectId: string, activityId: string) => ActivityArtifact[]
  listChannelContents: (projectId: string) => ChannelContent[]
  listContentGroups: (projectId: string) => ContentGroup[]
  listOwnerHandoffs: (projectId: string) => OwnerHandoff[]
  listPublicationPlans: (projectId: string) => PublicationPlan[]
  listPublicationReceipts: (projectId: string) => PublicationReceipt[]
  listMonitoringObservations: (projectId: string) => MonitoringObservation[]
  listProjectAssets: (projectId: string) => ProjectAsset[]
  listProjectChannelBindings: (projectId: string) => ProjectChannelBinding[]
  listActivities: (projectId: string) => PublishingActivity[]
  listReports: (projectId: string) => ContentStudioReport[]
}

export class InMemoryContentStudioRepository
implements ContentStudioRepository {
  private readonly activities = new Map<string, PublishingActivity>()
  private readonly activityArtifacts = new Map<string, ActivityArtifact>()
  private readonly channelContents = new Map<string, ChannelContent>()
  private readonly contentGroups = new Map<string, ContentGroup>()
  private readonly projects = new Map<string, ProjectRecord>()
  private readonly projectAssets = new Map<string, ProjectAsset>()
  private readonly projectChannelBindings = new Map<
    string,
    ProjectChannelBinding
  >()

  private readonly projectSnapshots = new Map<string, ProjectSnapshot>()
  private readonly ownerHandoffs = new Map<string, OwnerHandoff>()
  private readonly publicationPlans = new Map<string, PublicationPlan>()
  private readonly publicationReceipts = new Map<string, PublicationReceipt>()
  private readonly monitoringObservations = new Map<string, MonitoringObservation>()
  private readonly reports = new Map<string, ContentStudioReport>()

  saveProject(project: ProjectRecord): ProjectRecord {
    if (this.projects.has(project.projectId))
      throw new RecordConflictError(project.projectId, 1)
    this.projects.set(project.projectId, clone(project))
    return clone(project)
  }

  updateProject(project: ProjectRecord): ProjectRecord {
    if (!this.projects.has(project.projectId))
      throw new RecordNotFoundError('Project', project.projectId)
    this.projects.set(project.projectId, clone(project))
    return clone(project)
  }

  saveProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
    const key = versionKey(snapshot.snapshotId, snapshot.version)
    if (this.projectSnapshots.has(key))
      throw new RecordConflictError(snapshot.snapshotId, snapshot.version)
    this.projectSnapshots.set(key, clone(snapshot))
    return clone(snapshot)
  }

  saveProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    const key = `${binding.projectId}:${binding.channel}`
    if (this.projectChannelBindings.has(key))
      throw new RecordConflictError(key, 1)
    this.projectChannelBindings.set(key, clone(binding))
    return clone(binding)
  }

  updateProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    const key = `${binding.projectId}:${binding.channel}`
    if (!this.projectChannelBindings.has(key))
      throw new RecordNotFoundError('ProjectChannelBinding', key)
    this.projectChannelBindings.set(key, clone(binding))
    return clone(binding)
  }

  setProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    const key = `${binding.projectId}:${binding.channel}`
    this.projectChannelBindings.set(key, clone(binding))
    return clone(binding)
  }

  saveActivity(activity: PublishingActivity): PublishingActivity {
    return this.saveVersioned(
      this.activities,
      activity.activityId,
      activity.version,
      activity,
    )
  }

  saveContentGroup(group: ContentGroup): ContentGroup {
    return this.saveVersioned(
      this.contentGroups,
      group.contentGroupId,
      group.version,
      group,
    )
  }

  saveChannelContent(content: ChannelContent): ChannelContent {
    return this.saveVersioned(
      this.channelContents,
      content.contentId,
      content.version,
      content,
    )
  }

  saveActivityArtifact(artifact: ActivityArtifact): ActivityArtifact {
    return this.saveVersioned(
      this.activityArtifacts,
      artifact.artifactId,
      artifact.version,
      artifact,
    )
  }

  saveProjectAsset(asset: ProjectAsset): ProjectAsset {
    return this.saveVersioned(
      this.projectAssets,
      asset.assetId,
      asset.version,
      asset,
    )
  }

  savePublicationPlan(plan: PublicationPlan): PublicationPlan {
    if (this.publicationPlans.has(plan.publicationId))
      throw new RecordConflictError(plan.publicationId, 1)
    this.publicationPlans.set(plan.publicationId, clone(plan))
    return clone(plan)
  }

  savePublicationReceipt(receipt: PublicationReceipt): PublicationReceipt {
    if (this.publicationReceipts.has(receipt.receiptId))
      throw new RecordConflictError(receipt.receiptId, 1)
    this.publicationReceipts.set(receipt.receiptId, clone(receipt))
    return clone(receipt)
  }

  saveOwnerHandoff(handoff: OwnerHandoff): OwnerHandoff {
    if (this.ownerHandoffs.has(handoff.handoffId))
      throw new RecordConflictError(handoff.handoffId, 1)
    this.ownerHandoffs.set(handoff.handoffId, clone(handoff))
    return clone(handoff)
  }

  updateOwnerHandoff(handoff: OwnerHandoff): OwnerHandoff {
    if (!this.ownerHandoffs.has(handoff.handoffId))
      throw new RecordNotFoundError('OwnerHandoff', handoff.handoffId)
    this.ownerHandoffs.set(handoff.handoffId, clone(handoff))
    return clone(handoff)
  }

  saveMonitoringObservation(
    observation: MonitoringObservation,
  ): MonitoringObservation {
    if (this.monitoringObservations.has(observation.observationId))
      throw new RecordConflictError(observation.observationId, 1)
    this.monitoringObservations.set(observation.observationId, clone(observation))
    return clone(observation)
  }

  saveReport(report: ContentStudioReport): ContentStudioReport {
    if (this.reports.has(report.reportId))
      throw new RecordConflictError(report.reportId, 1)
    this.reports.set(report.reportId, clone(report))
    return clone(report)
  }

  getProject(projectId: string): ProjectRecord | undefined {
    return cloneOrUndefined(this.projects.get(projectId))
  }

  listProjects(): ProjectRecord[] {
    return [...this.projects.values()]
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
      .map(clone)
  }

  getProjectSnapshot(
    projectId: string,
    snapshotId: string,
    version?: number,
  ): ProjectSnapshot | undefined {
    return this.getVersioned(
      this.projectSnapshots,
      projectId,
      snapshotId,
      version,
      snapshot => snapshot.snapshotId,
    )
  }

  getOwnerHandoff(
    projectId: string,
    handoffId: string,
  ): OwnerHandoff | undefined {
    return getScopedRecord(this.ownerHandoffs, projectId, handoffId)
  }

  getActivity(
    projectId: string,
    activityId: string,
    version?: number,
  ): PublishingActivity | undefined {
    return this.getVersioned(
      this.activities,
      projectId,
      activityId,
      version,
      activity => activity.activityId,
    )
  }

  getContentGroup(
    projectId: string,
    contentGroupId: string,
    version?: number,
  ): ContentGroup | undefined {
    return this.getVersioned(
      this.contentGroups,
      projectId,
      contentGroupId,
      version,
      group => group.contentGroupId,
    )
  }

  getChannelContent(
    projectId: string,
    contentId: string,
    version?: number,
  ): ChannelContent | undefined {
    return this.getVersioned(
      this.channelContents,
      projectId,
      contentId,
      version,
      content => content.contentId,
    )
  }

  getActivityArtifact(
    projectId: string,
    artifactId: string,
    version?: number,
  ): ActivityArtifact | undefined {
    return this.getVersioned(
      this.activityArtifacts,
      projectId,
      artifactId,
      version,
      artifact => artifact.artifactId,
    )
  }

  getProjectAsset(
    projectId: string,
    assetId: string,
    version?: number,
  ): ProjectAsset | undefined {
    return this.getVersioned(
      this.projectAssets,
      projectId,
      assetId,
      version,
      asset => asset.assetId,
    )
  }

  listProjectChannelBindings(projectId: string): ProjectChannelBinding[] {
    return [...this.projectChannelBindings.values()]
      .filter(binding => binding.projectId === projectId)
      .map(binding => clone(binding))
  }

  listActivities(projectId: string): PublishingActivity[] {
    return [...this.activities.values()]
      .filter(activity => activity.projectId === projectId)
      .sort((left, right) => left.version - right.version)
      .map(activity => clone(activity))
  }

  listActivityArtifacts(
    projectId: string,
    activityId: string,
  ): ActivityArtifact[] {
    return [...this.activityArtifacts.values()]
      .filter(artifact =>
        artifact.projectId === projectId
        && artifact.activityId === activityId,
      )
      .sort((left, right) => left.version - right.version)
      .map(artifact => clone(artifact))
  }

  listContentGroups(projectId: string): ContentGroup[] {
    return [...this.contentGroups.values()]
      .filter(group => group.projectId === projectId)
      .sort((left, right) => left.version - right.version)
      .map(group => clone(group))
  }

  listOwnerHandoffs(projectId: string): OwnerHandoff[] {
    return [...this.ownerHandoffs.values()]
      .filter(handoff => handoff.projectId === projectId)
      .sort((left, right) => left.handoffId.localeCompare(right.handoffId))
      .map(clone)
  }

  listPublicationPlans(projectId: string): PublicationPlan[] {
    return [...this.publicationPlans.values()]
      .filter(plan => plan.projectId === projectId)
      .sort((left, right) => left.publicationId.localeCompare(right.publicationId))
      .map(clone)
  }

  listPublicationReceipts(projectId: string): PublicationReceipt[] {
    return [...this.publicationReceipts.values()]
      .filter(receipt => receipt.projectId === projectId)
      .sort((left, right) => left.receiptId.localeCompare(right.receiptId))
      .map(clone)
  }

  listMonitoringObservations(projectId: string): MonitoringObservation[] {
    return [...this.monitoringObservations.values()]
      .filter(observation => observation.projectId === projectId)
      .sort((left, right) => left.observationId.localeCompare(right.observationId))
      .map(clone)
  }

  listReports(projectId: string): ContentStudioReport[] {
    return [...this.reports.values()]
      .filter(report => report.projectId === projectId)
      .sort((left, right) => left.reportId.localeCompare(right.reportId))
      .map(clone)
  }

  listChannelContents(projectId: string): ChannelContent[] {
    return [...this.channelContents.values()]
      .filter(content => content.projectId === projectId)
      .sort((left, right) => left.version - right.version)
      .map(content => clone(content))
  }

  listProjectAssets(projectId: string): ProjectAsset[] {
    return [...this.projectAssets.values()]
      .filter(asset => asset.projectId === projectId)
      .sort((left, right) => left.version - right.version)
      .map(asset => clone(asset))
  }

  getPublicationPlan(
    projectId: string,
    publicationId: string,
  ): PublicationPlan | undefined {
    return getScopedRecord(
      this.publicationPlans,
      projectId,
      publicationId,
    )
  }

  getPublicationReceipt(
    projectId: string,
    receiptId: string,
  ): PublicationReceipt | undefined {
    return getScopedRecord(
      this.publicationReceipts,
      projectId,
      receiptId,
    )
  }

  getPublicationReceiptForPublication(
    projectId: string,
    publicationId: string,
  ): PublicationReceipt | undefined {
    const receipts = [...this.publicationReceipts.values()]
      .filter(candidate =>
        candidate.projectId === projectId
        && candidate.publicationId === publicationId,
      )
    const receipt = receipts.find(candidate => candidate.status === 'published')
      ?? receipts[0]
    return cloneOrUndefined(receipt)
  }

  getMonitoringObservation(
    projectId: string,
    observationId: string,
  ): MonitoringObservation | undefined {
    return getScopedRecord(
      this.monitoringObservations,
      projectId,
      observationId,
    )
  }

  getReport(
    projectId: string,
    reportId: string,
  ): ContentStudioReport | undefined {
    return getScopedRecord(this.reports, projectId, reportId)
  }

  private saveVersioned<T extends { projectId: string, version: number }>(
    records: Map<string, T>,
    recordId: string,
    version: number,
    value: T,
  ): T {
    const key = versionKey(recordId, version)
    if (records.has(key))
      throw new RecordConflictError(recordId, version)
    records.set(key, clone(value))
    return clone(value)
  }

  private getVersioned<T extends { projectId: string, version: number }>(
    records: Map<string, T>,
    projectId: string,
    recordId: string,
    version: number | undefined,
    getId: (record: T) => string,
  ): T | undefined {
    const matches = [...records.values()]
      .filter(record => getId(record) === recordId)
    const match = version === undefined
      ? matches.sort((left, right) => right.version - left.version)[0]
      : matches.find(record => record.version === version)
    if (match === undefined)
      return undefined
    if (match.projectId !== projectId)
      throw new ProjectScopeError(projectId, recordId)
    return clone(match)
  }
}

export class ContentStudioApplicationService {
  constructor(
    private readonly repository: ContentStudioRepository,
    private readonly taskStore: ExecutionTaskStore = new InMemoryExecutionTaskStore(),
  ) {}

  getProjectView(projectId: string): ContentStudioProjectView {
    const project = this.requireProject(projectId)
    const snapshot = this.requireSnapshot(projectId, project.currentSnapshotId)
    const activities = latestById(
      this.repository.listActivities(projectId),
      activity => activity.activityId,
    )
    const activityArtifacts = latestById(
      activities.flatMap(activity =>
        this.repository.listActivityArtifacts(projectId, activity.activityId),
      ),
      artifact => artifact.artifactId,
    )
    const channelContents = latestById(
      this.repository.listChannelContents(projectId),
      content => content.contentId,
    )
    const tasks = this.taskStore.listTasks(projectId)
    return {
      activities,
      activityArtifacts,
      channelBlueprints: clone(CHANNEL_BLUEPRINTS),
      channelContentReadiness: assessChannelContentsReadiness(
        channelContents,
        activityArtifacts,
      ),
      channelContents,
      compositionReceipts: tasks.flatMap(task =>
        this.taskStore.listCompositionReceipts(projectId, task.taskId),
      ),
      contentGroups: latestById(
        this.repository.listContentGroups(projectId),
        group => group.contentGroupId,
      ),
      monitoringObservations: this.repository.listMonitoringObservations(projectId),
      ownerHandoffs: this.repository.listOwnerHandoffs(projectId),
      publicationPlans: this.repository.listPublicationPlans(projectId),
      publicationReceipts: this.repository.listPublicationReceipts(projectId),
      recordingReceipts: tasks.flatMap(task =>
        this.taskStore
          .listRecordingReceipts(projectId, task.taskId)
          .map(toRecordingAttemptRecord),
      ),
      project,
      projectAssets: this.repository.listProjectAssets(projectId),
      projectChannelBindings: this.repository.listProjectChannelBindings(projectId),
      reports: this.repository.listReports(projectId),
      snapshot,
      taskEvents: Object.fromEntries(tasks.map(task => [
        task.taskId,
        this.taskStore.listEvents(projectId, task.taskId),
      ])),
      tasks,
    }
  }

  listProjects(): ContentStudioProjectIndexItem[] {
    return this.repository.listProjects().map((project) => {
      const snapshot = this.requireSnapshot(project.projectId, project.currentSnapshotId)
      const activities = latestById(
        this.repository.listActivities(project.projectId),
        activity => activity.activityId,
      )
      const tasks = this.taskStore.listTasks(project.projectId)
      const taskCounts: Record<ExecutionTaskKind, number> = {
        monitoring: tasks.filter(task => task.kind === 'monitoring').length,
        production: tasks.filter(task => task.kind === 'production').length,
        publication: tasks.filter(task => task.kind === 'publication').length,
      }
      const enabledChannels = this.repository
        .listProjectChannelBindings(project.projectId)
        .filter(binding => binding.enabled)
        .sort((left, right) => left.channel.localeCompare(right.channel))
        .map(binding => ({
          ...(binding.accountAlias === undefined
            ? {}
            : { accountAlias: binding.accountAlias }),
          channel: binding.channel,
          delivery: binding.delivery,
        }))
      return {
        activityCount: activities.length,
        enabledChannels,
        previewReady: snapshot.manifest.captureFlows.length > 0,
        project,
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshot.version,
        taskCount: tasks.length,
        taskCounts,
      }
    })
  }

  getGlobalView(): ContentStudioGlobalView {
    const projects = this.listProjects()
    const projectViews: ContentStudioGlobalProjectView[] = projects.map((item) => {
      const view = this.getProjectView(item.project.projectId)
      return {
        activities: view.activities,
        activityArtifacts: view.activityArtifacts,
        channelContentReadiness: view.channelContentReadiness,
        channelContents: view.channelContents,
        compositionReceipts: view.compositionReceipts,
        contentGroups: view.contentGroups,
        ownerHandoffs: view.ownerHandoffs,
        project: view.project,
        projectAssets: view.projectAssets,
        projectChannelBindings: view.projectChannelBindings.map((binding) => {
          const safeBinding = { ...binding }
          delete safeBinding.accountRef
          return safeBinding
        }),
        recordingReceipts: view.recordingReceipts,
        snapshot: view.snapshot,
        taskEvents: view.taskEvents,
        tasks: view.tasks,
      }
    })
    return { projectViews, projects }
  }

  getActivityArtifact(
    projectId: string,
    artifactId: string,
    version?: number,
  ): ActivityArtifact | undefined {
    return this.repository.getActivityArtifact(projectId, artifactId, version)
  }

  getProjectAsset(
    projectId: string,
    assetId: string,
    version?: number,
  ): ProjectAsset | undefined {
    return this.repository.getProjectAsset(projectId, assetId, version)
  }

  getChannelContentReadiness(
    projectId: string,
    contentId: string,
  ): ChannelContentReadiness {
    this.requireProject(projectId)
    const content = this.repository.getChannelContent(projectId, contentId)
    if (content === undefined)
      throw new RecordNotFoundError('Channel content', contentId)
    return this.contentReadiness(content)
  }

  registerProject(
    project: ProjectRecord,
    snapshot: ProjectSnapshot,
  ): ProjectRecord {
    if (
      project.projectId !== snapshot.projectId
      || project.currentSnapshotId !== snapshot.snapshotId
    ) {
      throw new Error('Project and snapshot ownership must match')
    }
    this.repository.saveProjectSnapshot(snapshot)
    return this.repository.saveProject(project)
  }

  updateProjectRegistration(
    project: ProjectRecord,
    snapshot: ProjectSnapshot,
  ): ProjectRecord {
    if (
      project.projectId !== snapshot.projectId
      || project.currentSnapshotId !== snapshot.snapshotId
    ) {
      throw new Error('Project and snapshot ownership must match')
    }
    this.repository.saveProjectSnapshot(snapshot)
    return this.repository.updateProject(project)
  }

  bindProjectChannel(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    this.requireProject(binding.projectId)
    return this.repository.saveProjectChannelBinding(binding)
  }

  updateProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    this.requireProject(binding.projectId)
    const existing = this.repository
      .listProjectChannelBindings(binding.projectId)
      .some(candidate => candidate.channel === binding.channel)
    if (!existing) {
      throw new RecordNotFoundError(
        'ProjectChannelBinding',
        `${binding.projectId}:${binding.channel}`,
      )
    }
    return this.repository.updateProjectChannelBinding(binding)
  }

  setProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    this.requireProject(binding.projectId)
    return this.repository.setProjectChannelBinding(binding)
  }

  createActivity(
    input: CreatePublishingActivityInput,
  ): PublishingActivity {
    this.requireProject(input.projectId)
    const snapshot = this.requireSnapshot(input.projectId, input.projectSnapshotId)
    this.assertActivityVideo(input.video, snapshot)
    this.assertChannelContentFormats(input.channels)
    this.assertActivityChannelVideoTargets(input.channels, input.video)
    this.assertEnabledChannels(input.projectId, input.channels)
    const activity = this.repository.saveActivity({
      ...input,
      ...(input.video === undefined
        ? { videoPlanReviewStatus: undefined }
        : { videoPlanReviewStatus: 'pending' as const }),
      version: 1,
    })
    return activity
  }

  cancelTask(projectId: string, taskId: string): ExecutionTask {
    this.requireProject(projectId)
    return this.taskStore.cancelTask(projectId, taskId)
  }

  completeOwnerHandoff(projectId: string, handoffId: string): OwnerHandoff {
    return this.updateOwnerHandoffStatus(projectId, handoffId, 'completed')
  }

  cancelOwnerHandoff(projectId: string, handoffId: string): OwnerHandoff {
    return this.cancelOwnerHandoffWithPolicy(projectId, handoffId, false)
  }

  private cancelOwnerHandoffWithPolicy(
    projectId: string,
    handoffId: string,
    allowManagedPublication: boolean,
  ): OwnerHandoff {
    const handoff = this.updateOwnerHandoffStatus(
      projectId,
      handoffId,
      'cancelled',
      allowManagedPublication,
    )
    const publicationTaskId = `publication-${handoff.publicationId}`
    const publicationTask = this.taskStore.getTask(projectId, publicationTaskId)
    if (publicationTask?.status === 'awaiting-owner')
      this.taskStore.cancelTask(projectId, publicationTaskId)
    return handoff
  }

  retryTask(projectId: string, taskId: string): ExecutionTask {
    this.requireProject(projectId)
    return this.taskStore.retryTask(projectId, taskId)
  }

  startProductionTask(projectId: string, taskId: string): ExecutionTask {
    this.requireProject(projectId)
    const task = this.taskStore.getTask(projectId, taskId)
    if (task !== undefined && task.kind !== 'production')
      throw new Error('Only production tasks can be started by this operation')
    return this.taskStore.transitionTask(projectId, taskId, 'generating')
  }

  runProductionTask(
    input: ProductionTaskInput,
    dependencies: ProductionTaskDependencies,
  ): Promise<ProductionTaskResult> {
    this.requireProject(input.projectId)
    return executeProductionTask(this.taskStore, input, dependencies)
  }

  runActivityProductionTask(
    projectId: string,
    taskId: string,
    input: Pick<
      ProductionTaskInput,
      'baseUrl' | 'maxAttempts' | 'outputDirectory' | 'projectOrigin' | 'signal'
    >,
    dependencies: ProductionTaskDependencies,
  ): Promise<ProductionTaskResult> {
    const project = this.requireProject(projectId)
    if (project.sourceAccess !== 'source-owned' || project.captureMode !== 'deterministic') {
      throw new Error(
        'The built-in recorder only supports source-owned deterministic projects',
      )
    }
    const task = this.taskStore.getTask(projectId, taskId)
    if (task === undefined)
      throw new RecordNotFoundError('Task', taskId)
    const activity = this.requireActivity(projectId, task.activityId)
    const plan = this.getActivityVideoPlan(
      projectId,
      task.activityId,
      task.channel,
    )
    return executeProductionTask(this.taskStore, {
      ...input,
      plan,
      projectId,
      recordingContext: {
        captureMode: project.captureMode,
        humanIntervention: project.ownerTakeover === true,
        ...(project.ownerTakeover === true ? { ownerTakeover: true } : {}),
        planVersion: activity.video?.planVersion ?? activity.version,
        repeatability: project.repeatability,
        sourceAccess: project.sourceAccess,
      },
      taskId,
    }, dependencies).then(result =>
      this.composeProductionVariant(
        projectId,
        taskId,
        input,
        result,
        dependencies.compose,
        dependencies.exportBilibiliVideo,
      ))
  }

  private async composeProductionVariant(
    projectId: string,
    taskId: string,
    input: Pick<
      ProductionTaskInput,
      'baseUrl' | 'maxAttempts' | 'outputDirectory' | 'projectOrigin' | 'signal'
    >,
    result: ProductionTaskResult,
    compose: ComposeProduction | undefined,
    exportBilibiliVideo: ((input: {
      outputPath: string
      signal?: AbortSignal
      sourcePath: string
    }) => Promise<BilibiliVideoExportResult>) | undefined,
  ): Promise<ProductionTaskResult> {
    const task = this.taskStore.getTask(projectId, taskId)
    if (
      task === undefined
      || task.kind !== 'production'
      || task.productionType !== 'video'
      || result.receipt.outcome !== 'succeeded'
      || compose === undefined
    ) {
      return result
    }
    const clipPaths = result.receipt.artifacts
      .filter(artifact => artifact.kind === 'video-clip')
      .map(artifact =>
        resolve(result.receipt.artifactDirectory, artifact.relativePath))
    if (clipPaths.length === 0)
      return result

    const outputPath = join(input.outputDirectory, 'composed', 'final.webm')
    const plan = this.getActivityVideoPlan(
      projectId,
      task.activityId,
      task.channel,
    )
    const activity = this.requireActivity(projectId, task.activityId)
    const content = task.contentId === undefined
      ? undefined
      : this.repository.getChannelContent(projectId, task.contentId)
    const coverPath = join(input.outputDirectory, 'composed', 'cover.svg')
    const gifPath = join(input.outputDirectory, 'composed', 'preview.gif')
    const compositionRoot = join(input.outputDirectory, '..')
    const cancelledBeforeCompose = this.cancelProductionIfRequested(
      projectId,
      taskId,
      input.signal,
      task.attempt,
    )
    if (cancelledBeforeCompose !== undefined) {
      this.recordCompositionCancellation(projectId, taskId, task.attempt)
      return { ...result, task: cancelledBeforeCompose }
    }
    this.taskStore.appendCompositionEvent(projectId, taskId, {
      kind: 'composition-started',
      message: 'Composition started',
    })
    const emittedKinds = new Set<CompositionProgressEvent['kind']>()
    const emitCompositionProgress = async (event: CompositionProgressEvent): Promise<void> => {
      emittedKinds.add(event.kind)
      this.taskStore.appendCompositionEvent(projectId, taskId, {
        artifact: compositionArtifactFromProgress(taskId, event, plan.recordingConfig.outputSize),
        kind: compositionEventKind(event.kind),
        message: compositionProgressMessage(event.kind),
      })
    }
    let composed: Awaited<ReturnType<ComposeProduction>>
    let bilibiliUpload: BilibiliVideoExportResult | undefined
    try {
      composed = await compose({
        clipPaths,
        cover: {
          outputPath: coverPath,
          subtitle: `${task.channel ?? 'local'} · ${plan.recordingConfig.locale}`,
          title: content?.title ?? activity.topic[plan.recordingConfig.locale],
        },
        gif: {
          outputPath: gifPath,
          outputSize: resolveGifOutputSize(plan.recordingConfig.outputSize),
        },
        emit: emitCompositionProgress,
        normalizeLoudness: true,
        outputPath,
        outputSize: plan.recordingConfig.outputSize,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      if (task.channel === 'bilibili' && content?.format === 'video') {
        if (exportBilibiliVideo === undefined) {
          throw new Error('Bilibili video upload variant exporter is unavailable')
        }
        const uploadPath = join(
          input.outputDirectory,
          'composed',
          `bilibili-${task.attempt}.mp4`,
        )
        bilibiliUpload = await exportBilibiliVideo({
          outputPath: uploadPath,
          sourcePath: outputPath,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        assertBilibiliUploadVariant(bilibiliUpload, uploadPath)
      }
      if (!emittedKinds.has('video-ready')) {
        await emitCompositionProgress({ artifact: composed, kind: 'video-ready' })
      }
      if (composed.cover !== undefined && !emittedKinds.has('cover-ready')) {
        await emitCompositionProgress({ artifact: composed.cover, kind: 'cover-ready' })
      }
      if (composed.gif !== undefined && !emittedKinds.has('gif-ready')) {
        await emitCompositionProgress({ artifact: composed.gif, kind: 'gif-ready' })
      }
    }
    catch (error: unknown) {
      return this.failComposition(
        projectId,
        taskId,
        task.attempt,
        input.signal,
        result,
        error,
      )
    }

    const cancelled = this.cancelProductionIfRequested(
      projectId,
      taskId,
      input.signal,
      task.attempt,
    )
    if (cancelled !== undefined) {
      this.recordCompositionCancellation(projectId, taskId, task.attempt)
      return { ...result, task: cancelled }
    }

    try {
      const compositionArtifacts = compositionArtifactsFromResult(
        taskId,
        composed,
        compositionRoot,
        plan.recordingConfig.outputSize,
      )
      const bilibiliUploadArtifact = bilibiliUpload === undefined
        ? undefined
        : bilibiliCompositionArtifact(
            taskId,
            task.attempt,
            bilibiliUpload,
            compositionRoot,
          )
      const registeredArtifacts = bilibiliUploadArtifact === undefined
        ? compositionArtifacts
        : [...compositionArtifacts, bilibiliUploadArtifact]
      for (const artifact of registeredArtifacts) {
        this.createActivityArtifact({
          activityId: task.activityId,
          artifactId: artifact.artifactId,
          kind: artifact.kind === 'video' ? 'video' : 'image',
          projectId,
          relativePath: artifact.relativePath!,
          sha256: artifact.sha256,
          ...(artifact.artifactId === bilibiliUploadArtifact?.artifactId
            && content?.locale !== undefined
            ? { locale: content.locale }
            : {}),
        })
      }
      if (task.contentId !== undefined) {
        const contentArtifactIds = bilibiliUploadArtifact === undefined
          ? compositionArtifacts.map(artifact => artifact.artifactId)
          : registeredArtifacts
              .filter(artifact => artifact.artifactId !== `composed-${taskId}`)
              .map(artifact => artifact.artifactId)
        if (bilibiliUploadArtifact === undefined) {
          this.attachActivityArtifactsToChannelContent(
            projectId,
            task.contentId,
            contentArtifactIds,
          )
        }
        else {
          this.replaceActivityVideoInChannelContent(
            projectId,
            task.contentId,
            contentArtifactIds,
          )
        }
      }
      this.taskStore.saveCompositionReceipt(projectId, taskId, {
        artifacts: registeredArtifacts,
        attempt: task.attempt,
        jobId: taskId,
        outcome: 'succeeded',
        projectId,
        receiptVersion: 1,
      })
      const completed = this.taskStore.transitionTask(
        projectId,
        taskId,
        'completed',
      )
      this.taskStore.appendCompositionEvent(projectId, taskId, {
        kind: 'composition-completed',
        message: `Composition completed with ${registeredArtifacts.length} artifacts`,
      })
      return {
        ...result,
        task: completed,
      }
    }
    catch (error: unknown) {
      return this.failComposition(
        projectId,
        taskId,
        task.attempt,
        input.signal,
        result,
        error,
      )
    }
  }

  private failComposition(
    projectId: string,
    taskId: string,
    attempt: number,
    signal: AbortSignal | undefined,
    result: ProductionTaskResult,
    error: unknown,
  ): ProductionTaskResult {
    const cancelled = this.cancelProductionIfRequested(
      projectId,
      taskId,
      signal,
      attempt,
    )
    if (cancelled !== undefined) {
      this.recordCompositionCancellation(projectId, taskId, attempt)
      return { ...result, task: cancelled }
    }
    const message = error instanceof Error ? error.message : String(error)
    const task = this.taskStore.getTask(projectId, taskId)
    if (task?.status === 'composing')
      this.taskStore.transitionTask(projectId, taskId, 'failed')
    this.taskStore.saveCompositionReceipt(projectId, taskId, {
      artifacts: [],
      attempt,
      failure: {
        code: 'runtime-error',
        message,
        retryable: true,
      },
      jobId: taskId,
      outcome: 'failed',
      projectId,
      receiptVersion: 1,
    })
    this.taskStore.appendCompositionEvent(projectId, taskId, {
      kind: 'composition-failed',
      message,
    })
    throw error
  }

  private cancelProductionIfRequested(
    projectId: string,
    taskId: string,
    signal: AbortSignal | undefined,
    expectedAttempt?: number,
  ): ExecutionTask | undefined {
    const current = this.taskStore.getTask(projectId, taskId)
    if (current !== undefined
      && expectedAttempt !== undefined
      && current.attempt !== expectedAttempt) {
      return current
    }
    if (current?.status === 'cancelled')
      return current
    if (signal?.aborted !== true || current === undefined)
      return undefined
    return this.taskStore.cancelTask(projectId, taskId)
  }

  private recordCompositionCancellation(
    projectId: string,
    taskId: string,
    attempt: number,
  ): void {
    if (this.taskStore.listCompositionReceipts(projectId, taskId)
      .some(receipt => receipt.attempt === attempt)) {
      return
    }
    this.taskStore.saveCompositionReceipt(projectId, taskId, {
      artifacts: [],
      attempt,
      failure: {
        code: 'cancelled',
        message: 'Composition cancelled',
        retryable: true,
      },
      jobId: taskId,
      outcome: 'cancelled',
      projectId,
      receiptVersion: 1,
    })
    const current = this.taskStore.getTask(projectId, taskId)
    if (current?.attempt === attempt && current.status === 'cancelled') {
      this.taskStore.appendCompositionEvent(projectId, taskId, {
        kind: 'composition-cancelled',
        message: 'Composition cancelled',
      })
    }
  }

  getActivityVideoPlan(
    projectId: string,
    activityId: string,
    channelId?: ChannelId,
  ): VideoPlan {
    const activity = this.requireActivity(projectId, activityId)
    if (activity.video === undefined)
      throw new Error(`Activity ${activityId} does not define a video plan`)
    const snapshot = this.requireSnapshot(projectId, activity.projectSnapshotId)
    const plan = compileVideoPlan(
      snapshot.manifest,
      {
        channels: activity.channels,
        campaignId: activity.campaignId,
        goal: activity.goal,
        highlights: [],
        schemaVersion: 1,
        tags: [],
        targetUrl: activity.targetUrl,
        topic: activity.topic,
        video: activity.video,
      },
      channelId,
    )
    return {
      ...plan,
      reviewStatus: activity.videoPlanReviewStatus ?? 'pending',
    }
  }

  listTaskEvents(projectId: string, taskId: string): ExecutionTaskEvent[] {
    this.requireProject(projectId)
    return this.taskStore.listEvents(projectId, taskId)
  }

  listCompositionReceipts(
    projectId: string,
    taskId: string,
  ): CompositionAttemptReceipt[] {
    this.requireProject(projectId)
    return this.taskStore.listCompositionReceipts(projectId, taskId)
  }

  getRecordingArtifact(
    projectId: string,
    taskId: string,
    attempt: number,
    artifactId: string,
  ): { artifact: RecorderArtifact, artifactDirectory: string } {
    this.requireProject(projectId)
    const receipt = this.taskStore
      .listRecordingReceipts(projectId, taskId)
      .find(candidate => candidate.attempt === attempt)
    if (receipt === undefined)
      throw new RecordNotFoundError('RecordingAttempt', `${taskId}:${attempt}`)
    const artifact = receipt.artifacts.find(candidate => candidate.id === artifactId)
    if (artifact === undefined)
      throw new RecordNotFoundError('RecordingArtifact', artifactId)
    return {
      artifact,
      artifactDirectory: receipt.artifactDirectory,
    }
  }

  reviseActivity(input: ActivityRevisionInput): PublishingActivity {
    const current = this.requireActivity(input.projectId, input.activityId)
    if (current.version !== input.baseVersion) {
      throw new Error(
        `Activity ${input.activityId} has moved past version ${input.baseVersion}`,
      )
    }
    const snapshot = this.requireSnapshot(input.projectId, current.projectSnapshotId)
    if (input.video !== undefined) {
      this.assertActivityVideo(input.video, snapshot)
      this.assertActivityChannelVideoTargets(current.channels, input.video)
    }
    return this.repository.saveActivity({
      ...current,
      topic: input.topic,
      ...(input.video === undefined
        ? {}
        : {
            video: input.video,
            videoPlanReviewStatus: 'pending' as const,
          }),
      version: current.version + 1,
    })
  }

  confirmActivityVideoPlan(
    input: ConfirmActivityVideoPlanInput,
  ): PublishingActivity {
    const current = this.requireActivity(input.projectId, input.activityId)
    if (current.version !== input.baseVersion) {
      throw new Error(
        `Activity ${input.activityId} has moved past version ${input.baseVersion}`,
      )
    }
    if (current.video === undefined)
      throw new Error(`Activity ${input.activityId} does not define a video plan`)
    if (current.videoPlanReviewStatus === 'confirmed')
      return current
    return this.repository.saveActivity({
      ...current,
      version: current.version + 1,
      videoPlanReviewStatus: 'confirmed',
    })
  }

  createContentGroup(input: CreateContentGroupInput): ContentGroup {
    this.requireActivity(input.projectId, input.activityId)
    return this.repository.saveContentGroup({
      ...input,
      version: 1,
    })
  }

  createChannelContent(input: CreateChannelContentInput): ChannelContent {
    const activity = this.requireActivity(input.projectId, input.activityId)
    const group = this.repository.getContentGroup(
      input.projectId,
      input.contentGroupId,
    )
    if (group === undefined)
      throw new RecordNotFoundError('Content group', input.contentGroupId)
    if (group.activityId !== activity.activityId)
      throw new Error('Content group must belong to the activity')
    if (!activity.channels.some(channel =>
      channel.id === input.channel && channel.locale === input.locale,
    )) {
      throw new Error('Channel content must target an activity channel and locale')
    }
    this.assertActivityChannelContentFormat(
      activity,
      input.channel,
      input.locale,
      input.format,
    )
    this.assertEnabledChannels(input.projectId, [
      {
        id: input.channel,
        locale: input.locale,
      },
    ])
    this.assertChannelContentArtifacts(
      input.projectId,
      activity.activityId,
      input.artifactIds,
      input.locale,
    )
    const content = this.repository.saveChannelContent({
      ...input,
      version: 1,
    })
    this.createProductionTask(content)
    return content
  }

  reviseChannelContentMedia(
    input: ChannelContentMediaRevisionInput,
  ): ChannelContent {
    this.requireProject(input.projectId)
    if (input.mode !== 'append' && input.mode !== 'replace')
      throw new Error('Channel content media revision mode must be append or replace')
    const current = this.repository.getChannelContent(
      input.projectId,
      input.contentId,
    )
    if (current === undefined)
      throw new RecordNotFoundError('Channel content', input.contentId)
    if (current.version !== input.baseVersion) {
      throw new Error(
        `Channel content ${input.contentId} has moved past version ${input.baseVersion}`,
      )
    }
    const existingPlan = this.repository.listPublicationPlans(input.projectId)
      .find(plan => plan.contentId === input.contentId)
    if (existingPlan !== undefined) {
      throw new Error(
        `Channel content ${input.contentId} cannot be revised after publication plan ${existingPlan.publicationId}`,
      )
    }
    this.assertChannelContentArtifacts(
      input.projectId,
      current.activityId,
      current.artifactIds,
      current.locale,
    )
    this.assertChannelContentMediaArtifacts(
      input.projectId,
      current.activityId,
      input.artifactIds,
      current.locale,
    )
    const currentMediaArtifactIds = current.artifactIds.filter((artifactId) => {
      const artifact = this.repository.getActivityArtifact(
        input.projectId,
        artifactId,
      )
      return artifact !== undefined && isFinalMediaArtifactKind(artifact.kind)
    })
    const currentMediaIds = new Set(currentMediaArtifactIds)
    const requestedMediaIds = [...new Set(input.artifactIds)]
    if (
      input.mode === 'replace'
      && requestedMediaIds.length === currentMediaArtifactIds.length
      && requestedMediaIds.every((artifactId, index) =>
        artifactId === currentMediaArtifactIds[index],
      )
    ) {
      return current
    }
    const nextArtifactIds = input.mode === 'append'
      ? [...new Set([...current.artifactIds, ...requestedMediaIds])]
      : [
          ...current.artifactIds.filter(artifactId => !currentMediaIds.has(artifactId)),
          ...requestedMediaIds,
        ]
    if (
      nextArtifactIds.length === current.artifactIds.length
      && nextArtifactIds.every((artifactId, index) =>
        artifactId === current.artifactIds[index],
      )
    ) {
      return current
    }
    return this.repository.saveChannelContent({
      ...current,
      artifactIds: nextArtifactIds,
      version: current.version + 1,
    })
  }

  saveActivityContentPack(
    input: CreateActivityContentPackInput,
  ): ActivityContentPack {
    const activity = this.requireActivity(input.projectId, input.activityId)
    if (input.contents.length === 0)
      throw new Error('Content pack must contain at least one channel content')
    const contentIds = new Set<string>()
    if (this.repository.getContentGroup(input.projectId, input.contentGroupId) !== undefined)
      throw new RecordConflictError(input.contentGroupId, 1)
    for (const content of input.contents) {
      if (contentIds.has(content.contentId))
        throw new Error(`Duplicate content id: ${content.contentId}`)
      contentIds.add(content.contentId)
      if (this.repository.getChannelContent(input.projectId, content.contentId) !== undefined)
        throw new RecordConflictError(content.contentId, 1)
      if (!activity.channels.some(channel =>
        channel.id === content.channel && channel.locale === content.locale,
      )) {
        throw new Error('Content pack channel and locale must match the activity')
      }
      this.assertActivityChannelContentFormat(
        activity,
        content.channel,
        content.locale,
        content.format,
      )
      this.assertChannelContentArtifacts(
        input.projectId,
        input.activityId,
        content.artifactIds,
        content.locale,
      )
    }
    this.assertEnabledChannels(
      input.projectId,
      input.contents.map(content => ({
        id: content.channel,
        locale: content.locale,
      })),
    )
    const contentGroup = this.repository.saveContentGroup({
      activityId: input.activityId,
      contentGroupId: input.contentGroupId,
      coreMessage: input.coreMessage,
      projectId: input.projectId,
      title: input.title,
      version: 1,
    })
    const contents = input.contents.map(content => this.repository.saveChannelContent({
      ...content,
      activityId: input.activityId,
      contentGroupId: input.contentGroupId,
      projectId: input.projectId,
      version: 1,
    }))
    contents.forEach(content => this.createProductionTask(content))
    return { contentGroup, contents }
  }

  createActivityArtifact(
    input: CreateActivityArtifactInput,
  ): ActivityArtifact {
    this.requireActivity(input.projectId, input.activityId)
    const relativePath = toPortableRelativePath(input.relativePath)
    if (!isSafeRelativePath(relativePath))
      throw new Error('Activity artifact relative path must be safe')
    return this.repository.saveActivityArtifact({
      ...input,
      relativePath,
      version: 1,
    })
  }

  promoteActivityArtifact(
    input: PromoteActivityArtifactInput,
  ): ProjectAsset {
    const artifact = this.repository.getActivityArtifact(
      input.projectId,
      input.artifactId,
    )
    if (artifact === undefined)
      throw new RecordNotFoundError('Activity artifact', input.artifactId)
    return this.repository.saveProjectAsset({
      assetId: input.assetId,
      kind: input.kind,
      projectId: input.projectId,
      relativePath: artifact.relativePath,
      sha256: artifact.sha256,
      sourceArtifactId: artifact.artifactId,
      version: 1,
    })
  }

  createPublicationPlan(input: PublicationPlan): PublicationPlan {
    const activity = this.requireActivity(input.projectId, input.activityId)
    const content = this.repository.getChannelContent(
      input.projectId,
      input.contentId,
    )
    if (content === undefined)
      throw new RecordNotFoundError('Channel content', input.contentId)
    if (
      content.activityId !== activity.activityId
      || content.channel !== input.channel
    ) {
      throw new Error('Publication plan must match activity content and channel')
    }
    this.assertEnabledChannels(input.projectId, [
      {
        id: input.channel,
        locale: content.locale,
      },
    ])
    this.assertPublishableChannel(input.projectId, input.channel)
    this.assertChannelContentPublicationReadiness(content)
    const plan = this.repository.savePublicationPlan(input)
    this.createPublicationTask(plan)
    return plan
  }

  prepareMarketingOpsPublicationPackage(
    input: PrepareMarketingOpsPublicationPackageInput,
  ): MarketingOpsPublicationPackagePreparation {
    const publication = this.requirePublicationPlan(
      input.projectId,
      input.publicationId,
    )
    const content = this.repository.getChannelContent(
      input.projectId,
      publication.contentId,
    )
    if (content === undefined)
      throw new RecordNotFoundError('Channel content', publication.contentId)
    const activity = this.requireActivity(input.projectId, publication.activityId)
    const snapshot = this.requireSnapshot(
      input.projectId,
      activity.projectSnapshotId,
    )
    const binding = this.repository
      .listProjectChannelBindings(input.projectId)
      .find(candidate => candidate.channel === publication.channel)
    if (binding?.enabled !== true) {
      throw new Error(
        `Activity can only target enabled channel: ${publication.channel}`,
      )
    }
    if (binding.delivery === 'content-only') {
      throw new Error(
        `Content-only channel does not support publication plans: ${publication.channel}`,
      )
    }

    return {
      externalWrite: false,
      mode: 'prepare-only',
      package: compileMarketingOpsPublicationPackage({
        ...(binding.accountRef === undefined
          ? {}
          : { accountRef: binding.accountRef }),
        activity,
        artifacts: this.repository.listActivityArtifacts(
          input.projectId,
          activity.activityId,
        ),
        content,
        publication,
        renderer: input.renderer,
        snapshot,
      }),
    }
  }

  recordPublicationReceipt(
    receipt: PublicationReceipt,
  ): PublicationReceipt {
    const plan = this.repository.getPublicationPlan(
      receipt.projectId,
      receipt.publicationId,
    )
    if (plan === undefined)
      throw new RecordNotFoundError('Publication plan', receipt.publicationId)
    if (
      plan.activityId !== receipt.activityId
      || plan.channel !== receipt.channel
      || plan.projectId !== receipt.projectId
    ) {
      throw new Error('Publication receipt must match activity, channel, and project')
    }
    if (receipt.status === 'published') {
      const binding = this.repository
        .listProjectChannelBindings(receipt.projectId)
        .find(candidate => candidate.channel === receipt.channel)
      assertMatchingMarketingOpsReceipt(receipt, {
        ...(binding?.accountRef === undefined ? {} : { accountRef: binding.accountRef }),
        activityId: receipt.activityId,
        channel: receipt.channel,
        projectId: receipt.projectId,
        publicationId: receipt.publicationId,
      })
    }
    const existingReceipt = this.repository.getPublicationReceipt(
      receipt.projectId,
      receipt.receiptId,
    )
    if (existingReceipt !== undefined && !samePublicationReceipt(existingReceipt, receipt)) {
      throw new Error('Publication receipt conflicts with an existing receipt')
    }
    const savedReceipt = existingReceipt ?? this.repository.savePublicationReceipt(receipt)
    const publicationTaskId = `publication-${receipt.publicationId}`
    let publicationTask = this.taskStore.getTask(receipt.projectId, publicationTaskId)
    if (publicationTask === undefined) {
      this.createPublicationTask(plan)
      publicationTask = this.taskStore.getTask(receipt.projectId, publicationTaskId)
    }
    if (publicationTask !== undefined) {
      const nextStatus = receipt.status === 'published' ? 'published' : 'failed'
      if (publicationTask.status !== nextStatus) {
        this.taskStore.transitionTask(
          receipt.projectId,
          publicationTaskId,
          nextStatus,
          { hasMatchingPublicationReceipt: true },
        )
      }
      if (receipt.status === 'published')
        this.createMonitoringTask(receipt)
    }
    return savedReceipt
  }

  /**
   * Stores the exact path-free package an owner must publish. Confirmation
   * later reads this snapshot instead of compiling the mutable activity again.
   */
  createMarketingOpsPublicationHandoff(
    packageValue: MarketingOpsPublicationPackage,
  ): OwnerHandoff {
    this.assertMarketingOpsPublicationHandoffPackage(packageValue)
    const now = Date.now()
    const existing = this.repository.listOwnerHandoffs(packageValue.projectId)
      .find(handoff =>
        handoff.marketingOpsPackage?.packageId === packageValue.packageId
        && handoff.marketingOpsPackage.contentHash === packageValue.contentHash
        && (
          handoff.status === 'completed'
          || (
            handoff.status === 'pending'
            && Number.isFinite(Date.parse(handoff.expiresAt))
            && Date.parse(handoff.expiresAt) > now
          )
        ),
      )
    if (existing !== undefined)
      return existing

    const issuedAt = new Date()
    const expiresAt = new Date(issuedAt.getTime() + MARKETING_OPS_OWNER_HANDOFF_TTL_MS)
    if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime()))
      throw new Error('Marketing-ops handoff clock is invalid')
    return this.createOwnerHandoff({
      activityId: packageValue.activityId,
      artifactChecksums: [...new Set(packageValue.artifactRefs.map(reference => reference.sha256))]
        .sort(),
      channel: packageValue.channel,
      checklist: [
        'Review the locked package and matching artifact checksums.',
        'Publish the matching content only in the official channel UI.',
        'Return only the resulting public HTTPS URL for confirmation.',
      ],
      expiresAt: expiresAt.toISOString(),
      handoffId: marketingOpsHandoffId(packageValue, issuedAt),
      marketingOpsPackage: packageValue,
      officialTargetUrl: MARKETING_OPS_OWNER_HANDOFF_TARGETS[packageValue.channel]!,
      projectId: packageValue.projectId,
      publicationId: packageValue.publicationId,
      status: 'pending',
    })
  }

  getMarketingOpsPublicationHandoff(
    projectId: string,
    handoffId: string,
  ): OwnerHandoff {
    this.requireProject(projectId)
    const handoff = this.repository.getOwnerHandoff(projectId, handoffId)
    if (handoff === undefined)
      throw new RecordNotFoundError('OwnerHandoff', handoffId)
    if (handoff.marketingOpsPackage === undefined)
      throw new Error('Owner handoff does not contain a marketing-ops package')
    if (handoff.status !== 'pending' && handoff.status !== 'completed')
      throw new Error(`Owner handoff ${handoffId} is not available for confirmation`)
    const expiresAt = Date.parse(handoff.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new Error(`Owner handoff ${handoffId} has expired`)
    this.assertMarketingOpsPublicationHandoffPackage(handoff.marketingOpsPackage)
    return handoff
  }

  getMarketingOpsPublicationHandoffForAbandonment(
    projectId: string,
    handoffId: string,
  ): OwnerHandoff {
    this.requireProject(projectId)
    const handoff = this.repository.getOwnerHandoff(projectId, handoffId)
    if (handoff === undefined)
      throw new RecordNotFoundError('OwnerHandoff', handoffId)
    if (handoff.marketingOpsPackage === undefined)
      throw new Error('Owner handoff does not contain a marketing-ops package')
    if (handoff.status === 'completed')
      throw new Error(`Owner handoff ${handoffId} is completed and cannot be abandoned`)
    if (handoff.status !== 'pending' && handoff.status !== 'cancelled')
      throw new Error(`Owner handoff ${handoffId} is not available for abandonment`)
    this.assertMarketingOpsPublicationHandoffPackage(handoff.marketingOpsPackage)
    return handoff
  }

  abandonMarketingOpsPublicationHandoff(
    projectId: string,
    handoffId: string,
  ): OwnerHandoff {
    const handoff = this.getMarketingOpsPublicationHandoffForAbandonment(projectId, handoffId)
    if (handoff.status === 'cancelled')
      return handoff
    const cancelled = this.cancelOwnerHandoffWithPolicy(projectId, handoffId, true)
    if (cancelled.marketingOpsConfirmation === undefined)
      return cancelled
    const sanitized: OwnerHandoff = { ...cancelled }
    delete sanitized.marketingOpsConfirmation
    return this.repository.updateOwnerHandoff(sanitized)
  }

  /**
   * Reserves the exact public URL an owner is confirming. The repository
   * update is synchronous, so two confirmations handled by this process
   * cannot reserve different URLs for the same pending handoff.
   */
  claimMarketingOpsPublicationConfirmation(
    projectId: string,
    handoffId: string,
    publicUrl: string,
  ): OwnerHandoff {
    assertOwnerConfirmationUrl(publicUrl)
    const handoff = this.getMarketingOpsPublicationHandoff(projectId, handoffId)
    const existing = handoff.marketingOpsConfirmation
    if (existing !== undefined) {
      if (existing.publicUrl !== publicUrl) {
        throw new Error(
          `Owner handoff ${handoffId} is already bound to another public URL`,
        )
      }
      return handoff
    }
    if (handoff.status === 'completed') {
      throw new Error(`Owner handoff ${handoffId} has no confirmation binding`)
    }
    const confirmation: MarketingOpsPublicationConfirmationState = {
      publicUrl,
      status: 'pending',
    }
    return this.repository.updateOwnerHandoff({
      ...handoff,
      marketingOpsConfirmation: confirmation,
    })
  }

  releaseMarketingOpsPublicationConfirmation(
    projectId: string,
    handoffId: string,
    publicUrl: string,
  ): OwnerHandoff {
    assertOwnerConfirmationUrl(publicUrl)
    const handoff = this.getMarketingOpsPublicationHandoff(projectId, handoffId)
    const confirmation = handoff.marketingOpsConfirmation
    if (
      handoff.status !== 'pending'
      || confirmation?.status !== 'pending'
      || confirmation.publicUrl !== publicUrl
    ) {
      return handoff
    }
    const released: OwnerHandoff = { ...handoff }
    delete released.marketingOpsConfirmation
    return this.repository.updateOwnerHandoff(released)
  }

  completeMarketingOpsPublicationHandoff(
    projectId: string,
    handoffId: string,
    publicUrl?: string,
  ): OwnerHandoff {
    if (publicUrl !== undefined)
      assertOwnerConfirmationUrl(publicUrl)
    const handoff = this.getMarketingOpsPublicationHandoff(projectId, handoffId)
    if (
      publicUrl !== undefined
      && handoff.marketingOpsConfirmation !== undefined
      && handoff.marketingOpsConfirmation.publicUrl !== publicUrl
    ) {
      throw new Error(
        `Owner handoff ${handoffId} is already bound to another public URL`,
      )
    }
    if (handoff.status === 'completed') {
      if (
        publicUrl !== undefined
        && handoff.marketingOpsConfirmation === undefined
      ) {
        throw new Error(`Owner handoff ${handoffId} has no confirmation binding`)
      }
      return handoff
    }
    const completed = this.updateOwnerHandoffStatus(
      projectId,
      handoffId,
      'completed',
      true,
    )
    if (publicUrl === undefined && completed.marketingOpsConfirmation === undefined)
      return completed
    const current = completed.marketingOpsConfirmation
    const confirmation: MarketingOpsPublicationConfirmationState = {
      publicUrl: publicUrl ?? current?.publicUrl ?? '',
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
    }
    if (confirmation.publicUrl === '')
      throw new Error('Marketing-ops confirmation requires a public URL')
    return this.repository.updateOwnerHandoff({
      ...completed,
      marketingOpsConfirmation: confirmation,
    })
  }

  createOwnerHandoff(handoff: OwnerHandoff): OwnerHandoff {
    this.requireProject(handoff.projectId)
    const plan = this.requirePublicationPlan(
      handoff.projectId,
      handoff.publicationId,
    )
    if (
      plan.activityId !== handoff.activityId
      || plan.channel !== handoff.channel
    ) {
      throw new Error('Owner handoff must match activity and channel')
    }
    if (handoff.artifactChecksums.length === 0 && handoff.marketingOpsPackage === undefined) {
      throw new Error('Owner handoff requires an artifact checksum')
    }
    if (handoff.marketingOpsPackage !== undefined)
      this.assertMarketingOpsPublicationHandoffPackage(handoff.marketingOpsPackage)
    if (handoff.checklist.length === 0) {
      throw new Error('Owner handoff requires a review checklist')
    }
    const savedHandoff = this.repository.saveOwnerHandoff(handoff)
    const publicationTaskId = `publication-${handoff.publicationId}`
    const publicationTask = this.taskStore.getTask(handoff.projectId, publicationTaskId)
    if (publicationTask?.status === 'queued') {
      this.taskStore.transitionTask(
        handoff.projectId,
        publicationTaskId,
        'awaiting-owner',
        { hasMatchingOwnerHandoff: true },
      )
    }
    return savedHandoff
  }

  private updateOwnerHandoffStatus(
    projectId: string,
    handoffId: string,
    status: Extract<OwnerHandoff['status'], 'cancelled' | 'completed'>,
    allowManagedPublication = false,
  ): OwnerHandoff {
    this.requireProject(projectId)
    const handoff = this.repository.getOwnerHandoff(projectId, handoffId)
    if (handoff === undefined)
      throw new RecordNotFoundError('OwnerHandoff', handoffId)
    if (handoff.marketingOpsPackage !== undefined && !allowManagedPublication) {
      throw new Error(
        `Owner handoff ${handoffId} is a managed publication and requires its typed workflow`,
      )
    }
    if (handoff.status !== 'pending')
      throw new Error(`Owner handoff ${handoffId} is not pending`)
    return this.repository.updateOwnerHandoff({ ...handoff, status })
  }

  private assertMarketingOpsPublicationHandoffPackage(
    packageValue: MarketingOpsPublicationPackage,
  ): void {
    const plan = this.requirePublicationPlan(
      packageValue.projectId,
      packageValue.publicationId,
    )
    if (
      packageValue.schemaVersion !== 1
      || packageValue.projectId !== plan.projectId
      || packageValue.activityId !== plan.activityId
      || packageValue.channel !== plan.channel
      || packageValue.contentId !== plan.contentId
      || packageValue.packageId !== packageValue.publicationId
      || !/^[a-f0-9]{64}$/u.test(packageValue.contentHash)
      || !isValidVideoOrientation(packageValue)
      || MARKETING_OPS_OWNER_HANDOFF_TARGETS[packageValue.channel] === undefined
    ) {
      throw new Error('Marketing-ops handoff package does not match its publication plan')
    }
    for (const reference of packageValue.artifactRefs) {
      if (
        !/^[a-f0-9]{64}$/u.test(reference.sha256)
        || !Number.isInteger(reference.version)
        || reference.version < 1
      ) {
        throw new Error('Marketing-ops handoff package has an invalid artifact reference')
      }
    }
  }

  recordMonitoringObservation(
    observation: MonitoringObservation,
  ): MonitoringObservation {
    const plan = this.requirePublicationPlan(
      observation.projectId,
      observation.publicationId,
    )
    const receipt = this.repository.getPublicationReceiptForPublication(
      observation.projectId,
      observation.publicationId,
    )
    if (receipt?.status !== 'published') {
      throw new Error(
        'Monitoring observation requires a published receipt',
      )
    }
    if (
      plan.activityId !== observation.activityId
      || plan.channel !== observation.channel
      || receipt.activityId !== observation.activityId
      || receipt.channel !== observation.channel
    ) {
      throw new Error('Monitoring observation must match publication')
    }
    const savedObservation = this.repository.saveMonitoringObservation(observation)
    const monitoringTaskId = `monitoring-${observation.publicationId}`
    if (this.taskStore.getTask(observation.projectId, monitoringTaskId) !== undefined) {
      const task = this.taskStore.getTask(observation.projectId, monitoringTaskId)
      if (task?.status === 'queued')
        this.taskStore.transitionTask(observation.projectId, monitoringTaskId, 'monitoring')
    }
    return savedObservation
  }

  createReport(report: ContentStudioReport): ContentStudioReport {
    this.requireProject(report.projectId)
    if (report.observationIds.length === 0) {
      throw new Error('Report requires at least one observation')
    }
    if (report.scope === 'activity' && report.activityId === undefined) {
      throw new Error('Activity report requires an activity')
    }
    for (const observationId of report.observationIds) {
      const observation = this.repository.getMonitoringObservation(
        report.projectId,
        observationId,
      )
      if (observation === undefined) {
        throw new RecordNotFoundError('Monitoring observation', observationId)
      }
      if (
        report.scope === 'activity'
        && observation.activityId !== report.activityId
      ) {
        throw new Error('Activity report observations must match activity')
      }
    }
    return this.repository.saveReport(report)
  }

  private requireProject(projectId: string): ProjectRecord {
    const project = this.repository.getProject(projectId)
    if (project === undefined)
      throw new RecordNotFoundError('Project', projectId)
    return project
  }

  private requireSnapshot(
    projectId: string,
    snapshotId: string,
  ): ProjectSnapshot {
    const snapshot = this.repository.getProjectSnapshot(projectId, snapshotId)
    if (snapshot === undefined)
      throw new RecordNotFoundError('Project snapshot', snapshotId)
    return snapshot
  }

  private requireActivity(
    projectId: string,
    activityId: string,
  ): PublishingActivity {
    const activity = this.repository.getActivity(projectId, activityId)
    if (activity === undefined)
      throw new RecordNotFoundError('Publishing activity', activityId)
    return activity
  }

  private requirePublicationPlan(
    projectId: string,
    publicationId: string,
  ): PublicationPlan {
    const plan = this.repository.getPublicationPlan(projectId, publicationId)
    if (plan === undefined)
      throw new RecordNotFoundError('Publication plan', publicationId)
    return plan
  }

  private assertEnabledChannels(
    projectId: string,
    channels: readonly {
      id: ProjectChannelBinding['channel']
      locale?: string
    }[],
  ): void {
    const enabled = new Set(
      this.repository
        .listProjectChannelBindings(projectId)
        .filter(binding => binding.enabled)
        .map(binding => binding.channel),
    )
    const missing = channels.find(channel => !enabled.has(channel.id))
    if (missing !== undefined) {
      throw new Error(
        `Activity can only target enabled channel: ${missing.id}`,
      )
    }
  }

  private assertChannelContentFormats(
    channels: readonly {
      contentFormats?: readonly ContentFormat[]
      id: ChannelId
    }[],
  ): void {
    for (const channel of channels) {
      const formats = channel.contentFormats
      if (formats === undefined)
        continue
      if (formats.length === 0)
        throw new Error(`Channel ${channel.id} contentFormats must not be empty`)
      const seen = new Set<ContentFormat>()
      for (const format of formats) {
        if (seen.has(format))
          throw new Error(`Duplicate channel content form: ${format}`)
        seen.add(format)
        if (!CHANNEL_BLUEPRINTS[channel.id].supportedFormats.includes(format)) {
          throw new Error(
            `Channel ${channel.id} does not support content form: ${format}`,
          )
        }
      }
    }
  }

  private assertActivityChannelVideoTargets(
    channels: readonly {
      contentFormats?: readonly ContentFormat[]
      id: ChannelId
    }[],
    video: PublishingActivity['video'],
  ): void {
    const bilibiliVideo = channels.find(channel =>
      channel.id === 'bilibili'
      && selectedContentFormatsForChannel(channel).includes('video-metadata'),
    )
    if (bilibiliVideo === undefined)
      return
    if (video === undefined)
      throw new Error('Bilibili video content form requires an activity video plan')
    const format = resolveVideoFormatForChannel(video, 'bilibili')
    if (format !== 'landscape' && format !== 'portrait') {
      throw new Error(
        'Bilibili activity video orientation must be landscape or portrait',
      )
    }
  }

  private assertActivityChannelContentFormat(
    activity: PublishingActivity,
    channel: ChannelId,
    locale: Locale,
    format: ChannelContentFormat,
  ): void {
    const target = activity.channels.find(candidate =>
      candidate.id === channel && candidate.locale === locale,
    )
    if (target === undefined)
      return
    const packageFormat = format === 'video' ? 'video-metadata' : format
    if (!selectedContentFormatsForChannel(target).includes(packageFormat)) {
      throw new Error(
        `Activity channel ${channel} does not select content form: ${packageFormat}`,
      )
    }
  }

  private assertPublishableChannel(
    projectId: string,
    channel: ProjectChannelBinding['channel'],
  ): void {
    const binding = this.repository
      .listProjectChannelBindings(projectId)
      .find(candidate => candidate.channel === channel)
    if (binding?.delivery === 'content-only') {
      throw new Error(
        `Content-only channel does not support publication plans: ${channel}`,
      )
    }
  }

  private assertChannelContentArtifacts(
    projectId: string,
    activityId: string,
    artifactIds: readonly string[],
    locale: Locale,
  ): void {
    const seen = new Set<string>()
    for (const artifactId of artifactIds) {
      if (seen.has(artifactId))
        throw new Error(`Duplicate channel content artifact: ${artifactId}`)
      seen.add(artifactId)
      const artifact = this.repository.getActivityArtifact(projectId, artifactId)
      if (artifact === undefined)
        throw new RecordNotFoundError('Activity artifact', artifactId)
      if (artifact.activityId !== activityId) {
        throw new Error(
          'Channel content artifacts must belong to the activity',
        )
      }
      if (
        artifact.locale !== undefined
        && artifact.locale !== 'neutral'
        && artifact.locale !== locale
      ) {
        throw new Error(
          'Channel content artifact locale must match the content locale or be neutral',
        )
      }
    }
  }

  private assertChannelContentMediaArtifacts(
    projectId: string,
    activityId: string,
    artifactIds: readonly string[],
    locale: Locale,
  ): void {
    this.assertChannelContentArtifacts(projectId, activityId, artifactIds, locale)
    for (const artifactId of artifactIds) {
      const artifact = this.repository.getActivityArtifact(projectId, artifactId)
      if (artifact !== undefined && !isFinalMediaArtifactKind(artifact.kind)) {
        throw new Error(
          'Channel content media references must use final image/video artifacts',
        )
      }
    }
  }

  private assertChannelContentPublicationReadiness(
    content: ChannelContent,
  ): void {
    this.assertChannelContentArtifacts(
      content.projectId,
      content.activityId,
      content.artifactIds,
      content.locale,
    )
    const readiness = this.contentReadiness(content)
    if (!readiness.ready) {
      throw new Error(
        `Channel content ${content.contentId} is not ready for publication: ${readiness.reason}`,
      )
    }
  }

  private contentReadiness(content: ChannelContent): ChannelContentReadiness {
    const artifacts = latestById(
      this.repository.listActivityArtifacts(
        content.projectId,
        content.activityId,
      ),
      artifact => artifact.artifactId,
    )
    return assessChannelContentReadiness(
      content.channel,
      content.format,
      content.artifactIds,
      artifacts,
      content.locale,
    )
  }

  private attachActivityArtifactsToChannelContent(
    projectId: string,
    contentId: string,
    artifactIds: readonly string[],
  ): ChannelContent {
    const content = this.repository.getChannelContent(projectId, contentId)
    if (content === undefined)
      throw new RecordNotFoundError('Channel content', contentId)
    const nextArtifactIds = [...new Set([...content.artifactIds, ...artifactIds])]
    if (nextArtifactIds.length === content.artifactIds.length)
      return content
    this.assertChannelContentArtifacts(
      projectId,
      content.activityId,
      nextArtifactIds,
      content.locale,
    )
    return this.repository.saveChannelContent({
      ...content,
      artifactIds: nextArtifactIds,
      version: content.version + 1,
    })
  }

  /**
   * A Bilibili video content item has exactly one upload video. Keep any
   * accompanying cover/GIF references, but replace a previous final video so
   * a stale WebM can never make the package ambiguous or exceed Bilibili's
   * one-video requirement.
   */
  private replaceActivityVideoInChannelContent(
    projectId: string,
    contentId: string,
    artifactIds: readonly string[],
  ): ChannelContent {
    const content = this.repository.getChannelContent(projectId, contentId)
    if (content === undefined)
      throw new RecordNotFoundError('Channel content', contentId)
    const existingPlan = this.repository.listPublicationPlans(projectId)
      .find(plan => plan.contentId === contentId)
    if (existingPlan !== undefined) {
      throw new Error(
        `Channel content ${contentId} cannot be revised after publication plan ${existingPlan.publicationId}`,
      )
    }
    const existingVideoArtifactIds = new Set(content.artifactIds.filter((artifactId) => {
      const artifact = this.repository.getActivityArtifact(projectId, artifactId)
      return artifact?.kind === 'video'
    }))
    const nextArtifactIds = [
      ...content.artifactIds.filter(artifactId => !existingVideoArtifactIds.has(artifactId)),
      ...artifactIds,
    ]
    this.assertChannelContentArtifacts(
      projectId,
      content.activityId,
      nextArtifactIds,
      content.locale,
    )
    return this.repository.saveChannelContent({
      ...content,
      artifactIds: [...new Set(nextArtifactIds)],
      version: content.version + 1,
    })
  }

  private assertActivityVideo(
    video: PublishingActivity['video'],
    snapshot: ProjectSnapshot,
  ): void {
    if (video === undefined)
      return
    if (video.flowIds.length === 0)
      throw new Error('Activity video requires at least one capture flow')
    if (new Set(video.flowIds).size !== video.flowIds.length)
      throw new Error('Activity video flow ids must be unique')
    if (!['landscape', 'portrait', 'square'].includes(video.format))
      throw new Error(`Unsupported activity video format: ${video.format}`)
    if (video.recordingProfile !== undefined) {
      validateVideoRecordingProfile(
        video.recordingProfile,
        video.format,
        snapshot.manifest.locales,
      )
    }
    if (video.planVersion !== undefined
      && (!Number.isInteger(video.planVersion) || video.planVersion < 1)) {
      throw new Error('Activity video planVersion must be a positive integer')
    }
    const flowIds = new Set(snapshot.manifest.captureFlows.map(flow => flow.id))
    for (const flowId of video.flowIds) {
      if (!flowIds.has(flowId))
        throw new Error(`Activity video references unknown capture flow: ${flowId}`)
    }
    if (video.outline !== undefined) {
      if (video.outline.length === 0)
        throw new Error('Activity video outline must not be empty')
      const outlinedFlows = new Set<string>()
      for (const scene of video.outline) {
        if (!flowIds.has(scene.flowId))
          throw new Error(`Activity video outline references unknown capture flow: ${scene.flowId}`)
        if (outlinedFlows.has(scene.flowId))
          throw new Error(`Activity video outline flow ids must be unique: ${scene.flowId}`)
        outlinedFlows.add(scene.flowId)
      }
    }
  }

  private createProductionTask(content: ChannelContent): void {
    const taskId = `production-${content.contentId}`
    if (this.taskStore.getTask(content.projectId, taskId) !== undefined)
      return
    this.taskStore.createTask({
      activityId: content.activityId,
      channel: content.channel,
      contentId: content.contentId,
      kind: 'production',
      productionType: content.format === 'video' ? 'video' : 'article',
      projectId: content.projectId,
      taskId,
    })
  }

  private createPublicationTask(plan: PublicationPlan): void {
    const taskId = `publication-${plan.publicationId}`
    if (this.taskStore.getTask(plan.projectId, taskId) !== undefined)
      return
    this.taskStore.createTask({
      activityId: plan.activityId,
      channel: plan.channel,
      contentId: plan.contentId,
      kind: 'publication',
      projectId: plan.projectId,
      taskId,
    })
  }

  private createMonitoringTask(receipt: PublicationReceipt): void {
    const taskId = `monitoring-${receipt.publicationId}`
    if (this.taskStore.getTask(receipt.projectId, taskId) !== undefined)
      return
    this.taskStore.createTask({
      activityId: receipt.activityId,
      channel: receipt.channel,
      contentId: this.requirePublicationPlan(receipt.projectId, receipt.publicationId).contentId,
      kind: 'monitoring',
      projectId: receipt.projectId,
      taskId,
    })
  }
}

function isValidVideoOrientation(
  packageValue: MarketingOpsPublicationPackage,
): boolean {
  if (
    packageValue.videoOrientation !== undefined
    && packageValue.videoOrientation !== 'landscape'
    && packageValue.videoOrientation !== 'portrait'
    && packageValue.videoOrientation !== 'square'
  ) {
    return false
  }
  if (packageValue.contentFormat !== 'video')
    return packageValue.videoOrientation === undefined
  return packageValue.channel !== 'bilibili'
    || packageValue.videoOrientation === 'landscape'
    || packageValue.videoOrientation === 'portrait'
}

function toRecordingAttemptRecord(
  receipt: RecorderAttemptReceipt,
): RecordingAttemptRecord {
  const { artifactDirectory: _artifactDirectory, ...record } = receipt
  return record
}

function samePublicationReceipt(
  existing: PublicationReceipt,
  requested: PublicationReceipt,
): boolean {
  return existing.receiptId === requested.receiptId
    && existing.projectId === requested.projectId
    && existing.activityId === requested.activityId
    && existing.channel === requested.channel
    && existing.publicationId === requested.publicationId
    && existing.status === requested.status
    && existing.source === requested.source
    && existing.externalReceiptId === requested.externalReceiptId
    && existing.publicUrl === requested.publicUrl
    && existing.accountRef === requested.accountRef
    && existing.issuedAt === requested.issuedAt
    && existing.contentSha256 === requested.contentSha256
    && existing.videoOrientation === requested.videoOrientation
}

function marketingOpsHandoffId(
  packageValue: MarketingOpsPublicationPackage,
  issuedAt: Date,
): string {
  const digest = createHash('sha256')
    .update(`${packageValue.packageId}:${packageValue.contentHash}:${issuedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 24)
  return `marketing-ops-${digest}`
}

function compositionEventKind(
  kind: CompositionProgressEvent['kind'],
): CompositionTaskEventKind {
  return kind === 'video-ready'
    ? 'composition-video-ready'
    : kind === 'cover-ready'
      ? 'composition-cover-ready'
      : 'composition-gif-ready'
}

function compositionProgressMessage(
  kind: CompositionProgressEvent['kind'],
): string {
  return kind === 'video-ready'
    ? 'Final video ready'
    : kind === 'cover-ready'
      ? 'Cover ready'
      : 'GIF preview ready'
}

function isFinalMediaArtifactKind(
  kind: ActivityArtifact['kind'],
): boolean {
  return kind === 'image' || kind === 'video'
}

function compositionArtifactFromProgress(
  taskId: string,
  event: CompositionProgressEvent,
  outputSize: VideoViewport,
): CompositionArtifact {
  if (event.kind === 'video-ready') {
    return {
      artifactId: `composed-${taskId}`,
      durationSeconds: event.artifact.durationSeconds,
      height: outputSize.height,
      kind: 'video',
      sha256: event.artifact.sha256,
      sizeBytes: event.artifact.sizeBytes,
      width: outputSize.width,
    }
  }
  if (event.kind === 'cover-ready') {
    return {
      artifactId: `cover-${taskId}`,
      height: event.artifact.height,
      kind: 'cover',
      sha256: event.artifact.sha256,
      sizeBytes: event.artifact.sizeBytes,
      width: event.artifact.width,
    }
  }
  return {
    artifactId: `gif-${taskId}`,
    durationSeconds: event.artifact.durationSeconds,
    fps: event.artifact.fps,
    height: event.artifact.height,
    kind: 'gif',
    sha256: event.artifact.sha256,
    sizeBytes: event.artifact.sizeBytes,
    width: event.artifact.width,
  }
}

function compositionArtifactsFromResult(
  taskId: string,
  result: ComposeProductionResult,
  compositionRoot: string,
  outputSize: VideoViewport,
): CompositionArtifact[] {
  const artifacts: CompositionArtifact[] = [{
    ...compositionArtifactFromProgress(
      taskId,
      { artifact: result, kind: 'video-ready' },
      outputSize,
    ),
    relativePath: compositionRelativePath(compositionRoot, result.artifactPath),
  }]
  if (result.cover !== undefined) {
    artifacts.push({
      ...compositionArtifactFromProgress(
        taskId,
        { artifact: result.cover, kind: 'cover-ready' },
        outputSize,
      ),
      relativePath: compositionRelativePath(compositionRoot, result.cover.artifactPath),
    })
  }
  if (result.gif !== undefined) {
    artifacts.push({
      ...compositionArtifactFromProgress(
        taskId,
        { artifact: result.gif, kind: 'gif-ready' },
        outputSize,
      ),
      relativePath: compositionRelativePath(compositionRoot, result.gif.artifactPath),
    })
  }
  return artifacts
}

function bilibiliCompositionArtifact(
  taskId: string,
  attempt: number,
  result: BilibiliVideoExportResult,
  compositionRoot: string,
): CompositionArtifact {
  const relativePath = compositionRelativePath(
    compositionRoot,
    result.artifactPath,
  )
  return {
    artifactId: `bilibili-${taskId}-${attempt}`,
    durationSeconds: result.durationSeconds,
    kind: 'video',
    relativePath,
    sha256: result.sha256,
    sizeBytes: result.sizeBytes,
  }
}

function assertBilibiliUploadVariant(
  result: BilibiliVideoExportResult,
  expectedPath: string,
): void {
  if (
    resolve(result.artifactPath) !== resolve(expectedPath)
    || !/^[a-f0-9]{64}$/u.test(result.sha256)
    || !Number.isFinite(result.durationSeconds)
    || result.durationSeconds <= 0
    || !Number.isInteger(result.sizeBytes)
    || result.sizeBytes <= 0
  ) {
    throw new Error('Bilibili video upload variant is invalid')
  }
}

function getScopedRecord<T extends { projectId: string }>(
  records: Map<string, T>,
  projectId: string,
  recordId: string,
): T | undefined {
  const record = records.get(recordId)
  if (record === undefined)
    return undefined
  if (record.projectId !== projectId)
    throw new ProjectScopeError(projectId, recordId)
  return clone(record)
}

function latestById<T extends { version: number }>(
  records: T[],
  getId: (record: T) => string,
): T[] {
  const latest = new Map<string, T>()
  for (const record of records) {
    const id = getId(record)
    const previous = latest.get(id)
    if (previous === undefined || record.version > previous.version)
      latest.set(id, record)
  }
  return [...latest.values()]
    .sort((left, right) => getId(left).localeCompare(getId(right)))
    .map(record => clone(record))
}

function versionKey(recordId: string, version: number): string {
  return `${recordId}:${version}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function cloneOrUndefined<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : clone(value)
}

function toPortableRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

function compositionRelativePath(
  compositionRoot: string,
  artifactPath: string,
): string {
  const relativePath = toPortableRelativePath(
    relative(compositionRoot, artifactPath),
  )
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(
      'Composition artifact path must stay inside the controlled output',
    )
  }
  return relativePath
}

function isSafeRelativePath(path: string): boolean {
  return path.trim() !== ''
    && !path.startsWith('/')
    && !/^[A-Za-z]:\//u.test(path)
    && !path.split('/').includes('..')
}

function assertOwnerConfirmationUrl(publicUrl: string): void {
  let url: URL
  try {
    url = new URL(publicUrl)
  }
  catch {
    throw new Error('Owner confirmation URL must be HTTPS')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '')
    throw new Error('Owner confirmation URL must be HTTPS')
}
