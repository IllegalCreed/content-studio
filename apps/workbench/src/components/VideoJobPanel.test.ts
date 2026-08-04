import type { VideoJobProjection, VideoPlanProjection } from '../model'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import VideoJobPanel from './VideoJobPanel.vue'

const job: VideoJobProjection = {
  artifacts: [{
    id: 'preview-1',
    kind: 'preview-frame',
    name: 'preview-1.png',
    relativePath: 'previews/preview-1.png',
    size: '42 B',
    url: '/api/v1/projects/project-a/tasks/task-a/recording-attempts/1/artifacts/preview-1',
  }],
  attempt: 1,
  completedActions: 2,
  events: [{ kind: 'attempt-completed', message: '本轮完成', sequence: 1 }],
  jobId: 'task-a',
  logs: {
    consoleErrors: 0,
    consoleWarnings: 1,
    entries: ['console:warning'],
    pageErrors: 0,
  },
  outcome: '已完成',
  previewLabel: 'preview-1.png',
  previewUrl: '/api/v1/projects/project-a/tasks/task-a/recording-attempts/1/artifacts/preview-1',
  totalActions: 3,
}

const videoPlan: VideoPlanProjection = {
  format: 'portrait',
  planVersion: 1,
  reviewStatus: '已确认',
  viewport: { height: 1920, width: 1080 },
  scenes: [{
    actions: [
      { kind: 'wait-for', label: '等待拒绝按钮' },
      { kind: 'click', label: '点击拒绝按钮' },
      { kind: 'capture', label: '截取分区动画' },
    ],
    flowId: 'flow-a',
    objective: '展示分区过程',
    startPath: '/quick-sort',
    title: '快速排序 · 分区过程',
  }],
}

describe('video job panel', () => {
  it('展示真实预览帧、产物链接和日志摘要', () => {
    const wrapper = mount(VideoJobPanel, {
      props: {
        job,
        videoPlan,
        runtimeConnected: true,
        taskTitle: '录制快速排序演示视频',
        activityTitle: '快速排序可视化指南',
        contentTitle: '快速排序演示视频',
        channel: 'bilibili',
        accountAlias: 'Algorithm Visualizer',
      },
    })

    expect(wrapper.get('img.preview-image').attributes('src')).toBe(job.previewUrl)
    expect(wrapper.get('.video-job-context').text()).toContain('快速排序可视化指南')
    expect(wrapper.get('.video-job-context').text()).toContain('bilibili')
    expect(wrapper.get('.video-progress-summary').text()).toContain('动作进度')
    expect(wrapper.get('.video-progress-summary').text()).toContain('2 / 3 个动作')
    expect(wrapper.findAll('.panel-heading > .video-progress-summary')).toHaveLength(0)
    expect(wrapper.findAll('.video-progress-block > .video-progress-summary')).toHaveLength(1)
    expect(wrapper.get('[data-testid="recording-action-progress"]').attributes()).toMatchObject({
      'aria-valuemax': '100',
      'aria-valuemin': '0',
      'aria-valuenow': '67',
      'role': 'progressbar',
    })
    expect(wrapper.get('[data-testid="recording-action-list"]').text()).toContain('快速排序 · 分区过程')
    expect(wrapper.get('[data-testid="recording-action-list"]').text()).toContain('点击拒绝按钮')
    expect(wrapper.findAll('[data-testid="recording-action-list"] [data-action-status="done"]').map(item => item.text()).join(' ')).toContain('点击拒绝按钮')
    expect(wrapper.get('[data-testid="recording-action-list"] [data-action-status="active"]').text()).toContain('截取分区动画')
    expect(wrapper.text()).toContain('preview-1.png')
    expect(wrapper.text()).toContain('控制台错误 0 · 警告 1 · 页面错误 0')
    expect(wrapper.get('a[download]').attributes('href')).toBe(job.artifacts[0]!.url)
    expect(wrapper.find('.preview-placeholder').exists()).toBe(false)
  })

  it('没有预览帧时明确显示缺失状态，不伪造录制画面', () => {
    const wrapper = mount(VideoJobPanel, {
      props: {
        job: { ...job, previewUrl: undefined, previewLabel: '暂无预览帧' },
        videoPlan,
        runtimeConnected: false,
        taskTitle: '录制快速排序演示视频',
        activityTitle: '快速排序可视化指南',
        contentTitle: '快速排序演示视频',
        channel: 'bilibili',
        accountAlias: 'Algorithm Visualizer',
      },
    })

    expect(wrapper.get('.preview-placeholder').text()).toContain('暂无预览帧')
    expect(wrapper.find('.preview-orbit').exists()).toBe(false)
    expect(wrapper.find('.preview-bars').exists()).toBe(false)
  })
})
