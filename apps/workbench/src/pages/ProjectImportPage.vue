<script setup lang="ts">
import type { ProjectManifest } from '@content-studio/core-types'
import { validateProjectManifest } from '../../../../src/validation'
import {
  computed,
  nextTick,
  reactive,
  ref,
} from 'vue'
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
  projectId: '',
  repositoryUrl: '',
  tagline: '',
})

const submitting = ref(false)
const submitError = ref<string | null>(null)
const registered = ref(false)

interface ManifestValidation {
  error: string | null
  manifest: ProjectManifest | null
}

const inferredProjectId = computed(() => toProjectId(form.name))

const formValidation = computed<ManifestValidation>(() => {
  const name = form.name.trim()
  const canonicalUrl = form.canonicalUrl.trim()
  if (name === '' || canonicalUrl === '')
    return { error: null, manifest: null }
  const projectId = form.projectId.trim() || inferredProjectId.value
  if (projectId === '') {
    return {
      error: '当前名称无法自动生成 projectId，请填写小写 kebab-case 标识。',
      manifest: null,
    }
  }
  const sourceAccess = form.mode
  const captureMode = sourceAccess === 'source-owned'
    ? 'deterministic'
    : 'assisted'
  const tagline = form.tagline.trim() === '' ? name : form.tagline.trim()
  try {
    return {
      error: null,
      manifest: validateProjectManifest({
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
        ...(sourceAccess === 'web-assisted'
          ? { repeatability: 'low' as const }
          : {}),
      }),
    }
  }
  catch (error: unknown) {
    return {
      error: errorMessage(error, '项目表单无效'),
      manifest: null,
    }
  }
})

const formManifest = computed<ProjectManifest | null>(
  () => formValidation.value.manifest,
)
const formError = computed<string | null>(() => formValidation.value.error)

const previewManifest = computed<ProjectManifest | null>(
  () => mode.value === 'form' ? formManifest.value : manifest.value,
)

function parseJson(): void {
  jsonError.value = null
  try {
    const parsed = JSON.parse(jsonText.value) as unknown
    manifest.value = validateProjectManifest(parsed)
  }
  catch (error: unknown) {
    jsonError.value = errorMessage(error, '项目清单 JSON 无效')
    manifest.value = null
  }
}

function selectMode(nextMode: ImportMode): void {
  mode.value = nextMode
  manifest.value = null
  jsonError.value = null
  submitError.value = null
}

async function onTabKeydown(event: KeyboardEvent): Promise<void> {
  let nextMode: ImportMode | undefined
  if (event.key === 'ArrowLeft' || event.key === 'Home')
    nextMode = 'form'
  if (event.key === 'ArrowRight' || event.key === 'End')
    nextMode = 'upload'
  if (nextMode === undefined)
    return
  event.preventDefault()
  selectMode(nextMode)
  await nextTick()
  document.getElementById(`import-tab-${nextMode}`)?.focus()
}

async function confirmImport(): Promise<void> {
  const target = previewManifest.value
  if (target === null)
    return
  submitting.value = true
  submitError.value = null
  try {
    await runtime.value.registerProject(validateProjectManifest(target))
    registered.value = true
  }
  catch (error: unknown) {
    submitError.value = errorMessage(error, '登记项目失败')
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
</script>

<template>
  <section class="import-page" data-testid="import-page" aria-label="导入项目">
    <header class="import-header">
      <div class="import-heading-copy">
        <p class="eyebrow">项目注册</p>
        <h1>导入项目</h1>
        <p>生成或粘贴项目清单，确认后登记到本地项目注册表。登记只收录用户明确确认的项目。</p>
      </div>
      <RouterLink class="import-back-link" to="/overview">返回总览</RouterLink>
    </header>

    <div
      v-if="registered"
      class="import-success"
      data-testid="import-success"
      role="status"
    >
      <span aria-hidden="true">✓</span>
      <div>
        <strong>项目已登记</strong>
        <p><code>{{ previewManifest?.projectId }}</code> 已加入本地项目注册表。</p>
        <RouterLink to="/overview">前往总览</RouterLink>
      </div>
    </div>

    <div v-else class="import-layout">
      <section class="import-editor" aria-label="项目清单编辑器">
        <div
          class="import-tabs"
          role="tablist"
          aria-label="导入方式"
          @keydown="onTabKeydown"
        >
          <button
            id="import-tab-form"
            type="button"
            aria-controls="import-panel-form"
            :aria-selected="mode === 'form'"
            :class="{ active: mode === 'form' }"
            data-testid="import-tab-form"
            role="tab"
            :tabindex="mode === 'form' ? 0 : -1"
            @click="selectMode('form')"
          >
            引导表单
          </button>
          <button
            id="import-tab-upload"
            type="button"
            aria-controls="import-panel-upload"
            :aria-selected="mode === 'upload'"
            :class="{ active: mode === 'upload' }"
            data-testid="import-tab-upload"
            role="tab"
            :tabindex="mode === 'upload' ? 0 : -1"
            @click="selectMode('upload')"
          >
            粘贴 project.json
          </button>
        </div>

        <form
          v-if="mode === 'form'"
          id="import-panel-form"
          class="import-form"
          data-testid="import-form"
          role="tabpanel"
          aria-labelledby="import-tab-form"
          @submit.prevent="confirmImport"
        >
          <label class="import-field">
            <span>项目名称 <em>必填</em></span>
            <input
              v-model="form.name"
              autocomplete="organization"
              data-testid="import-name"
              name="project-name"
              placeholder="例如 Algorithm Visualizer"
              required
              type="text"
            >
          </label>
          <label class="import-field">
            <span>projectId</span>
            <input
              v-model="form.projectId"
              aria-describedby="project-id-help"
              autocomplete="off"
              data-testid="import-project-id"
              name="project-id"
              :placeholder="inferredProjectId || '例如 algorithm-visualizer'"
              spellcheck="false"
              type="text"
            >
            <small id="project-id-help">
              {{ inferredProjectId ? `留空时使用 ${inferredProjectId}` : '中文名称请填写小写 kebab-case 标识' }}
            </small>
          </label>
          <label class="import-field import-field-wide">
            <span>官方站点 URL <em>必填</em></span>
            <input
              v-model="form.canonicalUrl"
              autocomplete="url"
              data-testid="import-url"
              inputmode="url"
              name="canonical-url"
              placeholder="https://example.com/"
              required
              type="url"
            >
          </label>
          <fieldset class="import-mode-fieldset import-field-wide">
            <legend>接入模式</legend>
            <div class="import-radio-grid">
              <label class="import-radio">
                <input
                  v-model="form.mode"
                  data-testid="import-mode-source"
                  name="source-access"
                  type="radio"
                  value="source-owned"
                >
                <span>
                  <strong>有源项目</strong>
                  <small>有源代码，使用确定性录制。</small>
                </span>
              </label>
              <label class="import-radio">
                <input
                  v-model="form.mode"
                  data-testid="import-mode-web"
                  name="source-access"
                  type="radio"
                  value="web-assisted"
                >
                <span>
                  <strong>无源项目</strong>
                  <small>仅线上网页，使用浏览器辅助。</small>
                </span>
              </label>
            </div>
          </fieldset>
          <label class="import-field import-field-wide">
            <span>源代码仓库 URL <em>可选</em></span>
            <input
              v-model="form.repositoryUrl"
              autocomplete="url"
              data-testid="import-repository"
              inputmode="url"
              name="repository-url"
              placeholder="https://github.com/owner/project"
              type="url"
            >
          </label>
          <label class="import-field import-field-wide">
            <span>一句话定位 <em>可选</em></span>
            <input
              v-model="form.tagline"
              autocomplete="off"
              data-testid="import-tagline"
              name="tagline"
              placeholder="项目定位将作为事实草稿"
              type="text"
            >
          </label>
        </form>

        <form
          v-else
          id="import-panel-upload"
          class="import-upload"
          data-testid="import-upload"
          role="tabpanel"
          aria-labelledby="import-tab-upload"
          @submit.prevent="parseJson"
        >
          <label class="import-field">
            <span>project.json 内容</span>
            <textarea
              v-model="jsonText"
              autocomplete="off"
              data-testid="import-json"
              name="project-json"
              placeholder="粘贴项目清单 JSON"
              rows="14"
              spellcheck="false"
              @input="jsonError = null"
            ></textarea>
          </label>
          <button class="import-secondary-button" data-testid="import-parse" type="submit">
            校验并生成摘要
          </button>
        </form>

        <p
          v-if="mode === 'form' && formError"
          class="import-error"
          data-testid="import-form-error"
          aria-live="polite"
        >
          {{ formError }}
        </p>
        <p
          v-if="jsonError"
          class="import-error"
          data-testid="import-error"
          role="alert"
        >
          {{ jsonError }}
        </p>
      </section>

      <section
        v-if="previewManifest"
        class="import-preview"
        data-testid="import-preview"
        aria-label="清单摘要"
      >
        <div class="import-preview-heading">
          <div>
            <p class="eyebrow">校验通过</p>
            <h2>清单摘要</h2>
          </div>
          <span>可登记</span>
        </div>
        <dl>
          <div>
            <dt>projectId</dt>
            <dd data-testid="preview-project-id"><code>{{ previewManifest.projectId }}</code></dd>
          </div>
          <div>
            <dt>名称</dt>
            <dd>{{ previewManifest.name }}</dd>
          </div>
          <div>
            <dt>接入模式</dt>
            <dd data-testid="preview-mode">{{ previewManifest.sourceAccess }}</dd>
          </div>
          <div>
            <dt>站点</dt>
            <dd>{{ previewManifest.canonicalUrl }}</dd>
          </div>
          <div>
            <dt>仓库</dt>
            <dd>{{ previewManifest.repositoryUrl }}</dd>
          </div>
          <div>
            <dt>内容</dt>
            <dd>{{ previewManifest.facts.length }} 条事实 · {{ previewManifest.captureFlows.length }} 条拍摄流</dd>
          </div>
        </dl>
        <p class="import-note">
          登记不会扫描项目目录，也不会配置渠道或读取凭据。
        </p>
        <button
          class="import-primary-button"
          :disabled="submitting"
          data-testid="import-confirm"
          type="button"
          @click="confirmImport"
        >
          {{ submitting ? '登记中…' : '确认登记项目' }}
        </button>
        <p
          v-if="submitError"
          class="import-error"
          data-testid="import-submit-error"
          role="alert"
        >
          {{ submitError }}
        </p>
      </section>

      <aside v-else class="import-preview import-preview-empty" aria-label="等待清单摘要">
        <span aria-hidden="true">01</span>
        <h2>等待有效清单</h2>
        <p>完成左侧必填项，或粘贴并校验现有的 <code>project.json</code>。</p>
      </aside>
    </div>
  </section>
</template>
