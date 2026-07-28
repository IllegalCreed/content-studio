// @env node

import type { CampaignSpec, ProjectManifest } from '../types'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { generateStudioBundle } from '../bundle/generate'
import { writeStudioBundle } from '../output/write'
import { validateCampaign, validateProjectManifest } from '../validation'

export interface CliRuntime {
  cwd: string
  write: (message: string) => void
}

const DEFAULT_RUNTIME: CliRuntime = {
  cwd: process.cwd(),
  write: message => process.stdout.write(`${message}\n`),
}

const MAX_INPUT_BYTES = 1024 * 1024

export async function runCli(
  arguments_: string[],
  runtime: CliRuntime = DEFAULT_RUNTIME,
): Promise<number> {
  const command = arguments_[0]
  if (command === undefined || command === 'help' || command === '--help') {
    runtime.write(renderHelp())
    return 0
  }
  if (command !== 'generate' && command !== 'validate')
    throw new Error(`Unknown command: ${command}`)

  const options = parseOptions(arguments_.slice(1))
  const projectPath = requireOption(options, 'project')
  const campaignPath = requireOption(options, 'campaign')
  const project = validateProjectManifest(
    await readJsonFile(projectPath, runtime.cwd),
  )
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

function parseOptions(arguments_: string[]): Map<string, string> {
  const options = new Map<string, string>()
  const allowedOptions = new Set(['campaign', 'out', 'project'])
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (flag === undefined || !flag.startsWith('--'))
      throw new Error(`Expected an option at argument ${index + 1}`)
    const name = flag.slice(2)
    if (!allowedOptions.has(name))
      throw new Error(`Unknown option: ${flag}`)
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Missing value for option: ${flag}`)
    if (options.has(name))
      throw new Error(`Duplicate option: ${flag}`)
    options.set(name, value)
  }
  return options
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
    'content-studio validate --project <project.json> --campaign <campaign.json>',
  ].join('\n')
}

export type { CampaignSpec, ProjectManifest }
