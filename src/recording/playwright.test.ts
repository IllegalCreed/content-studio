import type { SemanticLocator, VideoPlan } from '../types'
import { describe, expect, it, vi } from 'vitest'
import {
  createPlaywrightRecordingSession,
  recordWithPlaywright,
  resolveOwnerTakeoverController,
  resolvePlaywrightRecordingContextOptions,
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

  it('does not let the built-in recorder execute a web-assisted context', async () => {
    await expect(recordWithPlaywright({
      baseUrl: 'https://example.com',
      jobId: 'assisted-recording',
      outputDirectory: '/tmp/content-studio-assisted-recording',
      plan: {
        campaignId: 'assisted-campaign',
        durationMs: 0,
        format: 'landscape',
        recordingConfig: {
          colorScheme: 'dark',
          deviceScaleFactor: 1,
          locale: 'en',
          outputSize: { height: 720, width: 1280 },
          viewport: { height: 720, width: 1280 },
        },
        scenes: [],
      },
      projectId: 'assisted-project',
      recordingContext: {
        captureMode: 'assisted',
        humanIntervention: true,
        planVersion: 1,
        repeatability: 'low',
        sourceAccess: 'web-assisted',
      },
    })).rejects.toThrow(/web-assisted.*built-in|built-in.*web-assisted/i)
  })

  it('only enables owner takeover with an explicit recording context opt-in', () => {
    const controller = {
      request: vi.fn(async () => {}),
    }
    expect(resolveOwnerTakeoverController(undefined, undefined)).toBeUndefined()

    expect(() =>
      resolveOwnerTakeoverController(undefined, controller),
    ).toThrow(/ownerTakeover/i)
    expect(() =>
      resolveOwnerTakeoverController(
        {
          captureMode: 'deterministic',
          humanIntervention: false,
          planVersion: 1,
          repeatability: 'high',
          sourceAccess: 'source-owned',
        },
        controller,
      ),
    ).toThrow(/ownerTakeover/i)

    expect(resolveOwnerTakeoverController(
      {
        captureMode: 'deterministic',
        humanIntervention: true,
        ownerTakeover: true,
        planVersion: 1,
        repeatability: 'conditional',
        sourceAccess: 'source-owned',
      },
      controller,
    )).toBe(controller)
  })

  it('passes the resolved recording profile to the browser context', () => {
    const plan = {
      campaignId: 'campaign-a',
      durationMs: 0,
      format: 'landscape',
      recordingConfig: {
        colorScheme: 'light',
        deviceScaleFactor: 2,
        locale: 'zh-CN',
        outputSize: { height: 720, width: 1280 },
        viewport: { height: 900, width: 1600 },
      },
      scenes: [],
    } satisfies VideoPlan

    expect(resolvePlaywrightRecordingContextOptions(plan)).toEqual({
      acceptDownloads: false,
      colorScheme: 'light',
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      viewport: { height: 900, width: 1600 },
    })
  })
})
