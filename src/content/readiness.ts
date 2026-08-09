import type {
  ActivityArtifact,
  ChannelContent,
  ChannelContentFormat,
  ChannelContentReadiness,
  ChannelId,
  ContentFormat,
  ContentMediaKind,
  ContentMediaRequirement,
} from '../types'
import {
  CHANNEL_BLUEPRINTS,
  defaultContentMediaRequirement,
} from '../constants'

export function assessContentMediaReadiness(
  requirement: ContentMediaRequirement,
  artifactIds: readonly string[],
  artifacts: readonly Pick<ActivityArtifact, 'artifactId' | 'kind'>[],
): ChannelContentReadiness {
  const artifactById = new Map(
    artifacts.map(artifact => [artifact.artifactId, artifact]),
  )
  const allowedKinds = new Set(requirement.allowedKinds)
  const matchingArtifactIds = artifactIds.filter((artifactId) => {
    const artifact = artifactById.get(artifactId)
    const mediaKind = artifact === undefined
      ? undefined
      : mediaKindForArtifact(artifact.kind)
    return mediaKind !== undefined && allowedKinds.has(mediaKind)
  })
  const missingMediaKinds = requirement.minCount > 0
    && matchingArtifactIds.length < requirement.minCount
    ? [...requirement.allowedKinds]
    : []
  const exceedsMaximum = requirement.maxCount !== undefined
    && matchingArtifactIds.length > requirement.maxCount
  const ready = missingMediaKinds.length === 0 && !exceedsMaximum
  return {
    artifactIds: [...artifactIds],
    matchingArtifactIds,
    missingMediaKinds,
    ready,
    reason: ready
      ? null
      : exceedsMaximum
        ? `At most ${requirement.maxCount} matching ${mediaKindsLabel(requirement.allowedKinds)} artifact${requirement.maxCount === 1 ? ' is' : 's are'} allowed`
        : `At least ${requirement.minCount} matching ${mediaKindsLabel(requirement.allowedKinds)} artifact${requirement.minCount === 1 ? ' is' : 's are'} required`,
    requirement: {
      allowedKinds: [...requirement.allowedKinds],
      ...(requirement.maxCount === undefined ? {} : { maxCount: requirement.maxCount }),
      minCount: requirement.minCount,
    },
  }
}

export function assessChannelContentReadiness(
  channel: ChannelId,
  format: ChannelContentFormat,
  artifactIds: readonly string[],
  artifacts: readonly Pick<ActivityArtifact, 'artifactId' | 'kind'>[],
): ChannelContentReadiness {
  const blueprint = CHANNEL_BLUEPRINTS[channel]
  const blueprintFormat = contentBlueprintFormat(format)
  const form = blueprint.contentForms.find(candidate => candidate.format === blueprintFormat)
  return assessContentMediaReadiness(
    form?.media ?? defaultContentMediaRequirement(blueprintFormat),
    artifactIds,
    artifacts,
  )
}

export function assessChannelContentsReadiness(
  contents: readonly ChannelContent[],
  artifacts: readonly ActivityArtifact[],
): Record<string, ChannelContentReadiness> {
  return Object.fromEntries(contents.map((content) => {
    const activityArtifacts = artifacts.filter(artifact =>
      artifact.activityId === content.activityId,
    )
    return [
      content.contentId,
      assessChannelContentReadiness(
        content.channel,
        content.format,
        content.artifactIds,
        activityArtifacts,
      ),
    ]
  }))
}

export function contentBlueprintFormat(format: ChannelContentFormat): ContentFormat {
  return format === 'video' ? 'video-metadata' : format
}

function mediaKindForArtifact(
  kind: ActivityArtifact['kind'],
): ContentMediaKind | undefined {
  return kind === 'image' || kind === 'video' ? kind : undefined
}

function mediaKindsLabel(kinds: readonly ContentMediaKind[]): string {
  return kinds
    .map(kind => kind === 'image' ? 'image' : 'video')
    .join(' or ')
}
