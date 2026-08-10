import type { CliRuntime } from '../cli/run'
import type { MarketingOpsManagedRuntime } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { runContentStudioHost } from './run'

describe('installer-owned Content Studio host', () => {
  it('forwards only Content Studio project paths and never discovers a marketing-ops command', async () => {
    const runCli = vi.fn(async (_arguments: string[], _runtime: CliRuntime) => 0)

    await expect(runContentStudioHost(['mcp', '--stdio'], {
      cwd: '/installer/runtime',
      environment: {
        CONTENT_STUDIO_DB: '/projects/a/.content-studio/content-studio.sqlite',
        CONTENT_STUDIO_PROJECT: '/projects/a/project.json',
        MARKETING_OPS_COMMAND: 'untrusted-command',
        MARKETING_OPS_RUNTIME_PATH: '/tmp/untrusted-runtime',
      },
      runCli,
      write: () => undefined,
    })).resolves.toBe(0)

    expect(runCli).toHaveBeenCalledWith(['mcp', '--stdio'], expect.objectContaining({
      cwd: '/installer/runtime',
      env: {
        CONTENT_STUDIO_DB: '/projects/a/.content-studio/content-studio.sqlite',
        CONTENT_STUDIO_PROJECT: '/projects/a/project.json',
      },
      marketingOpsRuntime: undefined,
    }))
  })

  it('only accepts an installer-supplied runtime bootstrap for commands that consume status', async () => {
    const managedRuntime: MarketingOpsManagedRuntime = {
      close: vi.fn(),
      statusClient: {
        getChannelsStatus: async () => {
          throw new Error('status should not be requested by this test')
        },
      },
    }
    const bootstrap = { start: vi.fn(async () => managedRuntime) }
    const runCli = vi.fn(async (_arguments: string[], _runtime: CliRuntime) => 0)

    await runContentStudioHost(['generate'], {
      bootstrap,
      runCli,
      write: () => undefined,
    })
    expect(bootstrap.start).not.toHaveBeenCalled()
    expect(runCli).toHaveBeenLastCalledWith(['generate'], expect.objectContaining({
      marketingOpsRuntime: undefined,
    }))

    await runContentStudioHost(['mcp', '--stdio'], {
      bootstrap,
      runCli,
      write: () => undefined,
    })
    expect(bootstrap.start).toHaveBeenCalledTimes(1)
    expect(runCli).toHaveBeenLastCalledWith(['mcp', '--stdio'], expect.objectContaining({
      marketingOpsRuntime: managedRuntime,
    }))
  })

  it('keeps bootstrapping errors private and starts Content Studio without a managed runtime', async () => {
    const runCli = vi.fn(async (_arguments: string[], _runtime: CliRuntime) => 0)
    const bootstrap = {
      start: vi.fn(async () => {
        throw new Error('/private/installer/runtime: transport failure')
      }),
    }

    await expect(runContentStudioHost(['doctor'], {
      bootstrap,
      runCli,
      write: () => undefined,
    })).resolves.toBe(0)

    expect(runCli).toHaveBeenCalledWith(['doctor'], expect.objectContaining({
      marketingOpsRuntime: undefined,
    }))
  })
})
