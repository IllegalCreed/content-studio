import type {
  CampaignSpec,
  CaptureFlow,
  CaptureStep,
  ChannelId,
  Locale,
  LocalizedText,
  ProjectAccessMode,
  ProjectCaptureMode,
  ProjectCaptureTarget,
  ProjectCaptureTargetPurpose,
  ProjectFact,
  ProjectManifest,
  ProjectRepeatability,
  SemanticLocator,
} from './types'
import { CHANNEL_BLUEPRINTS } from './constants'

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SENSITIVE_KEY_PATTERN
  = /cookie|credential|keychain|password|secret|token|api[-_]?key/i
const LOCALES = new Set<Locale>(['en', 'zh-CN'])
const GOALS = new Set<CampaignSpec['goal']>([
  'education',
  'feedback',
  'launch',
])
const VIDEO_FORMATS = new Set(['landscape', 'portrait', 'square'])
const CAPTURE_TARGET_PURPOSES = new Set<ProjectCaptureTargetPurpose>([
  'control',
  'result',
  'state',
])
const TEST_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function validateProjectManifest(input: unknown): ProjectManifest {
  assertNoSensitiveKeys(input)
  const value = asRecord(input, 'project manifest')
  assertSchemaVersion(value.schemaVersion)
  const locales = parseLocales(value.locales)
  const manifest: ProjectManifest = {
    schemaVersion: 1,
    projectId: parseIdentifier(value.projectId, 'projectId'),
    name: parseNonEmptyString(value.name, 'name'),
    canonicalUrl: parseHttpsUrl(value.canonicalUrl, 'canonicalUrl'),
    repositoryUrl: parseHttpsUrl(value.repositoryUrl, 'repositoryUrl'),
    locales,
    tagline: parseLocalizedText(value.tagline, locales, 'tagline'),
    facts: parseFacts(value.facts, locales),
    captureFlows: parseCaptureFlows(value.captureFlows, locales),
    ...(value.captureTargets === undefined
      ? {}
      : { captureTargets: parseCaptureTargets(value.captureTargets, locales) }),
    ...(value.sourceAccess === undefined
      ? {}
      : { sourceAccess: parseProjectSourceAccess(value.sourceAccess) }),
    ...(value.captureMode === undefined
      ? {}
      : { captureMode: parseProjectCaptureMode(value.captureMode) }),
    ...(value.repeatability === undefined
      ? {}
      : { repeatability: parseProjectRepeatability(value.repeatability) }),
  }

  if (
    manifest.sourceAccess === 'web-assisted'
    && manifest.captureMode === 'deterministic'
  ) {
    throw new Error('web-assisted projects cannot use deterministic captureMode')
  }

  return manifest
}

export function validateCampaign(
  input: unknown,
  projectInput: ProjectManifest,
): CampaignSpec {
  assertNoSensitiveKeys(input)
  const project = validateProjectManifest(projectInput)
  const value = asRecord(input, 'campaign')
  assertSchemaVersion(value.schemaVersion)
  const goal = parseNonEmptyString(value.goal, 'goal')
  if (!GOALS.has(goal as CampaignSpec['goal']))
    throw new Error(`Unsupported campaign goal: ${goal}`)

  const targetUrl = parseHttpsUrl(value.targetUrl, 'targetUrl')
  if (new URL(targetUrl).origin !== new URL(project.canonicalUrl).origin)
    throw new Error('targetUrl must use the project canonical origin')

  const facts = new Set(project.facts.map(fact => fact.id))
  const highlights = parseStringArray(value.highlights, 'highlights')
  for (const highlight of highlights) {
    if (!facts.has(highlight))
      throw new Error(`Unknown project fact: ${highlight}`)
  }

  const channels = parseChannels(value.channels, project.locales)
  const campaign: CampaignSpec = {
    schemaVersion: 1,
    campaignId: parseIdentifier(value.campaignId, 'campaignId'),
    topic: parseLocalizedText(value.topic, project.locales, 'topic'),
    goal: goal as CampaignSpec['goal'],
    targetUrl,
    highlights,
    tags: parseTags(value.tags),
    channels,
  }

  if (value.video !== undefined)
    campaign.video = parseCampaignVideo(value.video, project.captureFlows)

  return campaign
}

export function assertNoSensitiveKeys(
  input: unknown,
  path = 'input',
  visited = new Set<object>(),
): void {
  if (typeof input !== 'object' || input === null || visited.has(input))
    return

  visited.add(input)
  if (Array.isArray(input)) {
    input.forEach((item, index) =>
      assertNoSensitiveKeys(item, `${path}[${index}]`, visited),
    )
    return
  }

  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key))
      throw new Error(`Sensitive field is not allowed: ${path}.${key}`)
    assertNoSensitiveKeys(value, `${path}.${key}`, visited)
  }
}

function assertSchemaVersion(input: unknown): asserts input is 1 {
  if (input !== 1)
    throw new Error('schemaVersion must be 1')
}

function asRecord(
  input: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new TypeError(`${name} must be an object`)
  return input as Record<string, unknown>
}

function parseIdentifier(input: unknown, name: string): string {
  const value = parseNonEmptyString(input, name)
  if (!IDENTIFIER_PATTERN.test(value))
    throw new Error(`${name} must use lowercase kebab-case`)
  return value
}

function parseNonEmptyString(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim() === '')
    throw new TypeError(`${name} must be a non-empty string`)
  return input.trim()
}

function parseHttpsUrl(input: unknown, name: string): string {
  const value = parseNonEmptyString(input, name)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '')
    throw new Error(`${name} must be a public HTTPS URL without credentials`)
  return url.toString()
}

function parseLocales(input: unknown): Locale[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new TypeError('locales must be a non-empty array')
  const locales = input.map((locale) => {
    if (typeof locale !== 'string' || !LOCALES.has(locale as Locale))
      throw new Error(`Unsupported locale: ${String(locale)}`)
    return locale as Locale
  })
  assertUnique(locales, 'locale')
  return locales
}

function parseLocalizedText(
  input: unknown,
  locales: Locale[],
  name: string,
): LocalizedText {
  const value = asRecord(input, name)
  const result = {} as LocalizedText
  for (const locale of locales)
    result[locale] = parseNonEmptyString(value[locale], `${name}.${locale}`)

  for (const locale of LOCALES) {
    if (result[locale] === undefined)
      result[locale] = parseNonEmptyString(value[locale], `${name}.${locale}`)
  }
  return result
}

function parseFacts(input: unknown, locales: Locale[]): ProjectFact[] {
  if (!Array.isArray(input))
    throw new TypeError('facts must be an array')
  const facts = input.map((item, index) => {
    const value = asRecord(item, `facts[${index}]`)
    return {
      id: parseIdentifier(value.id, `facts[${index}].id`),
      text: parseLocalizedText(value.text, locales, `facts[${index}].text`),
    }
  })
  assertUnique(
    facts.map(fact => fact.id),
    'fact id',
  )
  return facts
}

function parseCaptureFlows(
  input: unknown,
  locales: Locale[],
): CaptureFlow[] {
  if (!Array.isArray(input))
    throw new TypeError('captureFlows must be an array')
  const flows = input.map((item, index) => {
    const value = asRecord(item, `captureFlows[${index}]`)
    const startPath = parseNonEmptyString(
      value.startPath,
      `captureFlows[${index}].startPath`,
    )
    if (!startPath.startsWith('/') || startPath.startsWith('//'))
      throw new Error('capture flow startPath must be a project-relative path')
    if (!Array.isArray(value.steps) || value.steps.length === 0)
      throw new Error('capture flow steps must be a non-empty array')
    return {
      id: parseIdentifier(value.id, `captureFlows[${index}].id`),
      title: parseLocalizedText(
        value.title,
        locales,
        `captureFlows[${index}].title`,
      ),
      startPath,
      steps: value.steps.map((step, stepIndex) =>
        parseCaptureStep(step, `captureFlows[${index}].steps[${stepIndex}]`),
      ),
    }
  })
  assertUnique(
    flows.map(flow => flow.id),
    'capture flow id',
  )
  return flows
}

function parseCaptureTargets(
  input: unknown,
  locales: Locale[],
): ProjectCaptureTarget[] {
  if (!Array.isArray(input))
    throw new TypeError('captureTargets must be an array')
  const targets = input.map((item, index) => {
    const value = asRecord(item, `captureTargets[${index}]`)
    const purpose = parseNonEmptyString(
      value.purpose,
      `captureTargets[${index}].purpose`,
    )
    if (!CAPTURE_TARGET_PURPOSES.has(purpose as ProjectCaptureTargetPurpose))
      throw new Error(`Unsupported capture target purpose: ${purpose}`)
    return {
      id: parseIdentifier(value.id, `captureTargets[${index}].id`),
      label: parseLocalizedText(
        value.label,
        locales,
        `captureTargets[${index}].label`,
      ),
      locator: parseLocator(
        value.locator,
        `captureTargets[${index}].locator`,
      ),
      purpose: purpose as ProjectCaptureTargetPurpose,
    }
  })
  assertUnique(
    targets.map(target => target.id),
    'capture target id',
  )
  return targets
}

function parseCaptureStep(input: unknown, name: string): CaptureStep {
  const value = asRecord(input, name)
  const kind = parseNonEmptyString(value.kind, `${name}.kind`)
  const durationMs
    = value.durationMs === undefined
      ? undefined
      : parseDuration(value.durationMs, `${name}.durationMs`)

  if (kind === 'wait') {
    return {
      kind,
      durationMs: parseDuration(value.durationMs, `${name}.durationMs`),
    }
  }
  if (kind === 'wait-for') {
    return {
      kind,
      locator: parseLocator(value.locator, `${name}.locator`),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
  if (kind === 'capture') {
    return {
      kind,
      label: parseNonEmptyString(value.label, `${name}.label`),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
  if (kind === 'click') {
    return {
      kind,
      locator: parseLocator(value.locator, `${name}.locator`),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
  if (kind === 'fill') {
    return {
      kind,
      locator: parseLocator(value.locator, `${name}.locator`),
      value: parseNonEmptyString(value.value, `${name}.value`),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
  if (kind === 'press') {
    return {
      kind,
      key: parseNonEmptyString(value.key, `${name}.key`),
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
  throw new Error(`Unsupported capture step kind: ${kind}`)
}

function parseLocator(input: unknown, name: string): SemanticLocator {
  const value = asRecord(input, name)
  const by = parseNonEmptyString(value.by, `${name}.by`)
  if (!['label', 'role', 'test-id', 'text'].includes(by))
    throw new Error(`Unsupported semantic locator: ${by}`)
  const locator: SemanticLocator = {
    by: by as SemanticLocator['by'],
    value: parseNonEmptyString(value.value, `${name}.value`),
  }
  if (locator.by === 'test-id' && !TEST_ID_PATTERN.test(locator.value))
    throw new Error(`${name}.value test-id must use lowercase kebab-case`)
  if (value.name !== undefined)
    locator.name = parseNonEmptyString(value.name, `${name}.name`)
  return locator
}

function parseDuration(input: unknown, name: string): number {
  if (
    typeof input !== 'number'
    || !Number.isInteger(input)
    || input <= 0
    || input > 60_000
  ) {
    throw new Error(`${name} must be an integer between 1 and 60000`)
  }
  return input
}

function parseStringArray(input: unknown, name: string): string[] {
  if (!Array.isArray(input))
    throw new TypeError(`${name} must be an array`)
  return input.map((item, index) =>
    parseNonEmptyString(item, `${name}[${index}]`),
  )
}

function parseTags(input: unknown): string[] {
  const tags = parseStringArray(input, 'tags').map(tag =>
    tag.replace(/^#/, '').toLowerCase(),
  )
  if (tags.some(tag => !/^[a-z0-9][a-z0-9-]{0,29}$/.test(tag)))
    throw new Error('tags must be lowercase ASCII slugs up to 30 characters')
  assertUnique(tags, 'tag')
  return tags
}

function parseChannels(
  input: unknown,
  projectLocales: Locale[],
): CampaignSpec['channels'] {
  if (!Array.isArray(input) || input.length === 0)
    throw new TypeError('channels must be a non-empty array')
  const channels = input.map((item, index) => {
    const value = asRecord(item, `channels[${index}]`)
    const id = parseNonEmptyString(value.id, `channels[${index}].id`)
    if (!(id in CHANNEL_BLUEPRINTS))
      throw new Error(`Unsupported channel: ${id}`)
    const locale = parseNonEmptyString(
      value.locale,
      `channels[${index}].locale`,
    )
    if (!LOCALES.has(locale as Locale) || !projectLocales.includes(locale as Locale))
      throw new Error(`Unsupported project locale: ${locale}`)
    return {
      id: id as ChannelId,
      locale: locale as Locale,
    }
  })
  assertUnique(
    channels.map(channel => `${channel.id}:${channel.locale}`),
    'channel/locale pair',
  )
  return channels
}

function parseCampaignVideo(
  input: unknown,
  captureFlows: CaptureFlow[],
): NonNullable<CampaignSpec['video']> {
  const value = asRecord(input, 'video')
  const flowIds = parseStringArray(value.flowIds, 'video.flowIds')
  if (flowIds.length === 0)
    throw new Error('video.flowIds must not be empty')
  assertUnique(flowIds, 'video flow id')
  const availableFlows = new Set(captureFlows.map(flow => flow.id))
  for (const flowId of flowIds) {
    if (!availableFlows.has(flowId))
      throw new Error(`Unknown capture flow: ${flowId}`)
  }
  const format = parseNonEmptyString(value.format, 'video.format')
  if (!VIDEO_FORMATS.has(format))
    throw new Error(`Unsupported video format: ${format}`)
  return {
    flowIds,
    format: format as NonNullable<CampaignSpec['video']>['format'],
  }
}

function parseProjectSourceAccess(input: unknown): ProjectAccessMode {
  if (input !== 'source-owned' && input !== 'web-assisted')
    throw new Error(`Unsupported project sourceAccess: ${String(input)}`)
  return input
}

function parseProjectCaptureMode(input: unknown): ProjectCaptureMode {
  if (input !== 'deterministic' && input !== 'assisted')
    throw new Error(`Unsupported project captureMode: ${String(input)}`)
  return input
}

function parseProjectRepeatability(input: unknown): ProjectRepeatability {
  if (input !== 'high' && input !== 'conditional' && input !== 'low')
    throw new Error(`Unsupported project repeatability: ${String(input)}`)
  return input
}

function assertUnique(values: string[], name: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${name}`)
}
