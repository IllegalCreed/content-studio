import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import ActivityDetailPage from './pages/ActivityDetailPage.vue'
import ProjectImportPage from './pages/ProjectImportPage.vue'
import WorkbenchApp from './WorkbenchApp.vue'

const routes = [
  {
    path: '/',
    redirect: '/overview',
  },
  {
    component: ActivityDetailPage,
    path: '/project/:projectId/activities/:activityId',
  },
  {
    component: ProjectImportPage,
    path: '/import-project',
  },
  {
    component: ActivityDetailPage,
    path: '/project/activities/:activityId',
  },
  {
    component: WorkbenchApp,
    path: '/:pathMatch(.*)*',
  },
]

export function createWorkbenchRouter(test = false) {
  return createRouter({
    history: test ? createMemoryHistory() : createWebHistory(),
    routes,
  })
}

export const router = createWorkbenchRouter()
