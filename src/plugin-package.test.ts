import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pluginRoot = fileURLToPath(new URL('../plugin/', import.meta.url))

const pluginSchema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
const mcpSchema = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
const pluginNamePattern = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(pluginRoot, relativePath), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

function parseFrontmatter(markdown: string): {
  body: string
  fields: Map<string, string>
} {
  const delimiter = /^---$/m
  const matches = markdown.match(delimiter)
  if (matches === null || matches.index === undefined)
    throw new Error('SKILL.md must start with YAML frontmatter')
  const afterFirst = markdown.slice(matches.index + matches[0].length)
  const closing = afterFirst.match(/^---$/m)
  if (closing === null || closing.index === undefined)
    throw new Error('SKILL.md frontmatter is not closed')
  const frontmatter = afterFirst.slice(0, closing.index)
  const body = afterFirst.slice(closing.index + closing[0].length)
  const fields = new Map<string, string>()
  for (const line of frontmatter.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0)
      continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key.length > 0 && value.length > 0)
      fields.set(key, value)
  }
  return { body, fields }
}

describe('content studio agent plugin package', () => {
  it('exposes a valid Agent Plugins 1.0.0 manifest', async () => {
    const manifest = await readJson('plugin.json')
    const allowedFields = new Set([
      '$schema',
      'author',
      'description',
      'extensions',
      'homepage',
      'keywords',
      'license',
      'name',
      'repository',
      'version',
    ])
    for (const key of Object.keys(manifest))
      expect(allowedFields.has(key), `unknown manifest field: ${key}`).toBe(true)
    expect(manifest.$schema).toBe(pluginSchema)
    expect(manifest.name).toMatch(pluginNamePattern)
    expect(String(manifest.name).length).toBeLessThanOrEqual(64)
    expect(manifest.description).toEqual(expect.any(String))
    expect(String(manifest.description).length).toBeGreaterThan(0)
    expect(manifest.version).toEqual(expect.any(String))
  })

  it('declares the local runtime as a stdio MCP server with a documented project binding', async () => {
    const config = await readJson('mcp.json')
    expect(Object.keys(config).sort()).toEqual(['$schema', 'mcpServers'])
    expect(config.$schema).toBe(mcpSchema)
    const servers = config.mcpServers as Record<string, Record<string, unknown>>
    expect(servers['content-studio']).toBeDefined()
    const server = servers['content-studio']
    expect(server.type).toBe('stdio')
    expect(server.command).toBe('content-studio')
    expect(server.args).toEqual(expect.any(Array))
    const args = server.args as string[]
    expect(args).toContain('--stdio')
    expect(args).toContain('--project')
    const projectArg = args[args.indexOf('--project') + 1]
    expect(projectArg).toMatch(/^\$\{PLUGIN_DATA\}\//)
  })

  it('ships the planned usage skills as immediate skill directories', async () => {
    const entries = await readdir(join(pluginRoot, 'skills'), {
      withFileTypes: true,
    })
    const skillNames = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    expect(skillNames).toEqual([
      'onboard-project',
      'produce-activity',
      'review-and-handoff',
    ])
  })

  it('keeps every SKILL.md frontmatter valid and matching its directory', async () => {
    const entries = await readdir(join(pluginRoot, 'skills'), {
      withFileTypes: true,
    })
    const skillDirs = entries.filter(entry => entry.isDirectory())
    expect(skillDirs.length).toBeGreaterThan(0)
    for (const entry of skillDirs) {
      const skillPath = join(pluginRoot, 'skills', entry.name)
      const markdown = await readFile(join(skillPath, 'SKILL.md'), 'utf8')
      const { body, fields } = parseFrontmatter(markdown)
      expect(entry.name, 'skill directory must be a valid skill name')
        .toMatch(skillNamePattern)
      expect(entry.name.length).toBeLessThanOrEqual(64)
      const name = fields.get('name')
      expect(name, 'frontmatter name is required').toBeDefined()
      expect(name).toBe(entry.name)
      const description = fields.get('description')
      expect(description, 'frontmatter description is required').toBeDefined()
      expect(description!.length).toBeGreaterThan(0)
      expect(description!.length).toBeLessThanOrEqual(1024)
      expect(body.trim().length).toBeGreaterThan(0)
    }
  })
})
