import type { RecorderAttemptReceipt } from '../types'
import { describe, expect, it } from 'vitest'
import {
  InMemoryExecutionTaskStore,
  TaskScopeError,
  TaskStateError,
} from './task'

describe('通用执行任务', () => {
  it('用同一套事件记录视频任务的状态变化', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'task-a',
    })

    store.transitionTask('project-a', 'task-a', 'generating')
    store.transitionTask('project-a', 'task-a', 'recording')
    store.transitionTask('project-a', 'task-a', 'composing')

    expect(store.getTask('project-a', 'task-a')).toMatchObject({
      attempt: 1,
      status: 'composing',
    })
    expect(store.listEvents('project-a', 'task-a').map(event => event.kind))
      .toEqual([
        'task-created',
        'status-changed',
        'status-changed',
        'status-changed',
      ])
  })

  it('保存制作回执并按项目和任务隔离尝试证据', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'video-task',
    })
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'other-task',
    })
    const receipt: RecorderAttemptReceipt = {
      artifactDirectory: '/narrow/output/attempt-1',
      artifacts: [{
        id: 'preview-1',
        kind: 'preview-frame',
        relativePath: 'previews/preview-1.png',
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
      }],
      attempt: 1,
      campaignId: 'activity-a',
      completedActions: 2,
      completedScenes: 1,
      jobId: 'video-task',
      logs: {
        consoleErrors: 0,
        consoleWarnings: 0,
        entries: ['preview-ready'],
        pageErrors: 0,
      },
      outcome: 'succeeded',
      planSha256: 'b'.repeat(64),
      projectId: 'project-a',
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 1920, width: 1080 },
        viewport: { height: 1920, width: 1080 },
      },
      receiptVersion: 1,
      totalActions: 2,
      totalScenes: 1,
    }

    expect(store.saveRecordingReceipt('project-a', 'video-task', receipt)).toEqual(receipt)
    expect(store.listRecordingReceipts('project-a', 'video-task')).toEqual([receipt])
    expect(store.listRecordingReceipts('project-a', 'other-task')).toEqual([])
    expect(() => store.saveRecordingReceipt('project-b', 'video-task', receipt))
      .toThrow(/not available in project/i)
    expect(() => store.saveRecordingReceipt('project-a', 'video-task', receipt))
      .toThrow(/already exists/i)
    expect(() => store.saveRecordingReceipt('project-a', 'other-task', receipt))
      .toThrow(/match the project and task/i)

    store.createTask({
      activityId: 'activity-a',
      kind: 'publication',
      projectId: 'project-a',
      taskId: 'publication-task',
    })
    expect(() => store.saveRecordingReceipt('project-a', 'publication-task', receipt))
      .toThrow(/only production tasks/i)
  })

  it('允许文章明确跳过录制，并留下跳过事件', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      skipStages: ['recording'],
      taskId: 'article-task',
    })

    store.transitionTask('project-a', 'article-task', 'generating')
    store.skipStage('project-a', 'article-task', 'recording')

    expect(store.getTask('project-a', 'article-task')?.status)
      .toBe('composing')
    expect(store.listEvents('project-a', 'article-task')[2]).toMatchObject({
      kind: 'stage-skipped',
      stage: 'recording',
      status: 'composing',
    })
  })

  it('允许导入素材跳过生成，并留下跳过事件', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      skipStages: ['generating'],
      taskId: 'import-task',
    })

    store.skipStage('project-a', 'import-task', 'generating')

    expect(store.getTask('project-a', 'import-task')?.status)
      .toBe('recording')
    expect(store.listEvents('project-a', 'import-task')[1]).toMatchObject({
      kind: 'stage-skipped',
      stage: 'generating',
      status: 'recording',
    })
  })

  it('取消只结束当前尝试，重试会创建新的尝试并保留旧事件', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'retry-task',
    })
    store.transitionTask('project-a', 'retry-task', 'generating')
    store.cancelTask('project-a', 'retry-task')
    store.retryTask('project-a', 'retry-task')

    const task = store.getTask('project-a', 'retry-task')
    const events = store.listEvents('project-a', 'retry-task')
    expect(task).toMatchObject({ attempt: 2, status: 'queued' })
    expect(events.map(event => event.kind)).toEqual([
      'task-created',
      'status-changed',
      'attempt-cancelled',
      'attempt-retried',
    ])
    expect(events[2]?.attempt).toBe(1)
    expect(events[3]).toMatchObject({ attempt: 2, previousAttempt: 1 })
  })

  it('只有匹配的发布回执才能进入已发布', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'publication',
      projectId: 'project-a',
      taskId: 'publish-task',
    })
    for (const status of [
      'generating',
      'recording',
      'composing',
      'awaiting-owner',
    ] as const) {
      store.transitionTask('project-a', 'publish-task', status)
    }

    expect(() =>
      store.transitionTask('project-a', 'publish-task', 'published'),
    ).toThrow(/matching publication receipt/i)
    store.transitionTask('project-a', 'publish-task', 'published', {
      hasMatchingPublicationReceipt: true,
    })
    expect(store.getTask('project-a', 'publish-task')?.status)
      .toBe('published')
  })

  it('全局面板和项目面板查询同一个任务存储，并隔离项目', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'task-a',
    })
    store.createTask({
      activityId: 'activity-b',
      kind: 'monitoring',
      projectId: 'project-b',
      taskId: 'task-b',
    })

    expect(store.listTasks()).toHaveLength(2)
    expect(store.listTasks('project-a').map(task => task.taskId))
      .toEqual(['task-a'])
    expect(() => store.getTask('project-a', 'task-b'))
      .toThrow(TaskScopeError)
  })

  it('不允许绕过任务配置跳过阶段或重试正在运行的任务', () => {
    const store = new InMemoryExecutionTaskStore()
    store.createTask({
      activityId: 'activity-a',
      kind: 'production',
      projectId: 'project-a',
      taskId: 'invalid-task',
    })

    expect(() =>
      store.skipStage('project-a', 'invalid-task', 'recording'),
    ).toThrow(TaskStateError)
    expect(() => store.retryTask('project-a', 'invalid-task'))
      .toThrow(TaskStateError)
    expect(() => store.transitionTask('project-a', 'invalid-task', 'queued'))
      .toThrow(TaskStateError)
    expect(() => store.transitionTask('project-a', 'invalid-task', 'composing'))
      .toThrow(TaskStateError)
    expect(() => store.cancelTask('project-a', 'invalid-task'))
      .not
      .toThrow()
  })

  it('对不存在的任务返回明确的任务错误', () => {
    const store = new InMemoryExecutionTaskStore()
    expect(() => store.listRecordingReceipts('project-a', 'missing-task'))
      .toThrow(/was not found/i)
  })
})
