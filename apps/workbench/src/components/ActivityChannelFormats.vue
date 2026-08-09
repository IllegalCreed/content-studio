<script setup lang="ts">
import type { ContentFormat } from '@content-studio/core-types'
import type { ChannelProjection } from '../model'

const props = defineProps<{
  channel: ChannelProjection
  selectedFormats: readonly ContentFormat[]
}>()

const emit = defineEmits<{
  toggle: [format: ContentFormat]
}>()

function isSelected(format: ContentFormat): boolean {
  return props.selectedFormats.includes(format)
}

function isOnlySelectedFormat(format: ContentFormat): boolean {
  return isSelected(format) && props.selectedFormats.length === 1
}
</script>

<template>
  <section class="activity-channel-formats" :aria-label="`${props.channel.channel} 内容形态`">
    <p>本次活动的内容形态</p>
    <div class="activity-channel-format-list">
      <label
        v-for="form in props.channel.contentForms ?? []"
        :key="form.format"
        class="activity-channel-format-option"
        :class="{ selected: isSelected(form.format) }"
      >
        <input
          :checked="isSelected(form.format)"
          :disabled="isOnlySelectedFormat(form.format)"
          :name="`activity-channel-${props.channel.channel}-format`"
          type="checkbox"
          :value="form.format"
          @change="emit('toggle', form.format)"
        />
        <span>
          <strong>{{ form.label }}</strong>
          <small>{{ form.mediaSummary }} · 标题 {{ form.titleLimit }} 字 · 正文 {{ form.bodyLimit }} 字</small>
        </span>
      </label>
    </div>
  </section>
</template>
