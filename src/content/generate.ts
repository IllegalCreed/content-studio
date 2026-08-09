import type {
  CampaignSpec,
  ChannelBlueprint,
  ContentPackage,
  Locale,
  ProjectManifest,
} from '../types'
import { CHANNEL_BLUEPRINTS } from '../constants'
import { validateCampaign, validateProjectManifest } from '../validation'

export function generateContentPackages(
  projectInput: ProjectManifest,
  campaignInput: CampaignSpec,
): ContentPackage[] {
  const project = validateProjectManifest(projectInput)
  const campaign = validateCampaign(campaignInput, project)
  const factsById = new Map(project.facts.map(fact => [fact.id, fact]))

  return campaign.channels.flatMap(({ contentFormats, id, locale }) => {
    const blueprint = CHANNEL_BLUEPRINTS[id]
    const formats = contentFormats ?? [blueprint.format]
    return formats.map((format) => {
      const formatBlueprint = { ...blueprint, format }
      const facts = campaign.highlights.map(
        factId => factsById.get(factId)!.text[locale],
      )
      const title = fitTitle(campaign.topic[locale], formatBlueprint.maxTitleLength)
      const tags = campaign.tags.map(tag => `#${tag}`)
      return {
        body: generateBody(
          formatBlueprint,
          locale,
          title,
          project.tagline[locale],
          facts,
          campaign.targetUrl,
          tags,
        ),
        campaignId: campaign.campaignId,
        channel: id,
        delivery: formatBlueprint.delivery,
        format,
        locale,
        tags,
        targetUrl: campaign.targetUrl,
        title,
      }
    })
  })
}

function generateBody(
  blueprint: ChannelBlueprint,
  locale: Locale,
  title: string,
  tagline: string,
  facts: string[],
  targetUrl: string,
  tags: string[],
): string {
  if (blueprint.format === 'article')
    return fitBody(articleParts(locale, title, tagline, facts, targetUrl, tags), blueprint.maxBodyLength)
  if (blueprint.format === 'image-text')
    return fitBody(articleParts(locale, title, tagline, facts, targetUrl, tags), blueprint.maxBodyLength)
  if (blueprint.format === 'video-metadata')
    return fitBody(videoParts(locale, tagline, facts, targetUrl, tags), blueprint.maxBodyLength)
  return fitBody(shortParts(title, tagline, facts, targetUrl, tags), blueprint.maxBodyLength)
}

function articleParts(
  locale: Locale,
  title: string,
  tagline: string,
  facts: string[],
  targetUrl: string,
  tags: string[],
): string[] {
  const highlightsHeading = locale === 'zh-CN' ? '你会看到' : 'What you will see'
  const actionLabel = locale === 'zh-CN' ? '在线体验' : 'Try it'
  return [
    title,
    tagline,
    `## ${highlightsHeading}\n${facts.map(fact => `- ${fact}`).join('\n')}`,
    `${actionLabel}: ${targetUrl}`,
    tags.join(' '),
  ]
}

function videoParts(
  locale: Locale,
  tagline: string,
  facts: string[],
  targetUrl: string,
  tags: string[],
): string[] {
  const intro = locale === 'zh-CN'
    ? '本视频用可复现的项目交互演示核心流程。'
    : 'This video demonstrates the core flow with reproducible project interactions.'
  return [
    intro,
    tagline,
    ...facts,
    targetUrl,
    tags.join(' '),
  ]
}

function shortParts(
  title: string,
  tagline: string,
  facts: string[],
  targetUrl: string,
  tags: string[],
): string[] {
  return [
    title,
    tagline,
    ...facts,
    targetUrl,
    tags.join(' '),
  ]
}

function fitTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength)
    return title
  return `${title.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function fitBody(parts: string[], maxLength: number): string {
  const requiredPart = parts.at(-2) ?? ''
  const optionalParts = parts.filter(part => part.trim() !== '')
  while (optionalParts.join('\n\n').length > maxLength && optionalParts.length > 2) {
    const removableIndex = optionalParts.findIndex(
      (part, index) => index > 0 && part !== requiredPart && !part.startsWith('#'),
    )
    if (removableIndex === -1)
      break
    optionalParts.splice(removableIndex, 1)
  }

  const body = optionalParts.join('\n\n')
  if (body.length <= maxLength)
    return body

  const suffix = `\n\n${requiredPart}`
  const prefixLength = Math.max(1, maxLength - suffix.length - 1)
  return `${body.slice(0, prefixLength).trimEnd()}…${suffix}`.slice(0, maxLength)
}
