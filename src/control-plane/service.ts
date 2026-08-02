import type {
  ActivityArtifact,
  ActivityRevisionInput,
  ChannelContent,
  ContentGroup,
  ContentStudioProjectView,
  ContentStudioReport,
  CreateActivityArtifactInput,
  CreateChannelContentInput,
  CreateContentGroupInput,
  CreatePublishingActivityInput,
  ExecutionTask,
  ExecutionTaskEvent,
  ExecutionTaskStore,
  MonitoringObservation,
  OwnerHandoff,
  ProjectAsset,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  PromoteActivityArtifactInput,
  PublicationPlan,
  PublicationReceipt,
  PublishingActivity,
} from '../types'
import { InMemoryExecutionTaskStore } from '../jobs/task'

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

export interface ContentStudioRepository {
  saveActivity: (activity: PublishingActivity) => PublishingActivity
  saveActivityArtifact: (artifact: ActivityArtifact) => ActivityArtifact
  saveChannelContent: (content: ChannelContent) => ChannelContent
  saveContentGroup: (group: ContentGroup) => ContentGroup
  saveProject: (project: ProjectRecord) => ProjectRecord
  saveProjectAsset: (asset: ProjectAsset) => ProjectAsset
  saveProjectChannelBinding: (
    binding: ProjectChannelBinding,
  ) => ProjectChannelBinding
  saveProjectSnapshot: (snapshot: ProjectSnapshot) => ProjectSnapshot
  saveOwnerHandoff: (handoff: OwnerHandoff) => OwnerHandoff
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
  listProjectAssets: (projectId: string) => ProjectAsset[]
  listProjectChannelBindings: (projectId: string) => ProjectChannelBinding[]
  listActivities: (projectId: string) => PublishingActivity[]
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
    const tasks = this.taskStore.listTasks(projectId)
    return {
      activities,
      channelContents: latestById(
        this.repository.listChannelContents(projectId),
        content => content.contentId,
      ),
      contentGroups: latestById(
        this.repository.listContentGroups(projectId),
        group => group.contentGroupId,
      ),
      project,
      projectAssets: this.repository.listProjectAssets(projectId),
      projectChannelBindings: this.repository.listProjectChannelBindings(projectId),
      snapshot,
      taskEvents: Object.fromEntries(tasks.map(task => [
        task.taskId,
        this.taskStore.listEvents(projectId, task.taskId),
      ])),
      tasks,
    }
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

  bindProjectChannel(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    this.requireProject(binding.projectId)
    return this.repository.saveProjectChannelBinding(binding)
  }

  createActivity(
    input: CreatePublishingActivityInput,
  ): PublishingActivity {
    this.requireProject(input.projectId)
    this.requireSnapshot(input.projectId, input.projectSnapshotId)
    this.assertEnabledChannels(input.projectId, input.channels)
    const activity = this.repository.saveActivity({
      ...input,
      version: 1,
    })
    this.taskStore.createTask({
      activityId: activity.activityId,
      kind: 'production',
      projectId: activity.projectId,
      taskId: `production-${activity.activityId}`,
    })
    return activity
  }

  cancelTask(projectId: string, taskId: string): ExecutionTask {
    this.requireProject(projectId)
    return this.taskStore.cancelTask(projectId, taskId)
  }

  retryTask(projectId: string, taskId: string): ExecutionTask {
    this.requireProject(projectId)
    return this.taskStore.retryTask(projectId, taskId)
  }

  listTaskEvents(projectId: string, taskId: string): ExecutionTaskEvent[] {
    this.requireProject(projectId)
    return this.taskStore.listEvents(projectId, taskId)
  }

  reviseActivity(input: ActivityRevisionInput): PublishingActivity {
    const current = this.requireActivity(input.projectId, input.activityId)
    if (current.version !== input.baseVersion) {
      throw new Error(
        `Activity ${input.activityId} has moved past version ${input.baseVersion}`,
      )
    }
    return this.repository.saveActivity({
      ...current,
      topic: input.topic,
      version: current.version + 1,
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
    if (!activity.channels.some(channel => channel.id === input.channel))
      throw new Error('Channel content must target an activity channel')
    this.assertEnabledChannels(input.projectId, [
      {
        id: input.channel,
        locale: input.locale,
      },
    ])
    return this.repository.saveChannelContent({
      ...input,
      version: 1,
    })
  }

  createActivityArtifact(
    input: CreateActivityArtifactInput,
  ): ActivityArtifact {
    this.requireActivity(input.projectId, input.activityId)
    return this.repository.saveActivityArtifact({
      ...input,
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
    return this.repository.savePublicationPlan(input)
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
    return this.repository.savePublicationReceipt(receipt)
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
    if (handoff.artifactChecksums.length === 0) {
      throw new Error('Owner handoff requires an artifact checksum')
    }
    if (handoff.checklist.length === 0) {
      throw new Error('Owner handoff requires a review checklist')
    }
    return this.repository.saveOwnerHandoff(handoff)
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
    return this.repository.saveMonitoringObservation(observation)
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
