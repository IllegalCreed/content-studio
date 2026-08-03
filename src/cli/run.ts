// @env node

import type {
  CampaignSpec,
  PlaywrightRecordingOptions,
  ProjectChannelBinding,
  ProjectManifest,
  ProjectRecord,
  ProjectSnapshot,
  RecordingJobInput,
  RecordingJobResult,
} from '../types'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { generateStudioBundle } from '../bundle/generate'
import { CHANNEL_BLUEPRINTS } from '../constants'
import { createContentStudioMcpServer, serveMcpStdio } from '../mcp/server'
import { writeStudioBundle } from '../output/write'
import { createProjectRecord } from '../project/record'
import { recordWithPlaywright } from '../recording/playwright'
import { createContentStudioApplication, createContentStudioServer } from '../runtime/server'
import { validateCampaign, validateProjectManifest } from '../validation'
import { compileVideoPlan } from '../video/compile'
import { runDoctor } from './doctor'

export interface CliRuntime {
  cwd: string
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  signal?: AbortSignal
  write: (message: string) => void
}

export interface CliServices {
  record: (
    input: RecordingJobInput,
    options?: PlaywrightRecordingOptions,
  ) => Promise<RecordingJobResult>
}

const DEFAULT_RUNTIME: CliRuntime = {
  cwd: process.cwd(),
  write: message => process.stdout.write(`${message}\n`),
}

const DEFAULT_SERVICES: CliServices = {
  record: recordWithPlaywright,
}

const MAX_INPUT_BYTES = 1024 * 1024

export async function runCli(
  arguments_: string[],
  runtime: CliRuntime = DEFAULT_RUNTIME,
  services: CliServices = DEFAULT_SERVICES,
): Promise<number> {
  const command = arguments_[0]
  if (command === undefined || command === 'help' || command === '--help') {
    runtime.write(renderHelp())
    return 0
  }
  if (
    command !== 'generate'
    && command !== 'record'
    && command !== 'serve'
    && command !== 'mcp'
    && command !== 'doctor'
    && command !== 'validate'
  ) {
    throw new Error(`Unknown command: ${command}`)
  }

  const isMcp = command === 'mcp'
  const options = parseOptions(
    arguments_.slice(1),
    command === 'serve'
      ? new Set(['campaign', 'db', 'port', 'project'])
      : isMcp
        ? new Set(['campaign', 'db', 'project', 'stdio'])
        : command === 'doctor'
          ? new Set(['db', 'project'])
          : command === 'record'
            ? new Set(['attempts', 'base-url', 'campaign', 'out', 'project'])
            : new Set(['campaign', 'out', 'project']),
    isMcp ? new Set(['stdio']) : new Set(),
  )
  if (isMcp && !options.has('stdio'))
    throw new Error('content-studio mcp requires --stdio')
  const projectPath = requireOption(options, 'project')
  const serveCampaignPath = command === 'serve' || isMcp || command === 'doctor'
    ? options.get('campaign')
    : requireOption(options, 'campaign')
  const project = validateProjectManifest(
    await readJsonFile(projectPath, runtime.cwd),
  )
  if (command === 'serve') {
    const campaign = serveCampaignPath === undefined
      ? undefined
      : validateCampaign(
          await readJsonFile(serveCampaignPath, runtime.cwd),
          project,
        )
    return runServe(project, campaign, options, runtime)
  }
  if (isMcp) {
    const campaign = serveCampaignPath === undefined
      ? undefined
      : validateCampaign(
          await readJsonFile(serveCampaignPath, runtime.cwd),
          project,
        )
    return runMcp(project, campaign, options, runtime)
  }
  if (command === 'doctor')
    return runDoctor(project, options, runtime)

  const campaignPath = requireOption(options, 'campaign')
  const campaign = validateCampaign(
    await readJsonFile(campaignPath, runtime.cwd),
    project,
  )

  if (command === 'validate') {
    runtime.write(
      `Validated ${project.projectId}/${campaign.campaignId} for ${campaign.channels.length} channel package(s).`,
    )
    return 0
  }

  const outputPath = requireOption(options, 'out')
  if (command === 'record') {
    if (campaign.video === undefined)
      throw new Error('Campaign does not define a video plan')
    if (project.sourceAccess === 'web-assisted' || project.captureMode === 'assisted')
      throw new Error('content-studio record only supports source-owned deterministic projects')

    const baseUrl = requireOption(options, 'base-url')
    const attempts = parseAttempts(options.get('attempts'))
    const projectRecord = createProjectRecord(
      project,
      `${project.projectId}-snapshot-1`,
    )
    const result = await services.record(
      {
        baseUrl,
        jobId: `${campaign.campaignId}-recording`,
        ...(attempts === undefined ? {} : { maxAttempts: attempts }),
        outputDirectory: resolve(runtime.cwd, outputPath),
        plan: compileVideoPlan(project, campaign),
        projectId: project.projectId,
        recordingContext: {
          captureMode: projectRecord.captureMode,
          humanIntervention: false,
          planVersion: campaign.video.planVersion ?? 1,
          repeatability: projectRecord.repeatability,
          sourceAccess: projectRecord.sourceAccess,
        },
        ...(runtime.signal === undefined
          ? {}
          : { signal: runtime.signal }),
      },
      {
        emit: (event) => {
          runtime.write(JSON.stringify(event))
        },
      },
    )
    if (result.receipt.outcome === 'cancelled') {
      runtime.write(
        `Recording cancelled after ${result.receipt.completedActions} action(s).`,
      )
      return 130
    }
    if (result.receipt.outcome === 'failed') {
      throw new Error(
        `Recording failed with ${result.receipt.failure?.code ?? 'runtime-error'}`,
      )
    }
    runtime.write(
      `Recorded ${result.receipt.completedActions} action(s) in ${result.receipt.artifactDirectory}.`,
    )
    return 0
  }

  const bundle = generateStudioBundle(project, campaign)
  const result = await writeStudioBundle(
    bundle,
    resolve(runtime.cwd, outputPath),
  )
  runtime.write(
    `Generated ${bundle.contentPackages.length} content package(s) and ${bundle.videoPlan === null ? 'no video plan' : '1 video plan'} in ${result.outputDirectory}.`,
  )
  return 0
}

function parseOptions(
  arguments_: string[],
  allowedOptions: ReadonlySet<string>,
  booleanOptions: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const options = new Map<string, string>()
  for (let index = 0; index < arguments_.length;) {
    const flag = arguments_[index]
    if (flag === undefined || !flag.startsWith('--'))
      throw new Error(`Expected an option at argument ${index + 1}`)
    const name = flag.slice(2)
    if (!allowedOptions.has(name))
      throw new Error(`Unknown option: ${flag}`)
    if (booleanOptions.has(name)) {
      if (options.has(name))
        throw new Error(`Duplicate option: ${flag}`)
      const next = arguments_[index + 1]
      if (next !== undefined && !next.startsWith('--'))
        throw new Error(`Option does not accept a value: ${flag}`)
      options.set(name, 'true')
      index += 1
      continue
    }
    const value = arguments_[index + 1]
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Missing value for option: ${flag}`)
    if (options.has(name))
      throw new Error(`Duplicate option: ${flag}`)
    options.set(name, value)
    index += 2
  }
  return options
}

function parseAttempts(input: string | undefined): number | undefined {
  if (input === undefined)
    return undefined
  const attempts = Number(input)
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3)
    throw new Error('--attempts must be an integer between 1 and 3')
  return attempts
}

async function readJsonFile(path: string, cwd: string): Promise<unknown> {
  const absolutePath = resolve(cwd, path)
  const fileStatus = await stat(absolutePath)
  if (!fileStatus.isFile() || fileStatus.size > MAX_INPUT_BYTES)
    throw new Error(`Input must be a JSON file no larger than ${MAX_INPUT_BYTES} bytes`)
  const source = await readFile(absolutePath, 'utf8')
  try {
    return JSON.parse(source) as unknown
  }
  catch {
    throw new Error(`Invalid JSON file: ${absolutePath}`)
  }
}

function requireOption(options: Map<string, string>, name: string): string {
  const value = options.get(name)
  if (value === undefined)
    throw new Error(`Missing required option: --${name}`)
  return value
}

function renderHelp(): string {
  return [
    'content-studio generate --project <project.json> --campaign <campaign.json> --out <directory>',
    'content-studio record --project <project.json> --campaign <campaign.json> --base-url <url> --out <directory> [--attempts <1-3>]',
    'content-studio serve --project <project.json> [--campaign <campaign.json>] [--db <path>] [--port <11001>]',
    'content-studio mcp --stdio --project <project.json> [--campaign <campaign.json>] [--db <path>]',
    'content-studio doctor --project <project.json> [--db <path>]',
    'content-studio validate --project <project.json> --campaign <campaign.json>',
  ].join('\n')
}

async function runServe(
  project: ProjectManifest,
  campaign: CampaignSpec | undefined,
  options: Map<string, string>,
  runtime: CliRuntime,
): Promise<number> {
  const handle = createContentStudioServer(createApplicationOptions(project, campaign, options, runtime))
  const port = parsePort(options.get('port'))
  try {
    await listenServer(handle.server, port)
    const address = handle.server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Content Studio runtime did not expose a TCP address')
    runtime.write(
      `Content Studio runtime listening at http://127.0.0.1:${address.port}`,
    )
    if (runtime.signal === undefined)
      return 0
    if (!runtime.signal.aborted) {
      await new Promise<void>(resolveSignal =>
        runtime.signal?.addEventListener('abort', () => resolveSignal(), { once: true }),
      )
    }
    return 130
  }
  finally {
    await handle.close()
  }
}

async function runMcp(
  project: ProjectManifest,
  campaign: CampaignSpec | undefined,
  options: Map<string, string>,
  runtime: CliRuntime,
): Promise<number> {
  const handle = createContentStudioApplication(
    createApplicationOptions(project, campaign, options, runtime),
  )
  try {
    await serveMcpStdio(
      createContentStudioMcpServer({
        projectId: project.projectId,
        service: handle.service,
      }),
      {
        input: runtime.input ?? process.stdin,
        output: runtime.output ?? process.stdout,
        ...(runtime.signal === undefined ? {} : { signal: runtime.signal }),
      },
    )
    return runtime.signal?.aborted === true ? 130 : 0
  }
  finally {
    handle.close()
  }
}

function createApplicationOptions(
  project: ProjectManifest,
  campaign: CampaignSpec | undefined,
  options: Map<string, string>,
  runtime: CliRuntime,
): Parameters<typeof createContentStudioServer>[0] {
  const snapshot: ProjectSnapshot = {
    manifest: project,
    projectId: project.projectId,
    snapshotId: `${project.projectId}-snapshot-1`,
    version: 1,
  }
  const projectRecord: ProjectRecord = createProjectRecord(project, snapshot.snapshotId)
  const projectChannelBindings: ProjectChannelBinding[] = campaign === undefined
    ? []
    : campaign.channels.map(channel => ({
        channel: channel.id,
        delivery: CHANNEL_BLUEPRINTS[channel.id].delivery,
        enabled: true,
        projectId: project.projectId,
      }))
  return {
    databasePath: resolve(
      runtime.cwd,
      options.get('db') ?? '.content-studio/content-studio.sqlite',
    ),
    project: projectRecord,
    projectChannelBindings,
    snapshot,
  }
}

function listenServer(
  server: ReturnType<typeof createContentStudioServer>['server'],
  port: number,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', () => resolvePromise())
  })
}

function parsePort(input: string | undefined): number {
  const port = input === undefined ? 11001 : Number(input)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('--port must be an integer between 0 and 65535')
  return port
}

export type { CampaignSpec, ProjectManifest }
