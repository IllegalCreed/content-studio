<script setup lang="ts">
import type { ProjectManifest } from '@content-studio/core-types'
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { createWorkbenchRuntime, type WorkbenchRuntime } from '../runtime'

const props = withDefaults(defineProps<{
  runtime?: WorkbenchRuntime
}>(), {
  runtime: undefined,
})

const runtime = computed(() => props.runtime ?? createWorkbenchRuntime())

type ImportMode = 'form' | 'upload'
const mode = ref<ImportMode>('form')
const jsonText = ref('')
const jsonError = ref<string | null>(null)
const manifest = ref<ProjectManifest | null>(null)

const form = reactive({
  canonicalUrl: '',
  mode: 'web-assisted' as 'source-owned' | 'web-assisted',
  name: '',
  repositoryUrl: '',
  tagline: '',
})

const submitting = ref(false)
const submitError = ref<string | null>(null)
const registered = ref(false)

const formManifest = computed<ProjectManifest | null>(() => {
  const name = form.name.trim()
  const canonicalUrl = form.canonicalUrl.trim()
  if (name === '' || canonicalUrl === '')
    return null
  const projectId = toProjectId(name)
  if (projectId === '')
    return null
  const sourceAccess = form.mode
  const captureMode = sourceAccess === 'source-owned'
    ? 'deterministic'
    : 'assisted'
  const tagline = form.tagline.trim() === '' ? name : form.tagline.trim()
  return {
    schemaVersion: 1,
    projectId,
    name,
    canonicalUrl,
    repositoryUrl: form.repositoryUrl.trim() === ''
      ? 'https://example.invalid/'
      : form.repositoryUrl.trim(),
    locales: ['zh-CN', 'en'],
    tagline: {
      'en': tagline,
      'zh-CN': tagline,
    },
    facts: [],
    captureFlows: [],
    sourceAccess,
    captureMode,
    ...(sourceAccess === 'web-assisted' ? { repeatability: 'low' as const } : {}),
  }
})

const previewManifest = computed<ProjectManifest | null>(
  () => manifest.value ?? formManifest.value,
)

function parseJson(): void {
  jsonError.value = null
  try {
    const parsed = JSON.parse(jsonText.value) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('项目清单必须是 JSON 对象')
    manifest.value = parsed as ProjectManifest
  }
  catch (error) {
    jsonError.value = error instanceof Error
      ? error.message
      : '项目清单 JSON 无效'
    manifest.value = null
  }
}

function useForm(): void {
  mode.value = 'form'
  manifest.value = null
  jsonError.value = null
}

function useUpload(): void {
  mode.value = 'upload'
  manifest.value = null
  jsonError.value = null
}

async function confirmImport(): Promise<void> {
  const target = previewManifest.value
  if (target === null)
    return
  submitting.value = true
  submitError.value = null
  try {
    await runtime.value.registerProject(target)
    registered.value = true
  }
  catch (error) {
    submitError.value = error instanceof Error
      ? error.message
      : '登记项目失败'
  }
  finally {
    submitting.value = false
  }
}

function toProjectId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
</script>

<template>
  <section class="import-page" data-testid="import-page" aria-label="导入项目">
    <header class="import-header">
      <div>
        <p class="eyebrow">项目注册</p>
        <h1>导入项目</h1>
        <p>生成或粘贴项目清单，确认后登记到本地项目注册表。登记只收录用户明确确认的项目。</p>
      </div>
      <RouterLink to="/overview">返回总览</RouterLink>
    </header>

    <div v-if="registered" class="import-success" data-testid="import-success" aria-live="polite">
      <strong>项目已登记</strong>
      <p>{{ previewManifest?.projectId }} 已加入本地项目注册表。</p>
      <RouterLink to="/overview">前往总览</RouterLink>
    </div>

    <template v-else>
      <div class="import-tabs" role="tablist" aria-label="导入方式">
        <button
          type="button"
          :aria-selected="mode === 'form'"
          :class="{ active: mode === 'form' }"
          data-testid="import-tab-form"
          role="tab"
          @click="useForm"
        >
          引导表单
        </button>
        <button
          type="button"
          :aria-selected="mode === 'upload'"
          :class="{ active: mode === 'upload' }"
          data-testid="import-tab-upload"
          role="tab"
          @click="useUpload"
        >
          粘贴 project.json
        </button>
      </div>

      <form v-if="mode === 'form'" class="import-form" data-testid="import-form" @submit.prevent="confirmImport">
        <label>
          项目名称
          <input
            v-model="form.name"
            data-testid="import-name"
            placeholder="例如 Algorithm Visualizer"
            type="text"
          >
        </label>
        <label>
          官方站点 URL
          <input
            v-model="form.canonicalUrl"
            data-testid="import-url"
            placeholder="https://example.com/"
            type="url"
          >
        </label>
        <fieldset>
          <legend>接入模式</legend>
          <label>
            <input v-model="form.mode" data-testid="import-mode-source" type="radio" value="source-owned">
            有源项目（有源代码，确定性录制）
          </label>
          <label>
            <input v-model="form.mode" data-testid="import-mode-web" type="radio" value="web-assisted">
            无源项目（仅线上网页，浏览器辅助）
          </label>
        </fieldset>
        <label>
          源代码仓库 URL（可选）
          <input
            v-model="form.repositoryUrl"
            data-testid="import-repository"
            placeholder="https://github.com/owner/project"
            type="url"
          >
        </label>
        <label>
          一句话定位（可选）
          <input
            v-model="form.tagline"
            data-testid="import-tagline"
            placeholder="项目定位将作为事实草稿"
            type="text"
          >
        </label>
      </form>

      <form v-else class="import-upload" data-testid="import-upload" @submit.prevent="parseJson">
        <label>
          project.json 内容
          <textarea
            v-model="jsonText"
            data-testid="import-json"
            placeholder="粘贴或拖入项目清单 JSON"
            rows="12"
          />
        </label>
        <button data-testid="import-parse" type="submit">解析清单</button>
      </form>

      <p v-if="jsonError" class="import-error" data-testid="import-error" aria-live="polite">
        {{ jsonError }}
      </p>

      <section v-if="previewManifest" class="import-preview" data-testid="import-preview" aria-label="清单摘要">
        <h2>清单摘要</h2>
        <dl>
          <dt>projectId</dt>
          <dd data-testid="preview-project-id">{{ previewManifest.projectId }}</dd>
          <dt>名称</dt>
          <dd>{{ previewManifest.name }}</dd>
          <dt>接入模式</dt>
          <dd data-testid="preview-mode">{{ previewManifest.sourceAccess }}</dd>
          <dt>站点</dt>
          <dd>{{ previewManifest.canonicalUrl }}</dd>
          <dt>仓库</dt>
          <dd>{{ previewManifest.repositoryUrl }}</dd>
          <dt>内容</dt>
          <dd>{{ previewManifest.facts.length }} 条事实 · {{ previewManifest.captureFlows.length }} 条拍摄流</dd>
        </dl>
        <p class="import-note">
          登记不会扫描项目目录，也不会配置渠道或读取凭据。
        </p>
        <button
          :disabled="submitting"
          data-testid="import-confirm"
          type="button"
          @click="confirmImport"
        >
          {{ submitting ? '登记中…' : '确认登记项目' }}
        </button>
      </section>

      <p v-if="submitError" class="import-error" data-testid="import-submit-error" aria-live="polite">
        {{ submitError }}
      </p>
    </template>
  </section>
</template>
