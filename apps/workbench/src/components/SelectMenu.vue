<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface SelectMenuOption {
  disabled?: boolean
  label: string
  value: string
}

const props = withDefaults(defineProps<{
  ariaLabel?: string
  disabled?: boolean
  modelValue: string
  options: readonly SelectMenuOption[]
}>(), {
  ariaLabel: '选择一项',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)

const selectedOption = computed(() =>
  props.options.find(option => option.value === props.modelValue)
  ?? props.options.find(option => !option.disabled)
  ?? props.options[0],
)

function selectableIndexes(): number[] {
  return props.options
    .map((option, index) => option.disabled ? -1 : index)
    .filter(index => index >= 0)
}

function openMenu(): void {
  if (props.disabled || props.options.length === 0)
    return
  const selectedIndex = props.options.findIndex(option => option.value === props.modelValue && !option.disabled)
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : selectableIndexes()[0] ?? 0
  open.value = true
}

function closeMenu(): void {
  open.value = false
}

function toggleMenu(): void {
  if (open.value)
    closeMenu()
  else
    openMenu()
}

function choose(option: SelectMenuOption): void {
  if (props.disabled || option.disabled)
    return
  emit('update:modelValue', option.value)
  closeMenu()
  void nextTick(() => root.value?.querySelector<HTMLButtonElement>('[data-testid="select-trigger"]')?.focus())
}

function focusActiveOption(): void {
  void nextTick(() => root.value
    ?.querySelectorAll<HTMLButtonElement>('[data-select-option]')[activeIndex.value]
    ?.focus())
}

function moveActiveOption(direction: 1 | -1): void {
  const indexes = selectableIndexes()
  if (indexes.length === 0)
    return
  const currentPosition = Math.max(indexes.indexOf(activeIndex.value), 0)
  const nextPosition = (currentPosition + direction + indexes.length) % indexes.length
  activeIndex.value = indexes[nextPosition]!
  focusActiveOption()
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled)
    return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!open.value)
      openMenu()
    moveActiveOption(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key === 'Escape') {
    if (open.value) {
      event.preventDefault()
      closeMenu()
    }
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    if (!open.value) {
      openMenu()
      return
    }
    const option = props.options[activeIndex.value]
    if (option !== undefined)
      choose(option)
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (root.value !== null && !root.value.contains(event.target as Node))
    closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown))
</script>

<template>
  <div
    ref="root"
    class="select-menu"
    :class="{ 'select-menu-open': open, 'select-menu-disabled': disabled }"
    @keydown="handleKeydown"
  >
    <button
      type="button"
      data-testid="select-trigger"
      class="select-menu-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggleMenu"
    >
      <span>{{ selectedOption?.label ?? '请选择' }}</span>
      <svg class="select-menu-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="m2.25 4.25 3.75 3.75 3.75-3.75" />
      </svg>
    </button>
    <div v-if="open" class="select-menu-popup" role="listbox" :aria-label="ariaLabel">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        data-select-option
        class="select-menu-option"
        :class="{ 'select-menu-option-active': index === activeIndex }"
        :data-value="option.value"
        :disabled="option.disabled"
        role="option"
        :aria-selected="option.value === modelValue"
        @mouseenter="activeIndex = index"
        @click="choose(option)"
      >
        <span>{{ option.label }}</span>
        <span v-if="option.value === modelValue" class="select-menu-check" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>
