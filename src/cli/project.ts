// @env node

import type { Locale } from '../types'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  draftSourceOwnedProject,
  draftWebAssistedProject,
} from '../project/import'
import { validateProjectManifest } from '../validation'

interface ProjectCommandRuntime {
  cwd: string
  write: (message: string) => void
}

export async function runProjectCommand(
  subcommand: 'import' | 'init',
  options: ReadonlyMap<string, string>,
  runtime: ProjectCommandRuntime,
): Promise<number> {
  const manifest = subcommand === 'import'
    ? await draftSourceOwnedProject({
        canonicalUrl: options.get('canonical-url'),
        locales: parseLocales(options.get('locale')),
        name: options.get('name'),
        repositoryUrl: options.get('repository-url'),
        sourceDirectory: resolve(runtime.cwd, requireOption(options, 'source')),
      })
    : draftWebAssistedProject({
        canonicalUrl: requireOption(options, 'url'),
        locales: parseLocales(options.get('locale')),
        name: requireOption(options, 'name'),
        projectId: options.get('project-id'),
        repositoryUrl: options.get('repository-url'),
      })
  validateProjectManifest(manifest)
  const outputPath = resolve(runtime.cwd, requireOption(options, 'out'))
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  runtime.write(`Draft project manifest written to ${outputPath}`)
  runtime.write('Review and confirm the manifest before registering the project.')
  return 0
}

function requireOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)
  if (value === undefined)
    throw new Error(`Missing required option: --${name}`)
  return value
}

function parseLocales(input: string | undefined): Locale[] | undefined {
  if (input === undefined)
    return undefined
  if (input !== 'en' && input !== 'zh-CN')
    throw new Error('--locale must be en or zh-CN')
  return [input]
}
