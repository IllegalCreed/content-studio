<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AssetPreviewKind } from '../model'

const props = defineProps<{
  kind: AssetPreviewKind
  label: string
  src?: string
  text?: string
}>()

const textContent = ref<string | null>(props.text ?? null)
const loadError = ref(false)

async function loadTextPreview(): Promise<void> {
  loadError.value = false
  if (props.kind !== 'text' || props.text !== undefined || props.src === undefined) {
    textContent.value = props.text ?? null
    return
  }
  textContent.value = null
  try {
    const response = await fetch(props.src, { headers: { accept: 'text/plain, text/markdown' } })
    if (!response.ok)
      throw new Error(`Preview request failed (${response.status})`)
    textContent.value = await response.text()
  }
  catch {
    loadError.value = true
  }
}

watch(
  () => [props.kind, props.src, props.text] as const,
  () => { void loadTextPreview() },
  { immediate: true },
)
</script>

<template>
  <div class="asset-preview" :data-preview-kind="kind">
    <pre v-if="kind === 'text' && textContent !== null" data-testid="asset-preview-text">{{ textContent }}</pre>
    <p v-else-if="kind === 'text' && loadError" class="asset-preview-empty">文字预览暂时不可用，请检查文件是否仍在登记的项目目录中。</p>
    <p v-else-if="kind === 'text'" class="asset-preview-empty">正在读取文字预览…</p>
    <img v-else-if="kind === 'image' && src" :src="src" :alt="label">
    <video v-else-if="kind === 'video' && src" :src="src" controls preload="metadata">
      当前浏览器不支持视频预览。
    </video>
    <audio v-else-if="kind === 'audio' && src" :src="src" controls preload="metadata">
      当前浏览器不支持音频预览。
    </audio>
    <p v-else class="asset-preview-empty">这个素材类型暂不支持在线预览。</p>
    <a v-if="src" class="asset-preview-download" :href="src" download target="_blank" rel="noreferrer">下载登记文件</a>
  </div>
</template>
