// @env node

import type { CliRuntime } from '../cli/run'
import type { MarketingOpsManagedRuntime } from '../types'
import process from 'node:process'
import { runCli } from '../cli/run'

const CONTENT_STUDIO_ENVIRONMENT_KEYS = [
  'CONTENT_STUDIO_CAMPAIGN',
  'CONTENT_STUDIO_DB',
  'CONTENT_STUDIO_PROJECT',
] as const

export interface InstallerManagedRuntimeBootstrap {
  start: () => Promise<MarketingOpsManagedRuntime | undefined>
}

export type ContentStudioCliRunner = (
  arguments_: string[],
  runtime: CliRuntime,
) => Promise<number>

export interface ContentStudioHostOptions {
  bootstrap?: InstallerManagedRuntimeBootstrap
  cwd?: string
  environment?: NodeJS.ProcessEnv
  runCli?: ContentStudioCliRunner
  signal?: AbortSignal
  write?: CliRuntime['write']
}

/**
 * Runs Content Studio from the installer-owned host boundary. The production
 * entrypoint does not supply a bootstrap until a signed, verified runtime asset
 * is available; tests and the eventual installer can supply one directly.
 */
export async function runContentStudioHost(
  arguments_: string[],
  options: ContentStudioHostOptions = {},
): Promise<number> {
  const marketingOpsRuntime = shouldUseManagedRuntime(arguments_)
    ? await startManagedRuntime(options.bootstrap)
    : undefined
  return (options.runCli ?? runCli)(arguments_, {
    cwd: options.cwd ?? process.cwd(),
    env: contentStudioEnvironment(options.environment ?? process.env),
    marketingOpsRuntime,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    write: options.write ?? (message => process.stdout.write(`${message}\n`)),
  })
}

function shouldUseManagedRuntime(arguments_: readonly string[]): boolean {
  return arguments_[0] === 'doctor'
    || arguments_[0] === 'mcp'
    || arguments_[0] === 'serve'
}

async function startManagedRuntime(
  bootstrap: InstallerManagedRuntimeBootstrap | undefined,
): Promise<MarketingOpsManagedRuntime | undefined> {
  if (bootstrap === undefined)
    return undefined
  try {
    return await bootstrap.start()
  }
  catch {
    return undefined
  }
}

function contentStudioEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const safeEnvironment: NodeJS.ProcessEnv = {}
  for (const key of CONTENT_STUDIO_ENVIRONMENT_KEYS) {
    const value = environment[key]
    if (value !== undefined)
      safeEnvironment[key] = value
  }
  return safeEnvironment
}
