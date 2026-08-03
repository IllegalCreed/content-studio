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
const metadata = ref<{
  dimensions?: string
  duration?: string
} | null>(null)

function formatDuration(seconds: number): string {
  const roundedSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(roundedSeconds / 60)
  return `${minutes}:${String(roundedSeconds % 60).padStart(2, '0')}`
}

function handleImageLoad(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  if (image.naturalWidth === 0 || image.naturalHeight === 0)
    return
  metadata.value = { dimensions: `${image.naturalWidth} × ${image.naturalHeight}` }
}

function handleMediaMetadata(event: Event): void {
  const media = event.currentTarget as HTMLMediaElement
  const nextMetadata: { dimensions?: string, duration?: string } = {}
  if (media.duration !== Infinity && Number.isFinite(media.duration))
    nextMetadata.duration = formatDuration(media.duration)
  const video = media as HTMLVideoElement
  if (video.videoWidth > 0 && video.videoHeight > 0)
    nextMetadata.dimensions = `${video.videoWidth} × ${video.videoHeight}`
  metadata.value = Object.keys(nextMetadata).length > 0 ? nextMetadata : null
}

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

watch(
  () => [props.kind, props.src] as const,
  () => { metadata.value = null },
)
</script>

<template>
  <div class="asset-preview" :data-preview-kind="kind">
    <pre v-if="kind === 'text' && textContent !== null" data-testid="asset-preview-text">{{ textContent }}</pre>
    <p v-else-if="kind === 'text' && loadError" class="asset-preview-empty">文字预览暂时不可用，请检查文件是否仍在登记的项目目录中。</p>
    <p v-else-if="kind === 'text'" class="asset-preview-empty">正在读取文字预览…</p>
    <img v-else-if="kind === 'image' && src" :src="src" :alt="label" loading="lazy" decoding="async" @load="handleImageLoad">
    <video v-else-if="kind === 'video' && src" :src="src" controls preload="metadata" @loadedmetadata="handleMediaMetadata">
      当前浏览器不支持视频预览。
    </video>
    <audio v-else-if="kind === 'audio' && src" :src="src" controls preload="metadata" @loadedmetadata="handleMediaMetadata">
      当前浏览器不支持音频预览。
    </audio>
    <p v-else class="asset-preview-empty">这个素材类型暂不支持在线预览。</p>
    <dl v-if="metadata" class="asset-preview-metadata" data-testid="asset-preview-metadata">
      <div v-if="metadata.dimensions"><dt>尺寸</dt><dd>{{ metadata.dimensions }}</dd></div>
      <div v-if="metadata.duration"><dt>时长</dt><dd>{{ metadata.duration }}</dd></div>
    </dl>
    <a v-if="src" class="asset-preview-download" :href="src" download target="_blank" rel="noreferrer">下载登记文件</a>
  </div>
</template>
