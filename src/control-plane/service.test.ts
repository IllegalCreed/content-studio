import type {
  CaptureFlow,
  ChannelContentFormat,
  ChannelId,
  ContentStudioReport,
  MonitoringObservation,
  OwnerHandoff,
  ProjectChannelBinding,
  ProjectRecord,
  ProjectSnapshot,
  RecorderAttemptReceipt,
} from '../types'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANNEL_BLUEPRINTS } from '../constants'
import { InMemoryExecutionTaskStore } from '../jobs/task'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
  ProjectScopeError,
  RecordNotFoundError,
} from './service'

function registerProject(
  service: ContentStudioApplicationService,
  projectId: string,
  captureFlows: CaptureFlow[] = [],
  integration: Pick<ProjectRecord, 'captureMode' | 'ownerTakeover' | 'repeatability' | 'sourceAccess'> = {
    captureMode: 'deterministic',
    repeatability: 'high',
    sourceAccess: 'source-owned',
  },
): { project: ProjectRecord, snapshot: ProjectSnapshot } {
  const snapshot: ProjectSnapshot = {
    manifest: {
      canonicalUrl: `https://${projectId}.example.com/`,
      captureFlows,
      facts: [],
      locales: ['en'],
      name: projectId,
      projectId,
      repositoryUrl: `https://github.com/example/${projectId}`,
      schemaVersion: 1,
      tagline: {
        'en': projectId,
        'zh-CN': projectId,
      },
      ...integration,
    },
    projectId,
    snapshotId: `${projectId}-snapshot-1`,
    version: 1,
  }
  const project: ProjectRecord = {
    captureMode: integration.captureMode,
    currentSnapshotId: snapshot.snapshotId,
    name: projectId,
    projectId,
    ...(integration.ownerTakeover === true ? { ownerTakeover: true } : {}),
    repeatability: integration.repeatability,
    sourceAccess: integration.sourceAccess,
  }
  service.registerProject(project, snapshot)
  return { project, snapshot }
}

function enableYouTube(
  service: ContentStudioApplicationService,
  projectId: string,
  accountRef?: string,
): ProjectChannelBinding {
  return service.bindProjectChannel({
    ...(accountRef === undefined ? {} : { accountRef }),
    channel: 'youtube',
    delivery: 'owner-assisted',
    enabled: true,
    projectId,
  })
}

function createActivity(
  service: ContentStudioApplicationService,
  projectId = 'project-a',
  activityId = `${projectId}-activity`,
) {
  return service.createActivity({
    activityId,
    campaignId: `${projectId}-campaign`,
    channels: [
      {
        id: 'youtube',
        locale: 'en',
      },
    ],
    goal: 'education',
    projectId,
    projectSnapshotId: `${projectId}-snapshot-1`,
    status: 'draft',
    targetUrl: `https://${projectId}.example.com/`,
    topic: {
      'en': 'A topic',
      'zh-CN': '主题',
    },
  })
}

function createPublication(
  service: ContentStudioApplicationService,
  projectId = 'project-a',
): {
  activity: ReturnType<typeof createActivity>
  publication: ReturnType<ContentStudioApplicationService['createPublicationPlan']>
} {
  const activity = createActivity(service, projectId)
  const group = service.createContentGroup({
    activityId: activity.activityId,
    contentGroupId: `${projectId}-report-group`,
    coreMessage: 'Explain the idea',
    projectId,
    title: 'Quick sort',
  })
  const content = service.createChannelContent({
    activityId: activity.activityId,
    artifactIds: [registerFinalVideoArtifact(
      service,
      activity,
      `${projectId}-report-video`,
    )],
    body: 'A video script',
    channel: 'youtube',
    contentGroupId: group.contentGroupId,
    contentId: `${projectId}-report-content`,
    format: 'video',
    locale: 'en',
    projectId,
    title: 'Quick sort explained',
  })
  const publication = service.createPublicationPlan({
    activityId: activity.activityId,
    channel: 'youtube',
    contentId: content.contentId,
    projectId,
    publicationId: `${projectId}-report-publication`,
  })
  return { activity, publication }
}

function registerFinalVideoArtifact(
  service: ContentStudioApplicationService,
  activity: ReturnType<typeof createActivity>,
  artifactId: string,
): string {
  service.createActivityArtifact({
    activityId: activity.activityId,
    artifactId,
    kind: 'video',
    projectId: activity.projectId,
    relativePath: `composed/${artifactId}.webm`,
    sha256: 'f'.repeat(64),
  })
  return artifactId
}

function createProductionContent(
  service: ContentStudioApplicationService,
  activity: ReturnType<typeof createActivity>,
  format: ChannelContentFormat = 'video',
  channel: ChannelId = 'youtube',
  contentId = `${activity.activityId}-content`,
): string {
  const group = service.createContentGroup({
    activityId: activity.activityId,
    contentGroupId: `${activity.activityId}-group-${contentId}`,
    coreMessage: 'Explain the idea',
    projectId: activity.projectId,
    title: '内容组',
  })
  const content = service.createChannelContent({
    activityId: activity.activityId,
    artifactIds: [],
    body: 'Content body',
    channel,
    contentGroupId: group.contentGroupId,
    contentId,
    format,
    locale: 'en',
    projectId: activity.projectId,
    title: 'Content',
  })
  return content.contentId
}

describe('content studio application service', () => {
  it('updates a project registration with a bumped snapshot version', () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    const first = registerProject(service, 'project-a')
    const updatedSnapshot: ProjectSnapshot = {
      ...first.snapshot,
      manifest: {
        ...first.snapshot.manifest,
        facts: [{
          id: 'demo-fact',
          text: {
            'en': 'Demo fact',
            'zh-CN': '演示事实',
          },
        }],
      },
      snapshotId: 'project-a-snapshot-2',
      version: 2,
    }
    const updatedProject: ProjectRecord = {
      ...first.project,
      currentSnapshotId: updatedSnapshot.snapshotId,
    }

    expect(service.updateProjectRegistration(updatedProject, updatedSnapshot))
      .toMatchObject({ currentSnapshotId: 'project-a-snapshot-2' })
    expect(service.getProjectView('project-a').project.currentSnapshotId)
      .toBe('project-a-snapshot-2')
  })

  it('rejects a project registration update with mismatched ownership', () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    const first = registerProject(service, 'project-a')
    const otherSnapshot: ProjectSnapshot = {
      ...first.snapshot,
      snapshotId: 'other-snapshot',
    }
    expect(() => service.updateProjectRegistration(
      first.project,
      otherSnapshot,
    )).toThrow(/ownership must match/)
  })

  it('rejects updating a missing project record', () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    const record: ProjectRecord = {
      captureMode: 'deterministic',
      currentSnapshotId: 'missing-snapshot',
      name: 'missing',
      projectId: 'missing',
      repeatability: 'high',
      sourceAccess: 'source-owned',
    }
    expect(() => service.updateProjectRegistration(record, {
      manifest: {
        canonicalUrl: 'https://missing.example.com/',
        captureFlows: [],
        facts: [],
        locales: ['en'],
        name: 'missing',
        projectId: 'missing',
        repositoryUrl: 'https://github.com/example/missing',
        schemaVersion: 1,
        tagline: {
          'en': 'missing',
          'zh-CN': 'missing',
        },
      },
      projectId: 'missing',
      snapshotId: 'missing-snapshot',
      version: 1,
    })).toThrow(RecordNotFoundError)
  })

  it('lists only explicitly registered projects with cross-project summaries', () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    registerProject(service, 'project-b', [{
      id: 'intro',
      startPath: '/',
      steps: [],
      title: { 'en': 'Intro', 'zh-CN': '介绍' },
    }])
    registerProject(service, 'project-a')
    service.bindProjectChannel({
      accountAlias: '项目视频账号',
      accountRef: 'opaque-account-ref',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-b',
    })
    taskStore.createTask({
      activityId: 'project-b-activity',
      kind: 'production',
      productionType: 'video',
      projectId: 'project-b',
      taskId: 'project-b-task',
    })

    expect(service.listProjects()).toEqual([
      {
        activityCount: 0,
        enabledChannels: [],
        previewReady: false,
        project: expect.objectContaining({ projectId: 'project-a' }),
        snapshotId: 'project-a-snapshot-1',
        snapshotVersion: 1,
        taskCount: 0,
        taskCounts: { monitoring: 0, production: 0, publication: 0 },
      },
      {
        activityCount: 0,
        enabledChannels: [{
          accountAlias: '项目视频账号',
          channel: 'youtube',
          delivery: 'owner-assisted',
        }],
        previewReady: true,
        project: expect.objectContaining({ projectId: 'project-b' }),
        snapshotId: 'project-b-snapshot-1',
        snapshotVersion: 1,
        taskCount: 1,
        taskCounts: { monitoring: 0, production: 1, publication: 0 },
      },
    ])
  })

  it('builds a sanitized global view from every explicitly registered project', () => {
    const repository = new InMemoryContentStudioRepository()
    const taskStore = new InMemoryExecutionTaskStore()
    const service = new ContentStudioApplicationService(repository, taskStore)
    registerProject(service, 'project-b', [{
      id: 'intro',
      startPath: '/',
      steps: [],
      title: { 'en': 'Intro', 'zh-CN': '介绍' },
    }])
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    enableYouTube(service, 'project-b')
    const projectAActivity = createActivity(service, 'project-a')
    const projectBActivity = createActivity(service, 'project-b')
    taskStore.createTask({
      activityId: projectBActivity.activityId,
      channel: 'youtube',
      kind: 'production',
      productionType: 'video',
      projectId: 'project-b',
      taskId: 'production-project-b-activity',
    })
    taskStore.createTask({
      activityId: projectBActivity.activityId,
      channel: 'youtube',
      kind: 'publication',
      projectId: 'project-b',
      taskId: 'project-b-publication',
    })
    const global = service.getGlobalView()

    expect(global.projects.map(item => item.project.projectId)).toEqual([
      'project-a',
      'project-b',
    ])
    expect(global.projectViews.map(view => view.project.projectId)).toEqual([
      'project-a',
      'project-b',
    ])
    expect(global.projectViews[0]?.activities).toEqual([
      expect.objectContaining({ activityId: projectAActivity.activityId }),
    ])
    expect(global.projectViews[1]?.tasks).toEqual([
      expect.objectContaining({ projectId: 'project-b', taskId: 'production-project-b-activity' }),
      expect.objectContaining({ projectId: 'project-b', taskId: 'project-b-publication' }),
    ])
    expect(global.projectViews[1]?.projectChannelBindings).toEqual([{
      accountAlias: undefined,
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-b',
    }])
    expect(global.projectViews[1]?.projectChannelBindings[0]).not.toHaveProperty('accountRef')
  })

  it('denies cross-project reads instead of returning another project record', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    createActivity(service)

    expect(() =>
      repository.getActivity('project-b', 'project-a-activity'),
    ).toThrow(ProjectScopeError)
  })

  it('allows an activity to target only enabled project channels', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    expect(() => createActivity(service)).toThrow(/enabled channel/i)

    enableYouTube(service, 'project-a')
    expect(createActivity(service).channels).toEqual([
      {
        id: 'youtube',
        locale: 'en',
      },
    ])
  })

  it('creates production work only after content identifies its channel target', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(service.getProjectView('project-a').tasks).toEqual([])

    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'project-a-content-group',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: '内容组',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'project-a-video-content',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Video content',
    })

    expect(service.getProjectView('project-a').tasks).toEqual([
      expect.objectContaining({
        activityId: activity.activityId,
        channel: 'youtube',
        contentId: content.contentId,
        kind: 'production',
        productionType: 'video',
        status: 'queued',
        taskId: `production-${content.contentId}`,
      }),
    ])
  })

  it('maps non-video channel forms to article-like production execution', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'multi-form-project')
    enableYouTube(service, 'multi-form-project')
    const activity = createActivity(service, 'multi-form-project')
    const contentId = createProductionContent(
      service,
      activity,
      'image-text',
      'youtube',
      'multi-form-image-text',
    )

    expect(service.getProjectView('multi-form-project').channelContents)
      .toEqual([expect.objectContaining({ contentId, format: 'image-text' })])
    expect(service.getProjectView('multi-form-project').tasks)
      .toEqual([expect.objectContaining({
        contentId,
        productionType: 'article',
        taskId: `production-${contentId}`,
      })])
  })

  it('enforces the content forms selected on an activity channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'selected-form-project')
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'selected-form-project',
    })
    const activity = service.createActivity({
      activityId: 'selected-form-activity',
      campaignId: 'selected-form-campaign',
      channels: [{
        contentFormats: ['image-text'],
        id: 'bilibili',
        locale: 'en',
      }],
      goal: 'education',
      projectId: 'selected-form-project',
      projectSnapshotId: 'selected-form-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://selected-form-project.example.com/',
      topic: { 'en': 'A topic', 'zh-CN': '主题' },
    })

    expect(createProductionContent(
      service,
      activity,
      'image-text',
      'bilibili',
      'selected-image-text',
    )).toBe('selected-image-text')
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'selected-video-group',
      coreMessage: 'Video form',
      projectId: activity.projectId,
      title: 'Video form',
    })
    expect(() => service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Video body',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'selected-video',
      format: 'video',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Video',
    })).toThrow(/does not select content form.*video-metadata/i)
  })

  it('rejects empty or duplicate content form selections at the service boundary', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'invalid-form-project')
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'invalid-form-project',
    })
    const baseInput = {
      activityId: 'invalid-form-activity',
      campaignId: 'invalid-form-campaign',
      goal: 'education' as const,
      projectId: 'invalid-form-project',
      projectSnapshotId: 'invalid-form-project-snapshot-1',
      status: 'draft' as const,
      targetUrl: 'https://invalid-form-project.example.com/',
      topic: { 'en': 'A topic', 'zh-CN': '主题' },
    }

    expect(() => service.createActivity({
      ...baseInput,
      channels: [{
        contentFormats: [],
        id: 'bilibili',
        locale: 'en',
      }],
    })).toThrow(/contentFormats must not be empty/i)
    expect(() => service.createActivity({
      ...baseInput,
      channels: [{
        contentFormats: ['image-text', 'image-text'],
        id: 'bilibili',
        locale: 'en',
      }],
    })).toThrow(/duplicate channel content form/i)
  })

  it('blocks publication plans until the selected content form references final media', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'readiness-project')
    enableYouTube(service, 'readiness-project')
    const activity = createActivity(service, 'readiness-project')
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'readiness-group',
      coreMessage: 'Explain the idea',
      projectId: activity.projectId,
      title: 'Readiness',
    })
    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'readiness-clip',
      kind: 'video-clip',
      projectId: activity.projectId,
      relativePath: 'recordings/clip.webm',
      sha256: 'a'.repeat(64),
    })
    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'readiness-video',
      kind: 'video',
      projectId: activity.projectId,
      relativePath: 'composed/final.webm',
      sha256: 'b'.repeat(64),
    })
    const blocked = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: ['readiness-clip'],
      body: 'Video body',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'blocked-video-content',
      format: 'video',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Blocked video',
    })
    const ready = service.createChannelContent({
      ...blocked,
      artifactIds: ['readiness-video'],
      contentId: 'ready-video-content',
    })

    expect(service.getProjectView(activity.projectId).channelContentReadiness)
      .toMatchObject({
        'blocked-video-content': {
          matchingArtifactIds: [],
          missingMediaKinds: ['video'],
          ready: false,
        },
        'ready-video-content': {
          matchingArtifactIds: ['readiness-video'],
          missingMediaKinds: [],
          ready: true,
        },
      })
    expect(() => service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: blocked.contentId,
      projectId: activity.projectId,
      publicationId: 'blocked-video-publication',
    })).toThrow(/not ready.*video artifact.*required/i)
    expect(service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: ready.contentId,
      projectId: activity.projectId,
      publicationId: 'ready-video-publication',
    })).toMatchObject({ publicationId: 'ready-video-publication' })
  })

  it('keeps channel content artifacts in the content locale or neutral', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'locale-artifact-project')
    enableYouTube(service, 'locale-artifact-project')
    const activity = createActivity(service, 'locale-artifact-project')
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'locale-artifact-group',
      coreMessage: 'Keep localized media aligned',
      projectId: activity.projectId,
      title: 'Locale artifacts',
    })
    const chineseVideo = service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'chinese-video',
      kind: 'video',
      locale: 'zh-CN',
      projectId: activity.projectId,
      relativePath: 'media/chinese.webm',
      sha256: 'a'.repeat(64),
    })
    const neutralVideo = service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'neutral-video',
      kind: 'video',
      locale: 'neutral',
      projectId: activity.projectId,
      relativePath: 'media/neutral.webm',
      sha256: 'b'.repeat(64),
    })

    expect(chineseVideo.locale).toBe('zh-CN')
    expect(neutralVideo.locale).toBe('neutral')
    expect(() => service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [chineseVideo.artifactId],
      body: 'English video copy',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'locale-drift-content',
      format: 'video',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Locale drift',
    })).toThrow(/artifact.*locale/i)

    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [neutralVideo.artifactId],
      body: 'English video copy',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'neutral-artifact-content',
      format: 'video',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Neutral artifact',
    })
    expect(content.artifactIds).toEqual(['neutral-video'])
    expect(() => service.reviseChannelContentMedia({
      artifactIds: [chineseVideo.artifactId],
      baseVersion: content.version,
      contentId: content.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })).toThrow(/artifact.*locale/i)
  })

  it('prepares a path-free marketing-ops package without external writes', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const projectId = 'package-preparation-project'
    const canonicalLink = `https://${projectId}.example.com/guide/`
    registerProject(service, projectId)
    service.bindProjectChannel({
      accountRef: 'github-account-ref',
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId,
    })
    const activity = service.createActivity({
      activityId: 'package-preparation-activity',
      campaignId: 'package-preparation-campaign',
      channels: [{ contentFormats: ['article'], id: 'github', locale: 'en' }],
      goal: 'launch',
      projectId,
      projectSnapshotId: `${projectId}-snapshot-1`,
      status: 'draft',
      targetUrl: canonicalLink,
      topic: { 'en': 'Package preparation', 'zh-CN': '发布包准备' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'package-preparation-group',
      coreMessage: 'Prepare a release package',
      projectId,
      title: 'Package preparation',
    })
    const artifact = service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'package-preparation-article',
      kind: 'article-version',
      locale: 'en',
      projectId,
      relativePath: 'articles/release.md',
      sha256: 'a'.repeat(64),
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [artifact.artifactId],
      body: `Read the release guide at ${canonicalLink}`,
      channel: 'github',
      contentGroupId: group.contentGroupId,
      contentId: 'package-preparation-content',
      format: 'article',
      locale: 'en',
      projectId,
      title: 'Package preparation release',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'github',
      contentId: content.contentId,
      projectId,
      publicationId: 'package-preparation-publication',
    })
    const before = service.getProjectView(projectId)

    const prepared = service.prepareMarketingOpsPublicationPackage({
      projectId,
      publicationId: publication.publicationId,
      renderer: {
        canonicalUrl: canonicalLink,
        format: 'release',
        links: [canonicalLink],
        media: [],
        utmMedium: 'community',
      },
    })

    expect(prepared).toMatchObject({
      externalWrite: false,
      mode: 'prepare-only',
      package: {
        accountRef: 'github-account-ref',
        activityId: activity.activityId,
        artifactRefs: [{
          artifactId: artifact.artifactId,
          kind: 'article-version',
          locale: 'en',
          sha256: 'a'.repeat(64),
          version: 1,
        }],
        channel: 'github',
        contentId: content.contentId,
        locale: 'en',
        packageId: publication.publicationId,
        projectId,
        publicationId: publication.publicationId,
      },
    })
    expect(prepared.package.artifactRefs[0]).not.toHaveProperty('relativePath')
    const after = service.getProjectView(projectId)
    expect(after.tasks).toEqual(before.tasks)
    expect(after.publicationReceipts).toEqual([])

    service.updateProjectChannelBinding({
      accountRef: 'github-account-ref',
      channel: 'github',
      delivery: 'content-only',
      enabled: true,
      projectId,
    })
    expect(() => service.prepareMarketingOpsPublicationPackage({
      projectId,
      publicationId: publication.publicationId,
      renderer: {
        canonicalUrl: canonicalLink,
        format: 'release',
        links: [canonicalLink],
        media: [],
        utmMedium: 'community',
      },
    })).toThrow(/content-only channel/i)

    service.updateProjectChannelBinding({
      accountRef: 'github-account-ref',
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: false,
      projectId,
    })
    expect(() => service.prepareMarketingOpsPublicationPackage({
      projectId,
      publicationId: publication.publicationId,
      renderer: {
        canonicalUrl: canonicalLink,
        format: 'release',
        links: [canonicalLink],
        media: [],
        utmMedium: 'community',
      },
    })).toThrow(/enabled channel/i)
  })

  it('applies different readiness requirements to Bilibili image-text and short-post content', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'bilibili-readiness-project')
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'bilibili-readiness-project',
    })
    const activity = service.createActivity({
      activityId: 'bilibili-readiness-activity',
      campaignId: 'bilibili-readiness-campaign',
      channels: [{
        contentFormats: ['image-text', 'short-post'],
        id: 'bilibili',
        locale: 'en',
      }],
      goal: 'education',
      projectId: 'bilibili-readiness-project',
      projectSnapshotId: 'bilibili-readiness-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://bilibili-readiness-project.example.com/',
      topic: { 'en': 'A topic', 'zh-CN': '主题' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'bilibili-readiness-group',
      coreMessage: 'Explain the idea',
      projectId: activity.projectId,
      title: 'Readiness',
    })
    const imageText = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Image text body',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'bilibili-image-text',
      format: 'image-text',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Image text',
    })
    const shortPost = service.createChannelContent({
      ...imageText,
      contentId: 'bilibili-short-post',
      format: 'short-post',
      title: 'Short post',
    })

    expect(() => service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: imageText.contentId,
      projectId: activity.projectId,
      publicationId: 'bilibili-image-text-publication',
    })).toThrow(/not ready.*image artifact.*required/i)
    expect(service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: shortPost.contentId,
      projectId: activity.projectId,
      publicationId: 'bilibili-short-post-publication',
    })).toMatchObject({ publicationId: 'bilibili-short-post-publication' })
  })

  it('revises existing channel media with optimistic versions and preserves non-media references', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'media-revision-project')
    service.bindProjectChannel({
      channel: 'bilibili',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'media-revision-project',
    })
    const activity = service.createActivity({
      activityId: 'media-revision-activity',
      campaignId: 'media-revision-campaign',
      channels: [{
        contentFormats: ['image-text'],
        id: 'bilibili',
        locale: 'en',
      }],
      goal: 'education',
      projectId: 'media-revision-project',
      projectSnapshotId: 'media-revision-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://media-revision-project.example.com/',
      topic: { 'en': 'A topic', 'zh-CN': '主题' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'media-revision-group',
      coreMessage: 'Attach the final image',
      projectId: activity.projectId,
      title: 'Media revision',
    })
    for (const [artifactId, kind] of [
      ['article-draft', 'article-version'],
      ['old-image', 'image'],
      ['new-image', 'image'],
      ['recording-clip', 'video-clip'],
    ] as const) {
      service.createActivityArtifact({
        activityId: activity.activityId,
        artifactId,
        kind,
        projectId: activity.projectId,
        relativePath: `activity/${artifactId}`,
        sha256: 'a'.repeat(64),
      })
    }
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: ['article-draft', 'old-image'],
      body: 'Image text body',
      channel: 'bilibili',
      contentGroupId: group.contentGroupId,
      contentId: 'media-revision-content',
      format: 'image-text',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Image text',
    })
    const existingMediaFirst = service.createChannelContent({
      ...content,
      artifactIds: ['old-image', 'article-draft'],
      contentId: 'existing-media-first-content',
    })
    expect(service.reviseChannelContentMedia({
      artifactIds: ['old-image'],
      baseVersion: existingMediaFirst.version,
      contentId: existingMediaFirst.contentId,
      mode: 'append',
      projectId: activity.projectId,
    })).toEqual(existingMediaFirst)
    expect(service.reviseChannelContentMedia({
      artifactIds: ['old-image'],
      baseVersion: existingMediaFirst.version,
      contentId: existingMediaFirst.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })).toEqual(existingMediaFirst)

    const appended = service.reviseChannelContentMedia({
      artifactIds: ['new-image'],
      baseVersion: content.version,
      contentId: content.contentId,
      mode: 'append',
      projectId: activity.projectId,
    })
    expect(appended).toMatchObject({
      artifactIds: ['article-draft', 'old-image', 'new-image'],
      version: 2,
    })
    expect(service.getProjectView(activity.projectId).channelContentReadiness[content.contentId])
      .toMatchObject({
        matchingArtifactIds: ['old-image', 'new-image'],
        ready: true,
      })

    const replaced = service.reviseChannelContentMedia({
      artifactIds: ['new-image'],
      baseVersion: appended.version,
      contentId: content.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })
    expect(replaced).toMatchObject({
      artifactIds: ['article-draft', 'new-image'],
      version: 3,
    })
    expect(service.getProjectView(activity.projectId).channelContentReadiness[content.contentId])
      .toMatchObject({
        matchingArtifactIds: ['new-image'],
        ready: true,
      })
    expect(() => service.reviseChannelContentMedia({
      artifactIds: ['old-image'],
      baseVersion: 1,
      contentId: content.contentId,
      mode: 'append',
      projectId: activity.projectId,
    })).toThrow(/moved past version 1/i)
    expect(() => service.reviseChannelContentMedia({
      artifactIds: ['recording-clip'],
      baseVersion: replaced.version,
      contentId: content.contentId,
      mode: 'append',
      projectId: activity.projectId,
    })).toThrow(/final image\/video/i)
    const cleared = service.reviseChannelContentMedia({
      artifactIds: [],
      baseVersion: replaced.version,
      contentId: content.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })
    expect(cleared).toMatchObject({
      artifactIds: ['article-draft'],
      version: 4,
    })
    const restored = service.reviseChannelContentMedia({
      artifactIds: ['new-image'],
      baseVersion: cleared.version,
      contentId: content.contentId,
      mode: 'append',
      projectId: activity.projectId,
    })
    const mediaOnlyGroup = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'media-only-group',
      coreMessage: 'Clear the selected final image',
      projectId: activity.projectId,
      title: 'Media only',
    })
    const mediaOnlyContent = service.createChannelContent({
      ...content,
      artifactIds: ['old-image'],
      contentGroupId: mediaOnlyGroup.contentGroupId,
      contentId: 'media-only-content',
    })
    expect(service.reviseChannelContentMedia({
      artifactIds: [],
      baseVersion: mediaOnlyContent.version,
      contentId: mediaOnlyContent.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })).toMatchObject({ artifactIds: [], version: 2 })
    service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: content.contentId,
      projectId: activity.projectId,
      publicationId: 'media-revision-publication',
    })
    expect(() => service.reviseChannelContentMedia({
      artifactIds: [],
      baseVersion: restored.version,
      contentId: content.contentId,
      mode: 'replace',
      projectId: activity.projectId,
    })).toThrow(/cannot be revised after publication plan/i)
  })

  it('does not create a publication task for a content-only channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'content-only-project')
    service.bindProjectChannel({
      channel: 'reddit',
      delivery: 'content-only',
      enabled: true,
      projectId: 'content-only-project',
    })
    const activity = service.createActivity({
      activityId: 'content-only-activity',
      campaignId: 'content-only-campaign',
      channels: [{ id: 'reddit', locale: 'en' }],
      goal: 'education',
      projectId: 'content-only-project',
      projectSnapshotId: 'content-only-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://content-only-project.example.com/',
      topic: { 'en': 'A topic', 'zh-CN': '主题' },
    })
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'content-only-group',
      coreMessage: 'Explain the idea',
      projectId: activity.projectId,
      title: '内容组',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [],
      body: 'Content body',
      channel: 'reddit',
      contentGroupId: group.contentGroupId,
      contentId: 'content-only-content',
      format: 'article',
      locale: 'en',
      projectId: activity.projectId,
      title: 'Content',
    })

    expect(service.getProjectView(activity.projectId).tasks).toHaveLength(1)
    expect(() => service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'reddit',
      contentId: content.contentId,
      projectId: activity.projectId,
      publicationId: 'content-only-publication',
    })).toThrow(/content-only channel does not support publication plans/i)
    expect(service.getProjectView(activity.projectId).tasks).toHaveLength(1)
  })

  it('returns one project-scoped view for the local control surface', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const { project, snapshot } = registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(service.getProjectView('project-a')).toEqual({
      activities: [activity],
      activityArtifacts: [],
      channelBlueprints: CHANNEL_BLUEPRINTS,
      channelContents: [],
      channelContentReadiness: {},
      compositionReceipts: [],
      contentGroups: [],
      ownerHandoffs: [],
      publicationPlans: [],
      publicationReceipts: [],
      recordingReceipts: [],
      monitoringObservations: [],
      project,
      projectAssets: [],
      projectChannelBindings: [
        {
          channel: 'youtube',
          delivery: 'owner-assisted',
          enabled: true,
          projectId: 'project-a',
        },
      ],
      reports: [],
      taskEvents: {},
      snapshot,
      tasks: [],
    })
  })

  it('keeps one explicit project account binding per channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    const binding = service.bindProjectChannel({
      accountAlias: '算法可视化账号',
      accountRef: 'project-a:youtube:owner-account',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })

    expect(binding).toMatchObject({
      accountAlias: '算法可视化账号',
      accountRef: 'project-a:youtube:owner-account',
      channel: 'youtube',
      projectId: 'project-a',
    })
    expect(() => service.bindProjectChannel({
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'project-a',
    })).toThrow(/already exists/i)
  })

  it('updates an existing project channel binding without creating a second channel entry', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')

    const updated = service.updateProjectChannelBinding({
      accountAlias: '算法可视化备用账号',
      accountRef: 'account-youtube-backup',
      channel: 'youtube',
      delivery: 'owner-assisted',
      enabled: false,
      projectId: 'project-a',
    })

    expect(updated).toMatchObject({
      accountAlias: '算法可视化备用账号',
      accountRef: 'account-youtube-backup',
      enabled: false,
    })
    expect(repository.listProjectChannelBindings('project-a')).toEqual([updated])
    expect(() => service.updateProjectChannelBinding({
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: 'project-a',
    })).toThrow(/not found/i)
  })

  it('saves a new project channel binding when a global channel has not been configured yet', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')

    const binding = service.setProjectChannelBinding({
      channel: 'github',
      delivery: 'automatic-candidate',
      enabled: true,
      projectId: 'project-a',
    })

    expect(repository.listProjectChannelBindings('project-a')).toEqual([binding])
  })

  it('cancels and retries only the project task through the application service', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`

    expect(service.startProductionTask('project-a', taskId)).toMatchObject({
      attempt: 1,
      status: 'generating',
    })
    expect(service.cancelTask('project-a', taskId)).toMatchObject({
      attempt: 1,
      status: 'cancelled',
    })
    expect(service.retryTask('project-a', taskId)).toMatchObject({
      attempt: 2,
      status: 'queued',
    })
    expect(service.listTaskEvents('project-a', taskId).map(event => event.kind))
      .toEqual(['task-created', 'status-changed', 'attempt-cancelled', 'attempt-retried'])
  })

  it('runs a production task through the application service boundary', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('project-a', taskId)

    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-service-test/attempt-1',
      artifacts: [],
      attempt: 1,
      campaignId: activity.campaignId,
      completedActions: 0,
      completedScenes: 0,
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'test-plan',
      projectId: 'project-a',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
      receiptVersion: 1,
      totalActions: 0,
      totalScenes: 0,
    }
    const result = await service.runProductionTask(
      {
        baseUrl: 'https://project-a.example.com',
        outputDirectory: '/tmp/content-studio-service-test',
        plan: {
          campaignId: activity.campaignId,
          durationMs: 100,
          format: 'landscape',
          recordingConfig: {
            colorScheme: 'dark',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 1080, width: 1920 },
            viewport: { height: 1080, width: 1920 },
          },
          scenes: [],
        },
        projectId: 'project-a',
        projectOrigin: 'https://project-a.example.com',
        taskId,
      },
      {
        record: async () => ({
          attempts: [receipt],
          receipt,
        }),
      },
    )

    expect(result.task.status).toBe('composing')
    expect(service.listTaskEvents('project-a', taskId).map(event => event.status))
      .toEqual(['queued', 'generating', 'recording', 'composing'])
  })

  it('keeps an activity video plan tied to the project snapshot', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const flow: CaptureFlow = {
      id: 'quick-sort',
      startPath: '/quick-sort',
      steps: [{
        durationMs: 100,
        kind: 'capture',
        label: 'algorithm',
      }],
      title: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
    }
    registerProject(service, 'video-project', [flow])
    enableYouTube(service, 'video-project')

    const activity = service.createActivity({
      activityId: 'video-activity',
      campaignId: 'video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'video-project',
      projectSnapshotId: 'video-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://video-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      videoPlanReviewStatus: 'confirmed',
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 2,
        outline: [{
          flowId: 'quick-sort',
          objective: {
            'en': 'Show the partition step',
            'zh-CN': '展示分区步骤',
          },
          title: {
            'en': 'Partition the array',
            'zh-CN': '数组分区',
          },
        }],
      },
    })

    expect(activity.videoPlanReviewStatus).toBe('pending')
    const confirmedActivity = service.confirmActivityVideoPlan({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'video-project',
    })
    expect(confirmedActivity).toMatchObject({
      activityId: activity.activityId,
      version: activity.version + 1,
      videoPlanReviewStatus: 'confirmed',
    })
    expect(() => service.confirmActivityVideoPlan({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'video-project',
    })).toThrow(/moved past version/i)

    expect(activity.video).toEqual({
      flowIds: ['quick-sort'],
      format: 'landscape',
      planVersion: 2,
      outline: [{
        flowId: 'quick-sort',
        objective: {
          'en': 'Show the partition step',
          'zh-CN': '展示分区步骤',
        },
        title: {
          'en': 'Partition the array',
          'zh-CN': '数组分区',
        },
      }],
    })
    expect(service.getActivityVideoPlan('video-project', activity.activityId))
      .toMatchObject({
        campaignId: 'video-campaign',
        durationMs: 100,
        format: 'landscape',
        outline: [{ flowId: 'quick-sort' }],
        planVersion: 2,
        reviewStatus: 'confirmed',
        scenes: [{ id: 'quick-sort', startPath: '/quick-sort' }],
      })

    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('video-project', taskId)
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-video-plan-test/attempt-1',
      artifacts: [],
      attempt: 1,
      campaignId: activity.campaignId,
      completedActions: 1,
      completedScenes: 1,
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'video-plan-test',
      projectId: 'video-project',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const recorderInputs: Array<{ plan: unknown, recordingContext: unknown }> = []
    await expect(service.runActivityProductionTask(
      'video-project',
      taskId,
      {
        baseUrl: 'https://video-project.example.com',
        outputDirectory: '/tmp/content-studio-video-plan-test',
        projectOrigin: 'https://video-project.example.com',
      },
      {
        record: async (input) => {
          recorderInputs.push({
            plan: input.plan,
            recordingContext: input.recordingContext,
          })
          return { attempts: [receipt], receipt }
        },
      },
    )).resolves.toMatchObject({ task: { status: 'composing' } })
    expect(service.getProjectView('video-project').recordingReceipts).toEqual([
      expect.objectContaining({
        attempt: 1,
        artifacts: [],
        jobId: taskId,
      }),
    ])
    const recordingReceipts = service.getProjectView('video-project').recordingReceipts
    expect(recordingReceipts[0]).not.toHaveProperty('artifactDirectory')
    expect(recorderInputs[0]?.plan).toMatchObject({
      campaignId: 'video-campaign',
      scenes: [{ id: 'quick-sort' }],
    })
    expect(recorderInputs[0]?.recordingContext).toEqual({
      captureMode: 'deterministic',
      humanIntervention: false,
      planVersion: 2,
      repeatability: 'high',
      sourceAccess: 'source-owned',
    })

    expect(() => service.createActivity({
      activityId: 'invalid-video-activity',
      campaignId: 'invalid-video-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'video-project',
      projectSnapshotId: 'video-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://video-project.example.com/quick-sort',
      topic: {
        'en': 'Invalid',
        'zh-CN': '无效',
      },
      video: {
        flowIds: ['missing-flow'],
        format: 'landscape',
      },
    })).toThrow(/capture flow/i)

    const assistedRepository = new InMemoryContentStudioRepository()
    const assistedService = new ContentStudioApplicationService(assistedRepository)
    registerProject(
      assistedService,
      'assisted-project',
      [flow],
      {
        captureMode: 'assisted',
        repeatability: 'low',
        sourceAccess: 'web-assisted',
      },
    )
    enableYouTube(assistedService, 'assisted-project')
    const assistedActivity = assistedService.createActivity({
      activityId: 'assisted-activity',
      campaignId: 'assisted-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'assisted-project',
      projectSnapshotId: 'assisted-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://assisted-project.example.com/quick-sort',
      topic: {
        'en': 'Assisted',
        'zh-CN': '辅助',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
      },
    })
    const assistedContentId = createProductionContent(assistedService, assistedActivity)
    const assistedTaskId = `production-${assistedContentId}`
    assistedService.startProductionTask('assisted-project', assistedTaskId)
    expect(() => assistedService.runActivityProductionTask(
      'assisted-project',
      assistedTaskId,
      {
        baseUrl: 'https://assisted-project.example.com',
        outputDirectory: '/tmp/content-studio-assisted-project',
        projectOrigin: 'https://assisted-project.example.com',
      },
      {
        record: async () => {
          throw new Error('recorder must not run')
        },
      },
    )).toThrow(/source-owned deterministic/i)
  })

  it('passes an owner takeover opt-in into the recording context', async () => {
    const service = new ContentStudioApplicationService(
      new InMemoryContentStudioRepository(),
      new InMemoryExecutionTaskStore(),
    )
    registerProject(
      service,
      'takeover-project',
      [{
        id: 'quick-sort',
        startPath: '/quick-sort',
        steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
        title: {
          'en': 'Quick sort',
          'zh-CN': '快速排序',
        },
      }],
      {
        captureMode: 'deterministic',
        ownerTakeover: true,
        repeatability: 'conditional',
        sourceAccess: 'source-owned',
      },
    )
    enableYouTube(service, 'takeover-project')
    const activity = service.createActivity({
      activityId: 'takeover-activity',
      campaignId: 'takeover-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'takeover-project',
      projectSnapshotId: 'takeover-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://takeover-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 1,
      },
    })
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('takeover-project', taskId)

    const recorderInputs: Array<{ recordingContext: unknown }> = []
    await service.runActivityProductionTask(
      'takeover-project',
      taskId,
      {
        baseUrl: 'https://takeover-project.example.com',
        outputDirectory: '/tmp/content-studio-takeover-test',
        projectOrigin: 'https://takeover-project.example.com',
      },
      {
        record: async (input) => {
          recorderInputs.push({ recordingContext: input.recordingContext })
          return {
            attempts: [],
            receipt: {
              artifactDirectory: '/tmp/content-studio-takeover-test/attempt-1',
              artifacts: [],
              attempt: 1,
              campaignId: activity.campaignId,
              completedActions: 1,
              completedScenes: 1,
              jobId: taskId,
              logs: {
                consoleErrors: 0,
                consoleWarnings: 0,
                entries: [],
                pageErrors: 0,
              },
              outcome: 'succeeded',
              planSha256: 'takeover-test',
              projectId: 'takeover-project',
              recordingConfig: {
                colorScheme: 'dark',
                deviceScaleFactor: 1,
                locale: 'en',
                outputSize: { height: 1080, width: 1920 },
                viewport: { height: 1080, width: 1920 },
              },
              receiptVersion: 1,
              totalActions: 1,
              totalScenes: 1,
            },
          }
        },
      },
    )

    expect(recorderInputs[0]?.recordingContext).toEqual({
      captureMode: 'deterministic',
      humanIntervention: true,
      ownerTakeover: true,
      planVersion: 1,
      repeatability: 'conditional',
      sourceAccess: 'source-owned',
    })
  })

  it('compiles each channel production task with its own video variant', async () => {
    const service = new ContentStudioApplicationService(
      new InMemoryContentStudioRepository(),
      new InMemoryExecutionTaskStore(),
    )
    registerProject(
      service,
      'variant-project',
      [{
        id: 'quick-sort',
        startPath: '/quick-sort',
        steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
        title: {
          'en': 'Quick sort',
          'zh-CN': '快速排序',
        },
      }],
      {
        captureMode: 'deterministic',
        repeatability: 'high',
        sourceAccess: 'source-owned',
      },
    )
    enableYouTube(service, 'variant-project')
    service.bindProjectChannel({
      channel: 'douyin',
      delivery: 'owner-assisted',
      enabled: true,
      projectId: 'variant-project',
    })
    const activity = service.createActivity({
      activityId: 'variant-activity',
      campaignId: 'variant-campaign',
      channels: [
        { id: 'youtube', locale: 'en' },
        { id: 'douyin', locale: 'en' },
      ],
      goal: 'education',
      projectId: 'variant-project',
      projectSnapshotId: 'variant-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://variant-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 1,
        recordingProfile: {
          channelVariants: {
            youtube: {
              outputSize: { height: 1080, width: 1920 },
              viewport: { height: 1080, width: 1920 },
            },
            douyin: {
              format: 'portrait',
              outputSize: { height: 1920, width: 1080 },
              viewport: { height: 1920, width: 1080 },
            },
          },
        },
      },
    })
    const youtubeContentId = createProductionContent(
      service,
      activity,
      'video',
      'youtube',
      'variant-youtube',
    )
    const douyinContentId = createProductionContent(
      service,
      activity,
      'video',
      'douyin',
      'variant-douyin',
    )
    service.startProductionTask(
      'variant-project',
      `production-${youtubeContentId}`,
    )
    service.startProductionTask(
      'variant-project',
      `production-${douyinContentId}`,
    )

    const capturedPlans: Array<{ format?: string, recordingConfig: unknown }> = []
    const record = async (input: {
      jobId: string
      plan: { format?: string, recordingConfig: unknown }
    }) => {
      capturedPlans.push(input.plan)
      const receipt: RecorderAttemptReceipt = {
        artifactDirectory: '/tmp/content-studio-variant/attempt-1',
        artifacts: [],
        attempt: 1,
        campaignId: activity.campaignId,
        completedActions: 1,
        completedScenes: 1,
        jobId: input.jobId,
        logs: {
          consoleErrors: 0,
          consoleWarnings: 0,
          entries: [],
          pageErrors: 0,
        },
        outcome: 'succeeded',
        planSha256: 'variant-plan',
        projectId: 'variant-project',
        recordingConfig: {
          colorScheme: 'dark',
          deviceScaleFactor: 1,
          format: 'landscape',
          locale: 'en',
          outputSize: { height: 1080, width: 1920 },
          viewport: { height: 1080, width: 1920 },
        },
        receiptVersion: 1,
        totalActions: 1,
        totalScenes: 1,
      }
      return { attempts: [], receipt }
    }

    await service.runActivityProductionTask(
      'variant-project',
      `production-${youtubeContentId}`,
      {
        baseUrl: 'https://variant-project.example.com',
        outputDirectory: '/tmp/content-studio-variant-youtube',
        projectOrigin: 'https://variant-project.example.com',
      },
      { record },
    )
    await service.runActivityProductionTask(
      'variant-project',
      `production-${douyinContentId}`,
      {
        baseUrl: 'https://variant-project.example.com',
        outputDirectory: '/tmp/content-studio-variant-douyin',
        projectOrigin: 'https://variant-project.example.com',
      },
      { record },
    )

    expect(capturedPlans[0]).toMatchObject({
      format: 'landscape',
      recordingConfig: {
        format: 'landscape',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
    })
    expect(capturedPlans[1]).toMatchObject({
      format: 'portrait',
      recordingConfig: {
        format: 'portrait',
        outputSize: { height: 1920, width: 1080 },
        viewport: { height: 1920, width: 1080 },
      },
    })
  })

  it('composes and registers the final channel variant after a successful recording', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(
      repository,
      new InMemoryExecutionTaskStore(),
    )
    registerProject(
      service,
      'compose-project',
      [{
        id: 'quick-sort',
        startPath: '/quick-sort',
        steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
        title: {
          'en': 'Quick sort',
          'zh-CN': '快速排序',
        },
      }],
      {
        captureMode: 'deterministic',
        repeatability: 'high',
        sourceAccess: 'source-owned',
      },
    )
    enableYouTube(service, 'compose-project')
    const activity = service.createActivity({
      activityId: 'compose-activity',
      campaignId: 'compose-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'compose-project',
      projectSnapshotId: 'compose-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://compose-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 1,
      },
    })
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('compose-project', taskId)

    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-compose-register/attempt-1',
      artifacts: [{
        id: 'clip-1',
        kind: 'video-clip',
        relativePath: 'clips/scene-001.webm',
        sceneId: 'quick-sort',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
      }],
      attempt: 1,
      campaignId: activity.campaignId,
      completedActions: 1,
      completedScenes: 1,
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'compose-plan',
      projectId: 'compose-project',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        format: 'landscape',
        locale: 'en',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const composeInputs: unknown[] = []
    const result = await service.runActivityProductionTask(
      'compose-project',
      taskId,
      {
        baseUrl: 'https://compose-project.example.com',
        outputDirectory: '/tmp/content-studio-compose-register',
        projectOrigin: 'https://compose-project.example.com',
      },
      {
        compose: async (input) => {
          composeInputs.push(input)
          return {
            artifactPath: join(
              '/tmp/content-studio-compose-register',
              'composed',
              'final.webm',
            ),
            cover: {
              artifactPath: join(
                '/tmp/content-studio-compose-register',
                'composed',
                'cover.svg',
              ),
              height: 1080,
              sha256: 'd'.repeat(64),
              sizeBytes: 8,
              width: 1920,
            },
            durationSeconds: 3,
            gif: {
              artifactPath: join(
                '/tmp/content-studio-compose-register',
                'composed',
                'preview.gif',
              ),
              durationSeconds: 3,
              fps: 10,
              height: 360,
              sha256: 'e'.repeat(64),
              sizeBytes: 9,
              width: 640,
            },
            reencoded: false,
            sha256: 'c'.repeat(64),
            sizeBytes: 7,
          }
        },
        record: async () => ({ attempts: [receipt], receipt }),
      },
    )

    expect(result.receipt.outcome).toBe('succeeded')
    expect(result.task.status).toBe('completed')
    expect(composeInputs).toEqual([{
      clipPaths: [
        resolve('/tmp/content-studio-compose-register/attempt-1', 'clips/scene-001.webm'),
      ],
      cover: {
        outputPath: join(
          '/tmp/content-studio-compose-register',
          'composed',
          'cover.svg',
        ),
        subtitle: 'youtube · en',
        title: 'Content',
      },
      emit: expect.any(Function),
      gif: {
        outputPath: join(
          '/tmp/content-studio-compose-register',
          'composed',
          'preview.gif',
        ),
        outputSize: { height: 360, width: 640 },
      },
      normalizeLoudness: true,
      outputPath: join('/tmp/content-studio-compose-register', 'composed', 'final.webm'),
      outputSize: { height: 1080, width: 1920 },
    }])
    expect(
      repository.listActivityArtifacts('compose-project', activity.activityId),
    ).toEqual([expect.objectContaining({
      artifactId: `composed-${taskId}`,
      kind: 'video',
      relativePath: 'content-studio-compose-register/composed/final.webm',
      sha256: 'c'.repeat(64),
    }), expect.objectContaining({
      artifactId: `cover-${taskId}`,
      kind: 'image',
      relativePath: 'content-studio-compose-register/composed/cover.svg',
      sha256: 'd'.repeat(64),
    }), expect.objectContaining({
      artifactId: `gif-${taskId}`,
      kind: 'image',
      relativePath: 'content-studio-compose-register/composed/preview.gif',
      sha256: 'e'.repeat(64),
    })])
    expect(repository.getChannelContent('compose-project', contentId)).toMatchObject({
      artifactIds: [
        `composed-${taskId}`,
        `cover-${taskId}`,
        `gif-${taskId}`,
      ],
      version: 2,
    })
    expect(service.getProjectView('compose-project').channelContentReadiness[contentId])
      .toMatchObject({
        matchingArtifactIds: [`composed-${taskId}`],
        ready: true,
      })
    expect(
      service.getProjectView('compose-project').compositionReceipts,
    ).toMatchObject([{
      artifacts: [
        expect.objectContaining({
          artifactId: `composed-${taskId}`,
          durationSeconds: 3,
          height: 1080,
          kind: 'video',
          relativePath: 'content-studio-compose-register/composed/final.webm',
          sha256: 'c'.repeat(64),
          sizeBytes: 7,
          width: 1920,
        }),
        expect.objectContaining({
          artifactId: `cover-${taskId}`,
          height: 1080,
          kind: 'cover',
          relativePath: 'content-studio-compose-register/composed/cover.svg',
          sha256: 'd'.repeat(64),
          sizeBytes: 8,
          width: 1920,
        }),
        expect.objectContaining({
          artifactId: `gif-${taskId}`,
          durationSeconds: 3,
          fps: 10,
          height: 360,
          kind: 'gif',
          relativePath: 'content-studio-compose-register/composed/preview.gif',
          sha256: 'e'.repeat(64),
          sizeBytes: 9,
          width: 640,
        }),
      ],
      attempt: 1,
      jobId: taskId,
      outcome: 'succeeded',
    }])
    expect(
      service.listTaskEvents('compose-project', taskId)
        .filter(event => event.kind.startsWith('composition-'))
        .map(event => event.kind),
    ).toEqual([
      'composition-started',
      'composition-video-ready',
      'composition-cover-ready',
      'composition-gif-ready',
      'composition-completed',
    ])
  })

  it('cancels before registering media when composition observes an aborted signal', async () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(
      repository,
      new InMemoryExecutionTaskStore(),
    )
    registerProject(
      service,
      'cancel-compose-project',
      [{
        id: 'quick-sort',
        startPath: '/quick-sort',
        steps: [{ durationMs: 100, kind: 'capture', label: 'algorithm' }],
        title: {
          'en': 'Quick sort',
          'zh-CN': '快速排序',
        },
      }],
    )
    enableYouTube(service, 'cancel-compose-project')
    const activity = service.createActivity({
      activityId: 'cancel-compose-activity',
      campaignId: 'cancel-compose-campaign',
      channels: [{ id: 'youtube', locale: 'en' }],
      goal: 'education',
      projectId: 'cancel-compose-project',
      projectSnapshotId: 'cancel-compose-project-snapshot-1',
      status: 'draft',
      targetUrl: 'https://cancel-compose-project.example.com/quick-sort',
      topic: {
        'en': 'Quick sort',
        'zh-CN': '快速排序',
      },
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        planVersion: 1,
      },
    })
    const contentId = createProductionContent(service, activity)
    const taskId = `production-${contentId}`
    service.startProductionTask('cancel-compose-project', taskId)
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/tmp/content-studio-cancel-compose/attempt-1',
      artifacts: [{
        id: 'clip-1',
        kind: 'video-clip',
        relativePath: 'clips/scene-001.webm',
        sceneId: 'quick-sort',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
      }],
      attempt: 1,
      campaignId: activity.campaignId,
      completedActions: 1,
      completedScenes: 1,
      jobId: taskId,
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: [],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'cancel-compose-plan',
      projectId: 'cancel-compose-project',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        format: 'landscape',
        locale: 'en',
        outputSize: { height: 1080, width: 1920 },
        viewport: { height: 1080, width: 1920 },
      },
      receiptVersion: 1,
      totalActions: 1,
      totalScenes: 1,
    }
    const controller = new AbortController()
    let composeSignal: AbortSignal | undefined
    const result = await service.runActivityProductionTask(
      'cancel-compose-project',
      taskId,
      {
        baseUrl: 'https://cancel-compose-project.example.com',
        outputDirectory: '/tmp/content-studio-cancel-compose',
        projectOrigin: 'https://cancel-compose-project.example.com',
        signal: controller.signal,
      },
      {
        compose: async (input) => {
          composeSignal = input.signal
          controller.abort()
          return {
            artifactPath: '/tmp/content-studio-cancel-compose/composed/final.webm',
            durationSeconds: 1,
            reencoded: false,
            sha256: 'b'.repeat(64),
            sizeBytes: 7,
          }
        },
        record: async () => ({ attempts: [receipt], receipt }),
      },
    )

    expect(composeSignal).toBe(controller.signal)
    expect(result.task.status).toBe('cancelled')
    expect(repository.listActivityArtifacts(
      'cancel-compose-project',
      activity.activityId,
    )).toEqual([])
    expect(service.getProjectView('cancel-compose-project').compositionReceipts)
      .toMatchObject([{
        artifacts: [],
        attempt: 1,
        failure: {
          code: 'cancelled',
        },
        jobId: taskId,
        outcome: 'cancelled',
      }])
    expect(service.listTaskEvents('cancel-compose-project', taskId)
      .filter(event => event.kind.startsWith('composition-'))
      .map(event => event.kind)).toEqual([
      'composition-started',
      'composition-video-ready',
      'composition-cancelled',
    ])

    expect(service.retryTask('cancel-compose-project', taskId)).toMatchObject({
      attempt: 2,
      status: 'queued',
    })
    service.startProductionTask('cancel-compose-project', taskId)
    const failedReceipt: RecorderAttemptReceipt = {
      ...receipt,
      artifactDirectory: '/tmp/content-studio-cancel-compose/attempt-2',
      attempt: 2,
      previousAttempt: 1,
    }
    await expect(service.runActivityProductionTask(
      'cancel-compose-project',
      taskId,
      {
        baseUrl: 'https://cancel-compose-project.example.com',
        outputDirectory: '/tmp/content-studio-cancel-compose',
        projectOrigin: 'https://cancel-compose-project.example.com',
      },
      {
        compose: async () => {
          throw new Error('Encoder failed on retry')
        },
        record: async () => ({ attempts: [failedReceipt], receipt: failedReceipt }),
      },
    )).rejects.toThrow(/encoder failed on retry/i)

    expect(service.getProjectView('cancel-compose-project').compositionReceipts)
      .toMatchObject([
        { attempt: 1, outcome: 'cancelled' },
        {
          attempt: 2,
          failure: { code: 'runtime-error', retryable: true },
          outcome: 'failed',
        },
      ])
    expect(service.getProjectView('cancel-compose-project').tasks)
      .toEqual([expect.objectContaining({ attempt: 2, status: 'failed' })])
    expect(repository.listActivityArtifacts(
      'cancel-compose-project',
      activity.activityId,
    )).toEqual([])
  })

  it('normalizes stored artifact relative paths to portable forward slashes', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'artifact-windows',
      kind: 'video',
      projectId: 'project-a',
      relativePath: 'composed\\final.webm',
      sha256: 'a'.repeat(64),
    })

    expect(
      repository.listActivityArtifacts('project-a', activity.activityId),
    ).toEqual([expect.objectContaining({
      relativePath: 'composed/final.webm',
    })])
  })

  it('saves an activity content pack after preflighting all channel versions', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const input = {
      activityId: activity.activityId,
      contentGroupId: 'pack-group',
      contents: [{
        artifactIds: [],
        body: 'A reviewable video draft',
        channel: 'youtube' as const,
        contentId: 'pack-content',
        format: 'video' as const,
        locale: 'en' as const,
        title: 'A video draft',
      }],
      coreMessage: 'Explain the idea clearly',
      projectId: 'project-a',
      title: 'Core message',
    }

    expect(service.saveActivityContentPack(input)).toMatchObject({
      contentGroup: { contentGroupId: 'pack-group', version: 1 },
      contents: [{ contentId: 'pack-content', version: 1 }],
    })
    expect(repository.listContentGroups('project-a')).toHaveLength(1)
    expect(repository.listChannelContents('project-a')).toHaveLength(1)

    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'empty-pack',
      contents: [],
    })).toThrow(/at least one/i)
    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'duplicate-pack',
      contents: [
        { ...input.contents[0]!, contentId: 'duplicate-new' },
        { ...input.contents[0]!, contentId: 'duplicate-new' },
      ],
    })).toThrow(/duplicate content/i)
    expect(() => service.saveActivityContentPack({
      ...input,
      contentGroupId: 'wrong-locale-pack',
      contents: [{ ...input.contents[0]!, contentId: 'wrong-locale', locale: 'zh-CN' }],
    })).toThrow(/channel and locale/i)
    expect(() => service.saveActivityContentPack(input)).toThrow(/already exists/i)
  })

  it('keeps activity artifacts out of the project asset library until explicit promotion', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    service.createActivityArtifact({
      activityId: activity.activityId,
      artifactId: 'artifact-1',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'a'.repeat(64),
    })

    expect(service.getProjectView('project-a').activityArtifacts).toEqual([
      expect.objectContaining({ artifactId: 'artifact-1' }),
    ])
    expect(repository.listProjectAssets('project-a')).toEqual([])
    service.promoteActivityArtifact({
      artifactId: 'artifact-1',
      assetId: 'asset-1',
      kind: 'video',
      projectId: 'project-a',
    })
    expect(repository.listProjectAssets('project-a')).toHaveLength(1)
  })

  it('stores immutable activity versions and preserves historical content', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const versionOne = createActivity(service)
    const versionTwo = service.reviseActivity({
      activityId: versionOne.activityId,
      baseVersion: versionOne.version,
      projectId: 'project-a',
      topic: {
        'en': 'A revised topic',
        'zh-CN': '修订主题',
      },
    })

    expect(versionTwo.version).toBe(2)
    expect(repository.getActivity('project-a', versionOne.activityId, 1)?.topic.en)
      .toBe('A topic')
    expect(repository.getActivity('project-a', versionOne.activityId)?.topic.en)
      .toBe('A revised topic')
  })

  it('revises a video plan and requires confirmation for the new version', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a', [{
      id: 'quick-sort',
      startPath: '/quick-sort',
      steps: [{ kind: 'capture', label: 'partition' }],
      title: { 'en': 'Quick sort', 'zh-CN': '快速排序' },
    }])
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const revised = service.reviseActivity({
      activityId: activity.activityId,
      baseVersion: activity.version,
      projectId: 'project-a',
      topic: activity.topic,
      video: {
        flowIds: ['quick-sort'],
        format: 'landscape',
        recordingProfile: {
          defaults: {
            viewport: { height: 768, width: 1366 },
          },
        },
      },
    })

    expect(revised.version).toBe(2)
    expect(revised.video?.recordingProfile?.defaults?.viewport).toEqual({ height: 768, width: 1366 })
    expect(revised.videoPlanReviewStatus).toBe('pending')
    expect(repository.getActivity('project-a', activity.activityId, 1)?.video?.recordingProfile)
      .toBeUndefined()
  })

  it('binds publication receipts to the exact activity, content, and channel', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-1',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [registerFinalVideoArtifact(
        service,
        activity,
        'publication-binding-video',
      )],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-1',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-1',
    })

    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: 'youtube',
        contentId: content.contentId,
        kind: 'publication',
        status: 'queued',
        taskId: `publication-${publication.publicationId}`,
      }),
    ]))

    expect(() =>
      service.recordPublicationReceipt({
        activityId: activity.activityId,
        channel: 'github',
        externalReceiptId: 'receipt-1',
        projectId: 'project-a',
        publicationId: publication.publicationId,
        receiptId: 'receipt-1',
        issuedAt: '2026-08-04T00:00:00.000Z',
        source: 'marketing-ops',
        status: 'published',
      }),
    ).toThrow(/channel/i)

    expect(
      service.recordPublicationReceipt({
        activityId: activity.activityId,
        channel: 'youtube',
        externalReceiptId: 'receipt-1',
        projectId: 'project-a',
        publicationId: publication.publicationId,
        receiptId: 'receipt-1',
        issuedAt: '2026-08-04T00:00:00.000Z',
        source: 'marketing-ops',
        status: 'published',
      }),
    ).toMatchObject({
      activityId: activity.activityId,
      channel: 'youtube',
      publicationId: publication.publicationId,
      status: 'published',
    })
    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'publication',
        status: 'published',
        taskId: `publication-${publication.publicationId}`,
      }),
      expect.objectContaining({
        kind: 'monitoring',
        status: 'queued',
        taskId: `monitoring-${publication.publicationId}`,
      }),
    ]))
    expect(service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'receipt-1-repeat',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-1-repeat',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })).toMatchObject({ status: 'published' })
    expect(service.getProjectView('project-a')).toMatchObject({
      publicationPlans: [publication],
      publicationReceipts: expect.arrayContaining([
        expect.objectContaining({ receiptId: 'receipt-1' }),
      ]),
    })
  })

  it('requires a matching marketing-ops receipt for a bound account', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a', 'account-youtube-main')
    const { activity, publication } = createPublication(service)
    const receipt = {
      activityId: activity.activityId,
      channel: 'youtube' as const,
      externalReceiptId: 'external-account-check',
      issuedAt: '2026-08-04T00:00:00.000Z',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-account-check',
      source: 'marketing-ops' as const,
      status: 'published' as const,
    }
    expect(() => service.recordPublicationReceipt(receipt)).toThrow(/account/i)
    expect(() => service.recordPublicationReceipt({
      ...receipt,
      accountRef: 'account-youtube-other',
      receiptId: 'receipt-account-check-other',
    })).toThrow(/account/i)
    expect(service.recordPublicationReceipt({
      ...receipt,
      accountRef: 'account-youtube-main',
    })).toMatchObject({ source: 'marketing-ops', status: 'published' })
  })

  it('rejects mismatched ownership and duplicate immutable records', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    const registered = registerProject(service, 'project-a')

    expect(() =>
      service.registerProject(
        {
          ...registered.project,
          currentSnapshotId: 'wrong-snapshot',
        },
        registered.snapshot,
      ),
    ).toThrow(/ownership/i)
    expect(() => repository.saveProject(registered.project)).toThrow(/already exists/i)
    expect(() => repository.saveProjectSnapshot(registered.snapshot)).toThrow(/already exists/i)

    const binding = enableYouTube(service, 'project-a')
    expect(() => repository.saveProjectChannelBinding(binding)).toThrow(/already exists/i)
    expect(repository.getActivity('project-a', 'unknown')).toBeUndefined()
    expect(repository.getPublicationPlan('project-a', 'unknown')).toBeUndefined()
    expect(repository.getPublicationReceipt('project-a', 'unknown')).toBeUndefined()
  })

  it('rejects missing references and stale activity revisions', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)

    expect(() => createActivity(service)).toThrow(/Project .* was not found/)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)

    expect(() => service.reviseActivity({
      activityId: activity.activityId,
      baseVersion: 0,
      projectId: 'project-a',
      topic: {
        'en': 'Stale',
        'zh-CN': '过期',
      },
    })).toThrow(/moved past/i)
    expect(() => service.promoteActivityArtifact({
      artifactId: 'missing-artifact',
      assetId: 'asset-1',
      kind: 'video',
      projectId: 'project-a',
    })).toThrow(/not found/i)
    expect(() => service.createActivityArtifact({
      activityId: 'missing-activity',
      artifactId: 'artifact-1',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'b'.repeat(64),
    })).toThrow(/not found/i)
  })

  it('rejects content and publication records that cross activity boundaries', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activityA = createActivity(service)
    const activityB = createActivity(service, 'project-a', 'project-a-activity-b')
    const groupA = service.createContentGroup({
      activityId: activityA.activityId,
      contentGroupId: 'group-a',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })

    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      body: 'Missing group',
      channel: 'youtube',
      contentGroupId: 'missing-group',
      contentId: 'content-missing-group',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Missing group',
      artifactIds: [],
    })).toThrow(/not found/i)
    expect(() => service.createChannelContent({
      activityId: activityB.activityId,
      body: 'Wrong group',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-wrong-group',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong group',
      artifactIds: [],
    })).toThrow(/belong to the activity/i)
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      body: 'Wrong channel',
      channel: 'github',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-wrong-channel',
      format: 'article',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong channel',
      artifactIds: [],
    })).toThrow(/activity channel/i)

    expect(() => service.createPublicationPlan({
      activityId: activityA.activityId,
      channel: 'youtube',
      contentId: 'missing-content',
      projectId: 'project-a',
      publicationId: 'publication-missing-content',
    })).toThrow(/not found/i)
  })

  it('binds channel content artifacts to the same activity and rejects duplicates', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activityA = createActivity(service)
    const activityB = createActivity(service, 'project-a', 'project-a-activity-b')
    const groupA = service.createContentGroup({
      activityId: activityA.activityId,
      contentGroupId: 'artifact-group-a',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    service.createActivityArtifact({
      activityId: activityA.activityId,
      artifactId: 'artifact-a',
      kind: 'video-clip',
      projectId: 'project-a',
      relativePath: 'recordings/clip.webm',
      sha256: 'a'.repeat(64),
    })

    // missing artifact
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['missing-artifact'],
      body: 'Missing artifact',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-missing-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Missing artifact',
    })).toThrow(/not found/i)

    // artifact belongs to a different activity: give activity B its own
    // legit group + channel so we isolate the artifact-ownership check
    const groupB = service.createContentGroup({
      activityId: activityB.activityId,
      contentGroupId: 'artifact-group-b',
      coreMessage: 'Other activity',
      projectId: 'project-a',
      title: 'Other activity',
    })
    expect(() => service.createChannelContent({
      activityId: activityB.activityId,
      artifactIds: ['artifact-a'],
      body: 'Wrong activity artifact',
      channel: 'youtube',
      contentGroupId: groupB.contentGroupId,
      contentId: 'content-cross-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Wrong activity artifact',
    })).toThrow(/belong to the activity/i)

    // duplicate artifact id within one content
    expect(() => service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['artifact-a', 'artifact-a'],
      body: 'Duplicate artifact',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-duplicate-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Duplicate artifact',
    })).toThrow(/Duplicate channel content artifact/i)

    // happy path: artifact in the same activity is recorded on the content
    const content = service.createChannelContent({
      activityId: activityA.activityId,
      artifactIds: ['artifact-a'],
      body: 'Happy path',
      channel: 'youtube',
      contentGroupId: groupA.contentGroupId,
      contentId: 'content-with-artifact',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Happy path',
    })
    expect(content.artifactIds).toEqual(['artifact-a'])
    const view = service.getProjectView('project-a')
    expect(view.channelContents.find(item => item.contentId === 'content-with-artifact')?.artifactIds)
      .toEqual(['artifact-a'])
  })

  it('rejects a publication receipt that does not match its saved plan', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-1',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [registerFinalVideoArtifact(
        service,
        activity,
        'receipt-matching-video',
      )],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-1',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-1',
    })

    expect(() => service.recordPublicationReceipt({
      activityId: 'wrong-activity',
      channel: 'youtube',
      externalReceiptId: 'receipt-wrong',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-wrong',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })).toThrow(/match activity/i)
    expect(() => service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'receipt-missing-plan',
      projectId: 'project-a',
      publicationId: 'missing-publication',
      receiptId: 'receipt-missing-plan',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })).toThrow(/not found/i)
  })

  it('creates an owner handoff only for the exact publication plan', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-handoff',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [registerFinalVideoArtifact(
        service,
        activity,
        'owner-handoff-video',
      )],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-handoff',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-handoff',
    })
    const handoff: OwnerHandoff = {
      activityId: activity.activityId,
      artifactChecksums: ['a'.repeat(64)],
      channel: 'youtube',
      checklist: ['确认标题', '确认封面'],
      expiresAt: '2026-08-03T00:00:00.000Z',
      handoffId: 'handoff-1',
      officialTargetUrl: 'https://studio.youtube.com/upload',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      status: 'pending',
    }

    expect(service.createOwnerHandoff(handoff)).toEqual(handoff)
    expect(service.completeOwnerHandoff('project-a', handoff.handoffId)).toMatchObject({
      handoffId: handoff.handoffId,
      status: 'completed',
    })
    expect(service.getProjectView('project-a').ownerHandoffs).toEqual([
      expect.objectContaining({ handoffId: handoff.handoffId, status: 'completed' }),
    ])
    expect(() => service.completeOwnerHandoff('project-a', handoff.handoffId))
      .toThrow(/pending/i)
    expect(service.getProjectView('project-a')).toMatchObject({
      ownerHandoffs: [expect.objectContaining({ handoffId: handoff.handoffId, status: 'completed' })],
      tasks: [
        expect.objectContaining({
          kind: 'production',
          status: 'queued',
        }),
        expect.objectContaining({
          kind: 'publication',
          status: 'awaiting-owner',
          taskId: `publication-${publication.publicationId}`,
        }),
      ],
    })
    expect(() => service.createOwnerHandoff({
      ...handoff,
      handoffId: 'handoff-wrong-activity',
      activityId: 'wrong-activity',
    })).toThrow(/match activity/i)
  })

  it('只允许已发布回执产生监测数据快照', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-observation',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [registerFinalVideoArtifact(
        service,
        activity,
        'observation-video',
      )],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-observation',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-observation',
    })
    const observation: MonitoringObservation = {
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: {
        comments: 2,
        likes: 10,
        replies: null,
        views: 100,
      },
      observationId: 'observation-1',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'public',
    }

    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-failed',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-failed',
      status: 'failed',
    })
    expect(() => service.recordMonitoringObservation(observation))
      .toThrow(/published receipt/i)
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-1',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-observation',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })
    expect(service.recordMonitoringObservation(observation)).toEqual(observation)
    expect(service.getProjectView('project-a').tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'monitoring',
        status: 'monitoring',
        taskId: `monitoring-${publication.publicationId}`,
      }),
    ]))
    expect(service.getProjectView('project-a').monitoringObservations).toEqual([observation])
  })

  it('报告只能引用同一项目和活动的监测快照', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const activity = createActivity(service)
    const group = service.createContentGroup({
      activityId: activity.activityId,
      contentGroupId: 'group-report',
      coreMessage: 'Explain the idea',
      projectId: 'project-a',
      title: 'Quick sort',
    })
    const content = service.createChannelContent({
      activityId: activity.activityId,
      artifactIds: [registerFinalVideoArtifact(
        service,
        activity,
        'report-video',
      )],
      body: 'A video script',
      channel: 'youtube',
      contentGroupId: group.contentGroupId,
      contentId: 'content-report',
      format: 'video',
      locale: 'en',
      projectId: 'project-a',
      title: 'Quick sort explained',
    })
    const publication = service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'youtube',
      contentId: content.contentId,
      projectId: 'project-a',
      publicationId: 'publication-report',
    })
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-report',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-report',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })
    service.recordMonitoringObservation({
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: { views: 100 },
      observationId: 'observation-report',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'authorized-adapter',
    })
    const report: ContentStudioReport = {
      activityId: activity.activityId,
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: { views: 100 },
      observationIds: ['observation-report'],
      projectId: 'project-a',
      reportId: 'report-1',
      scope: 'activity',
    }

    expect(service.createReport(report)).toEqual(report)
    expect(service.getProjectView('project-a').reports).toEqual([report])
    expect(() => service.createReport({
      ...report,
      activityId: 'wrong-activity',
      reportId: 'report-wrong-activity',
    })).toThrow(/activity/i)
    expect(() => service.createReport({
      ...report,
      observationIds: ['missing-observation'],
      reportId: 'report-missing-observation',
    })).toThrow(/observation/i)
  })

  it('拒绝不完整的人工接管、错绑的监测数据和空报告', () => {
    const repository = new InMemoryContentStudioRepository()
    const service = new ContentStudioApplicationService(repository)
    registerProject(service, 'project-a')
    enableYouTube(service, 'project-a')
    const { activity, publication } = createPublication(service)
    service.recordPublicationReceipt({
      activityId: activity.activityId,
      channel: 'youtube',
      externalReceiptId: 'external-invalid',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      receiptId: 'receipt-invalid',
      issuedAt: '2026-08-04T00:00:00.000Z',
      source: 'marketing-ops',
      status: 'published',
    })
    const handoff: OwnerHandoff = {
      activityId: activity.activityId,
      artifactChecksums: ['a'.repeat(64)],
      channel: 'youtube',
      checklist: ['确认标题'],
      expiresAt: '2026-08-03T00:00:00.000Z',
      handoffId: 'handoff-invalid',
      officialTargetUrl: 'https://studio.youtube.com/upload',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      status: 'pending',
    }
    expect(() => service.createOwnerHandoff({
      ...handoff,
      artifactChecksums: [],
    })).toThrow(/checksum/i)
    expect(() => service.createOwnerHandoff({
      ...handoff,
      checklist: [],
    })).toThrow(/checklist/i)
    service.createOwnerHandoff(handoff)
    expect(() => repository.saveOwnerHandoff(handoff)).toThrow(/already exists/i)

    const observation: MonitoringObservation = {
      activityId: activity.activityId,
      channel: 'youtube',
      collectedAt: '2026-08-02T01:00:00.000Z',
      metrics: { views: 100 },
      observationId: 'observation-invalid',
      projectId: 'project-a',
      publicationId: publication.publicationId,
      source: 'owner-entered',
    }
    expect(() => service.recordMonitoringObservation({
      ...observation,
      channel: 'github',
    })).toThrow(/match publication/i)
    service.recordMonitoringObservation(observation)
    expect(() => repository.saveMonitoringObservation(observation))
      .toThrow(/already exists/i)

    expect(() => service.createReport({
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: {},
      observationIds: [],
      projectId: 'project-a',
      reportId: 'empty-report',
      scope: 'project',
    })).toThrow(/at least one observation/i)
    expect(() => service.createReport({
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: {},
      observationIds: ['observation-invalid'],
      projectId: 'project-a',
      reportId: 'missing-activity-report',
      scope: 'activity',
    })).toThrow(/requires an activity/i)
    const report: ContentStudioReport = {
      generatedAt: '2026-08-02T02:00:00.000Z',
      metrics: { views: 100 },
      observationIds: ['observation-invalid'],
      projectId: 'project-a',
      reportId: 'report-invalid',
      scope: 'project',
    }
    service.createReport(report)
    expect(() => repository.saveReport(report)).toThrow(/already exists/i)
    expect(() => repository.savePublicationPlan(publication))
      .toThrow(/already exists/i)
  })
})
