import { describe, expect, it } from 'vitest'
import { createWorkbenchRouter } from './router'

describe('workbench routes', () => {
  it('将根路径重定向到总览', async () => {
    const router = createWorkbenchRouter(true)

    await router.push('/')
    await router.isReady()

    expect(router.currentRoute.value.path).toBe('/overview')
  })

  it('为活动详情提供可深链接的路由', async () => {
    const router = createWorkbenchRouter(true)

    await router.push('/project/activities/quick-sort-guide')
    await router.isReady()

    expect(router.currentRoute.value.params.activityId).toBe('quick-sort-guide')
    expect(router.currentRoute.value.matched[0]?.components?.default).toBeDefined()
  })

  it('为跨项目活动详情保留项目作用域', async () => {
    const router = createWorkbenchRouter(true)

    await router.push('/project/project-b/activities/quick-sort-guide')
    await router.isReady()

    expect(router.currentRoute.value.params.projectId).toBe('project-b')
    expect(router.currentRoute.value.params.activityId).toBe('quick-sort-guide')
    expect(router.currentRoute.value.matched[0]?.components?.default).toBeDefined()
  })
})
