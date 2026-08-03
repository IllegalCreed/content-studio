<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

type ModuleId =
  | 'overview'
  | 'project'
  | 'activities'
  | 'tasks'
  | 'project-tasks'
  | 'channels'
  | 'assets'
  | 'owner'
  | 'reports'

interface ModuleLink {
  id: ModuleId
  label: string
  scope: 'global' | 'project'
}

const props = defineProps<{
  projectId: string
  projectName: string
  runtimeConnected: boolean
}>()

const route = useRoute()
const projectPickerOpen = ref(false)

const emit = defineEmits<{
  navigate: [moduleId: ModuleId]
}>()

const globalModules: ModuleLink[] = [
  { id: 'overview', label: '总览', scope: 'global' },
  { id: 'tasks', label: '任务面板', scope: 'global' },
  { id: 'channels', label: '渠道管理', scope: 'global' },
]

const projectModules: ModuleLink[] = [
  { id: 'project', label: '项目概览', scope: 'project' },
  { id: 'activities', label: '发布活动', scope: 'project' },
  { id: 'project-tasks', label: '项目任务面板', scope: 'project' },
  { id: 'assets', label: '项目素材库', scope: 'project' },
  { id: 'owner', label: '待人工处理', scope: 'project' },
  { id: 'reports', label: '项目报告', scope: 'project' },
]

const activeModule = computed<ModuleId>(() => {
  const path = route.path
  if (path === '/overview' || path === '/')
    return 'overview'
  if (path.startsWith('/tasks'))
    return 'tasks'
  if (path.startsWith('/channels'))
    return 'channels'
  if (path.startsWith('/project/tasks'))
    return 'project-tasks'
  if (path.startsWith('/project/assets'))
    return 'assets'
  if (path.startsWith('/project/owner'))
    return 'owner'
  if (path.startsWith('/project/reports'))
    return 'reports'
  if (path.startsWith('/project/activities'))
    return 'activities'
  return 'project'
})

const paths: Record<ModuleId, string> = {
  activities: '/project/activities',
  assets: '/project/assets',
  channels: '/channels',
  overview: '/overview',
  owner: '/project/owner',
  project: '/project',
  'project-tasks': '/project/tasks',
  reports: '/project/reports',
  tasks: '/tasks',
}

function toggleProjectPicker(): void {
  projectPickerOpen.value = !projectPickerOpen.value
}
</script>

<template>
  <div class="workbench-shell" data-testid="workbench-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <aside class="sidebar">
      <RouterLink class="brand" to="/overview" aria-label="Content Studio 首页">
        <span class="brand-mark">CS</span>
        <span>
          Content Studio
          <small>内容生产控制面</small>
        </span>
      </RouterLink>

      <nav data-testid="module-nav" aria-label="全局控制台">
        <p>全局控制台</p>
        <RouterLink
          v-for="(module, index) in globalModules"
          :key="module.id"
          :to="paths[module.id]"
          :data-module="module.id"
          :class="{ active: module.id === activeModule }"
          :aria-current="module.id === activeModule ? 'page' : undefined"
          @click="emit('navigate', module.id)"
        >
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          {{ module.label }}
        </RouterLink>
      </nav>

      <nav class="project-nav" aria-label="当前项目">
        <p>当前项目</p>
        <RouterLink
          v-for="(module, index) in projectModules"
          :key="module.id + '-project'"
          :to="paths[module.id]"
          :data-module="module.id"
          :class="{ active: module.id === activeModule }"
          :aria-current="module.id === activeModule ? 'page' : undefined"
          @click="emit('navigate', module.id)"
        >
          <span>{{ String(index + 1).padStart(2, '0') }}</span>
          {{ module.label }}
        </RouterLink>
      </nav>

      <div class="boundary-note">
        <p class="eyebrow">安全边界</p>
        <strong>本地负责生产，<br>发布交给授权流程。</strong>
        <p>真实渠道写入仍需要独立的 <code>marketing-ops</code> 授权回执。</p>
      </div>
    </aside>

    <main id="main-content">
      <header class="topbar">
        <div>
          <span class="live-dot" />
          本地控制面 · {{ props.runtimeConnected ? '实时数据' : '演示数据' }}
        </div>
        <div class="project-control">
          <button
            type="button"
            class="project-switcher"
            aria-label="切换项目"
            aria-haspopup="listbox"
            :aria-expanded="projectPickerOpen"
            @click="toggleProjectPicker"
          >
            <span class="project-switcher-label">当前项目</span>
            <strong>{{ props.projectName }}</strong>
            <svg class="project-switcher-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="m2.25 4.25 3.75 3.75 3.75-3.75" />
            </svg>
          </button>
          <div v-if="projectPickerOpen" class="project-menu" data-testid="project-menu" role="listbox" aria-label="项目列表">
            <p class="project-menu-label">切换项目</p>
            <button type="button" class="project-option active" role="option" aria-selected="true" disabled>
              <span><strong>{{ props.projectName }}</strong><small>{{ props.projectId }}</small></span>
              <em>当前</em>
            </button>
            <p class="project-menu-empty">暂无其他已注册项目</p>
          </div>
        </div>
      </header>
      <slot />
    </main>
  </div>
</template>
