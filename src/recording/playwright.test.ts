import type { SemanticLocator } from '../types'
import { describe, expect, it, vi } from 'vitest'
import {
  createPlaywrightRecordingSession,
  resolveSemanticLocator,
  validateProjectNavigation,
} from './playwright'

describe('playwright recording policy', () => {
  it('maps only the semantic locator vocabulary', () => {
    const page = {
      getByLabel: vi.fn(() => 'label-locator'),
      getByRole: vi.fn(() => 'role-locator'),
      getByTestId: vi.fn(() => 'test-id-locator'),
      getByText: vi.fn(() => 'text-locator'),
    }

    expect(
      resolveSemanticLocator(page, {
        by: 'role',
        name: 'Start',
        value: 'button',
      }),
    ).toBe('role-locator')
    expect(page.getByRole).toHaveBeenCalledWith('button', {
      exact: true,
      name: 'Start',
    })
    resolveSemanticLocator(page, {
      by: 'role',
      value: 'button',
    })
    expect(page.getByRole).toHaveBeenCalledWith('button', {
      exact: true,
    })

    const semanticLocators: SemanticLocator[] = [
      {
        by: 'label',
        value: 'Values',
      },
      {
        by: 'text',
        value: 'Ready',
      },
      {
        by: 'test-id',
        value: 'visualizer',
      },
    ]
    for (const locator of semanticLocators)
      resolveSemanticLocator(page, locator)

    expect(page.getByLabel).toHaveBeenCalledWith('Values', {
      exact: true,
    })
    expect(page.getByText).toHaveBeenCalledWith('Ready', {
      exact: true,
    })
    expect(page.getByTestId).toHaveBeenCalledWith('visualizer')
  })

  it('fails closed on cross-origin and authentication navigation', () => {
    expect(() =>
      validateProjectNavigation(
        'https://example.com/demo',
        'https://example.com',
      ),
    ).not.toThrow()
    expect(() =>
      validateProjectNavigation(
        'https://other.example/demo',
        'https://example.com',
      ),
    ).toThrow(/origin/i)
    expect(() =>
      validateProjectNavigation(
        'https://example.com/login',
        'https://example.com',
      ),
    ).toThrow(/authentication/i)
    expect(() =>
      validateProjectNavigation(
        'about:blank',
        'https://example.com',
      ),
    ).not.toThrow()
    expect(() =>
      validateProjectNavigation(
        'not-a-url',
        'https://example.com',
      ),
    ).toThrow(/allowed project URL/i)
  })

  it('rejects invalid runtime timeouts before launching a browser', async () => {
    for (const actionTimeoutMs of [99, 60_001, 1.5]) {
      await expect(
        createPlaywrightRecordingSession(
          {} as never,
          {
            actionTimeoutMs,
          },
        ),
      ).rejects.toThrow(/actionTimeoutMs/)
    }
  })
})
