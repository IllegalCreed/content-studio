// @env node

import type { ContentPackage, StudioBundle } from '../types'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path'
import process from 'node:process'

export interface WriteBundleResult {
  files: string[]
  outputDirectory: string
}

export async function writeStudioBundle(
  bundle: StudioBundle,
  outputDirectoryInput: string,
): Promise<WriteBundleResult> {
  const outputDirectory = validateOutputDirectory(outputDirectoryInput)
  const files = collectFiles(bundle)

  for (const file of files) {
    const absolutePath = resolve(outputDirectory, file.path)
    if (!isWithin(outputDirectory, absolutePath))
      throw new Error(`Unsafe generated path: ${file.path}`)
    await mkdir(dirname(absolutePath), {
      recursive: true,
    })
    await atomicWrite(absolutePath, file.content)
  }

  return {
    files: files.map(file => file.path),
    outputDirectory,
  }
}

export function validateOutputDirectory(input: string): string {
  if (input.trim() === '')
    throw new Error('Output directory must not be empty')
  const outputDirectory = resolve(input)
  const root = parse(outputDirectory).root
  const unsafeTargets = new Set([
    root,
    resolve(homedir()),
    resolve(process.cwd()),
  ])
  if (unsafeTargets.has(outputDirectory))
    throw new Error(`Unsafe output directory: ${outputDirectory}`)
  return outputDirectory
}

interface OutputFile {
  content: string
  path: string
}

function collectFiles(bundle: StudioBundle): OutputFile[] {
  const packageCounts = new Map<string, number>()
  for (const contentPackage of bundle.contentPackages) {
    const key = `${contentPackage.channel}:${contentPackage.locale}`
    packageCounts.set(key, (packageCounts.get(key) ?? 0) + 1)
  }
  const files: OutputFile[] = [
    {
      content: `${JSON.stringify(bundle, null, 2)}\n`,
      path: 'bundle.json',
    },
    ...bundle.contentPackages.map(contentPackage => {
      const key = `${contentPackage.channel}:${contentPackage.locale}`
      const suffix = (packageCounts.get(key) ?? 0) > 1
        ? `.${contentPackage.format}`
        : ''
      return {
        content: renderMarkdown(contentPackage),
        path: `content/${contentPackage.channel}.${contentPackage.locale}${suffix}.md`,
      }
    }),
  ]

  if (bundle.videoPlan !== null) {
    files.push({
      content: `${JSON.stringify(bundle.videoPlan, null, 2)}\n`,
      path: 'video/plan.json',
    })
  }
  return files
}

function renderMarkdown(contentPackage: ContentPackage): string {
  return [
    `# ${contentPackage.title}`,
    `- Channel: ${contentPackage.channel}`,
    `- Locale: ${contentPackage.locale}`,
    `- Format: ${contentPackage.format}`,
    `- Delivery: ${contentPackage.delivery}`,
    `- Target: ${contentPackage.targetUrl}`,
    '',
    contentPackage.body,
    '',
  ].join('\n')
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`
  await writeFile(temporaryPath, content, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
}

function isWithin(parent: string, child: string): boolean {
  const childRelativePath = relative(parent, child)
  return childRelativePath !== ''
    && !childRelativePath.startsWith('..')
    && !isAbsolute(childRelativePath)
}
