// @env node

import type {
  ActivityArtifact,
  ChannelContent,
  ContentGroup,
  ContentStudioReport,
  MonitoringObservation,
  OwnerHandoff,
  ProjectAsset,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  PublicationPlan,
  PublicationReceipt,
  PublishingActivity,
} from '../types'
import type {
  ContentStudioRepository,
} from './service'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  CONTENT_STUDIO_RECORD_TYPES,
} from '../constants'
import {
  InMemoryContentStudioRepository,
} from './service'

interface PersistedRow {
  payload: string
  record_type: string
}

export class SqliteContentStudioRepository
  extends InMemoryContentStudioRepository
  implements ContentStudioRepository {
  readonly databasePath: string

  private readonly database: DatabaseSync

  private isClosed = false

  constructor(databasePath: string) {
    super()
    if (databasePath !== ':memory:')
      mkdirSync(dirname(databasePath), { recursive: true })
    this.databasePath = databasePath
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS content_studio_records (
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (record_type, record_id, version)
      );
      CREATE INDEX IF NOT EXISTS content_studio_records_project_idx
        ON content_studio_records (project_id, record_type);
    `)
    this.loadRecords()
  }

  override saveActivity(activity: PublishingActivity): PublishingActivity {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.activity,
      activity,
      value => super.saveActivity(value),
    )
  }

  override saveActivityArtifact(artifact: ActivityArtifact): ActivityArtifact {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.activityArtifact,
      artifact,
      value => super.saveActivityArtifact(value),
    )
  }

  override saveChannelContent(content: ChannelContent): ChannelContent {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.channelContent,
      content,
      value => super.saveChannelContent(value),
    )
  }

  override saveContentGroup(group: ContentGroup): ContentGroup {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.contentGroup,
      group,
      value => super.saveContentGroup(value),
    )
  }

  override saveOwnerHandoff(handoff: OwnerHandoff): OwnerHandoff {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.ownerHandoff,
      handoff,
      value => super.saveOwnerHandoff(value),
    )
  }

  override updateOwnerHandoff(handoff: OwnerHandoff): OwnerHandoff {
    const saved = super.updateOwnerHandoff(handoff)
    const recordType = CONTENT_STUDIO_RECORD_TYPES.ownerHandoff
    const recordIdValue = recordId(recordType, saved)
    this.database
      .prepare(`
        DELETE FROM content_studio_records
        WHERE record_type = ? AND record_id = ?
      `)
      .run(recordType, recordIdValue)
    this.database
      .prepare(`
        INSERT INTO content_studio_records
          (record_type, record_id, version, project_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        recordType,
        recordIdValue,
        recordVersion(saved),
        saved.projectId,
        JSON.stringify(saved),
      )
    return saved
  }

  override saveMonitoringObservation(
    observation: MonitoringObservation,
  ): MonitoringObservation {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.monitoringObservation,
      observation,
      value => super.saveMonitoringObservation(value),
    )
  }

  override saveProject(project: ProjectRecord): ProjectRecord {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.project,
      project,
      value => super.saveProject(value),
    )
  }

  override updateProject(project: ProjectRecord): ProjectRecord {
    const saved = super.updateProject(project)
    const recordType = CONTENT_STUDIO_RECORD_TYPES.project
    const recordIdValue = recordId(recordType, saved)
    this.database
      .prepare(`
        DELETE FROM content_studio_records
        WHERE record_type = ? AND record_id = ?
      `)
      .run(recordType, recordIdValue)
    this.database
      .prepare(`
        INSERT INTO content_studio_records
          (record_type, record_id, version, project_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        recordType,
        recordIdValue,
        recordVersion(saved),
        saved.projectId,
        JSON.stringify(saved),
      )
    return saved
  }

  override saveProjectAsset(asset: ProjectAsset): ProjectAsset {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.projectAsset,
      asset,
      value => super.saveProjectAsset(value),
    )
  }

  override saveProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.projectChannelBinding,
      binding,
      value => super.saveProjectChannelBinding(value),
    )
  }

  override updateProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    const saved = super.updateProjectChannelBinding(binding)
    const recordType = CONTENT_STUDIO_RECORD_TYPES.projectChannelBinding
    const recordIdValue = recordId(recordType, saved)
    this.database
      .prepare(`
        DELETE FROM content_studio_records
        WHERE record_type = ? AND record_id = ?
      `)
      .run(recordType, recordIdValue)
    this.database
      .prepare(`
        INSERT INTO content_studio_records
          (record_type, record_id, version, project_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        recordType,
        recordIdValue,
        recordVersion(saved),
        saved.projectId,
        JSON.stringify(saved),
      )
    return saved
  }

  override setProjectChannelBinding(
    binding: ProjectChannelBinding,
  ): ProjectChannelBinding {
    const saved = super.setProjectChannelBinding(binding)
    const recordType = CONTENT_STUDIO_RECORD_TYPES.projectChannelBinding
    const recordIdValue = recordId(recordType, saved)
    this.database
      .prepare(`
        DELETE FROM content_studio_records
        WHERE record_type = ? AND record_id = ?
      `)
      .run(recordType, recordIdValue)
    this.database
      .prepare(`
        INSERT INTO content_studio_records
          (record_type, record_id, version, project_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        recordType,
        recordIdValue,
        recordVersion(saved),
        saved.projectId,
        JSON.stringify(saved),
      )
    return saved
  }

  override saveProjectSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.projectSnapshot,
      snapshot,
      value => super.saveProjectSnapshot(value),
    )
  }

  override savePublicationPlan(plan: PublicationPlan): PublicationPlan {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.publicationPlan,
      plan,
      value => super.savePublicationPlan(value),
    )
  }

  override savePublicationReceipt(
    receipt: PublicationReceipt,
  ): PublicationReceipt {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.publicationReceipt,
      receipt,
      value => super.savePublicationReceipt(value),
    )
  }

  override saveReport(report: ContentStudioReport): ContentStudioReport {
    return this.persist(
      CONTENT_STUDIO_RECORD_TYPES.report,
      report,
      value => super.saveReport(value),
    )
  }

  close(): void {
    if (this.isClosed)
      return
    this.database.close()
    this.isClosed = true
  }

  private loadRecords(): void {
    const rows = this.database
      .prepare(`
        SELECT payload, record_type
        FROM content_studio_records
        ORDER BY record_type, record_id, version
      `)
      .all() as unknown as PersistedRow[]

    for (const row of rows)
      this.hydrate(row.record_type, JSON.parse(row.payload) as PersistedRecord)
  }

  private hydrate(recordType: string, record: PersistedRecord): void {
    switch (recordType) {
      case CONTENT_STUDIO_RECORD_TYPES.activity:
        super.saveActivity(record as PublishingActivity)
        break
      case CONTENT_STUDIO_RECORD_TYPES.activityArtifact:
        super.saveActivityArtifact(record as ActivityArtifact)
        break
      case CONTENT_STUDIO_RECORD_TYPES.channelContent:
        super.saveChannelContent(record as ChannelContent)
        break
      case CONTENT_STUDIO_RECORD_TYPES.contentGroup:
        super.saveContentGroup(record as ContentGroup)
        break
      case CONTENT_STUDIO_RECORD_TYPES.monitoringObservation:
        super.saveMonitoringObservation(record as MonitoringObservation)
        break
      case CONTENT_STUDIO_RECORD_TYPES.ownerHandoff:
        super.saveOwnerHandoff(record as OwnerHandoff)
        break
      case CONTENT_STUDIO_RECORD_TYPES.project:
        super.saveProject(record as ProjectRecord)
        break
      case CONTENT_STUDIO_RECORD_TYPES.projectAsset:
        super.saveProjectAsset(record as ProjectAsset)
        break
      case CONTENT_STUDIO_RECORD_TYPES.projectChannelBinding:
        super.saveProjectChannelBinding(record as ProjectChannelBinding)
        break
      case CONTENT_STUDIO_RECORD_TYPES.projectSnapshot:
        super.saveProjectSnapshot(record as ProjectSnapshot)
        break
      case CONTENT_STUDIO_RECORD_TYPES.publicationPlan:
        super.savePublicationPlan(record as PublicationPlan)
        break
      case CONTENT_STUDIO_RECORD_TYPES.publicationReceipt:
        super.savePublicationReceipt(record as PublicationReceipt)
        break
      case CONTENT_STUDIO_RECORD_TYPES.report:
        super.saveReport(record as ContentStudioReport)
        break
      default:
        throw new Error(`Unknown Content Studio record type: ${recordType}`)
    }
  }

  private persist<T extends PersistedRecord>(
    recordType: string,
    record: T,
    save: (value: T) => T,
  ): T {
    const saved = save(record)
    this.database
      .prepare(`
        INSERT INTO content_studio_records
          (record_type, record_id, version, project_id, payload)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        recordType,
        recordId(recordType, saved),
        recordVersion(saved),
        saved.projectId,
        JSON.stringify(saved),
      )
    return saved
  }
}

type PersistedRecord
  = | ActivityArtifact
    | ChannelContent
    | ContentGroup
    | ContentStudioReport
    | MonitoringObservation
    | OwnerHandoff
    | ProjectAsset
    | ProjectChannelBinding
    | ProjectRecord
    | ProjectSnapshot
    | PublicationPlan
    | PublicationReceipt
    | PublishingActivity

function recordId(recordType: string, record: PersistedRecord): string {
  switch (recordType) {
    case CONTENT_STUDIO_RECORD_TYPES.activity:
      return (record as PublishingActivity).activityId
    case CONTENT_STUDIO_RECORD_TYPES.activityArtifact:
      return (record as ActivityArtifact).artifactId
    case CONTENT_STUDIO_RECORD_TYPES.channelContent:
      return (record as ChannelContent).contentId
    case CONTENT_STUDIO_RECORD_TYPES.contentGroup:
      return (record as ContentGroup).contentGroupId
    case CONTENT_STUDIO_RECORD_TYPES.monitoringObservation:
      return (record as MonitoringObservation).observationId
    case CONTENT_STUDIO_RECORD_TYPES.ownerHandoff:
      return (record as OwnerHandoff).handoffId
    case CONTENT_STUDIO_RECORD_TYPES.project:
      return (record as ProjectRecord).projectId
    case CONTENT_STUDIO_RECORD_TYPES.projectAsset:
      return (record as ProjectAsset).assetId
    case CONTENT_STUDIO_RECORD_TYPES.projectChannelBinding: {
      const binding = record as ProjectChannelBinding
      return `${binding.projectId}:${binding.channel}`
    }
    case CONTENT_STUDIO_RECORD_TYPES.projectSnapshot:
      return (record as ProjectSnapshot).snapshotId
    case CONTENT_STUDIO_RECORD_TYPES.publicationPlan:
      return (record as PublicationPlan).publicationId
    case CONTENT_STUDIO_RECORD_TYPES.publicationReceipt:
      return (record as PublicationReceipt).receiptId
    case CONTENT_STUDIO_RECORD_TYPES.report:
      return (record as ContentStudioReport).reportId
    default:
      throw new Error(`Unknown Content Studio record type: ${recordType}`)
  }
}

function recordVersion(record: PersistedRecord): number {
  return 'version' in record ? record.version : 1
}
