import type { VideoJobProjection } from '../model'
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

describe('video job panel', () => {
  it('展示真实预览帧、产物链接和日志摘要', () => {
    const wrapper = mount(VideoJobPanel, {
      props: {
        job,
        runtimeConnected: true,
      },
    })

    expect(wrapper.get('img.preview-image').attributes('src')).toBe(job.previewUrl)
    expect(wrapper.text()).toContain('preview-1.png')
    expect(wrapper.text()).toContain('控制台错误 0 · 警告 1 · 页面错误 0')
    expect(wrapper.get('a[download]').attributes('href')).toBe(job.artifacts[0]!.url)
  })
})
