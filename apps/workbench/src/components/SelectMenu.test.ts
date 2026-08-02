import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SelectMenu from './SelectMenu.vue'

const options = [
  { label: '全自动候选', value: 'automatic-candidate' },
  { label: '人工辅助', value: 'owner-assisted' },
  { label: '仅生成内容', value: 'content-only' },
]

describe('select menu', () => {
  it('opens a themed popup and emits the selected value', async () => {
    const wrapper = mount(SelectMenu, {
      props: {
        modelValue: 'automatic-candidate',
        options,
      },
    })

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    await wrapper.get('[data-testid="select-trigger"]').trigger('click')

    expect(wrapper.get('[role="listbox"]').classes()).toContain('select-menu-popup')
    expect(wrapper.get('[role="option"][aria-selected="true"]').text()).toContain('全自动候选')
    await wrapper.get('[role="option"][data-value="owner-assisted"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['owner-assisted']])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('does not open when disabled', async () => {
    const wrapper = mount(SelectMenu, {
      props: {
        disabled: true,
        modelValue: 'automatic-candidate',
        options,
      },
    })

    await wrapper.get('[data-testid="select-trigger"]').trigger('click')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
