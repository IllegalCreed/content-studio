import type { ActivityArtifact } from '../types'
import { describe, expect, it } from 'vitest'
import {
  assessChannelContentReadiness,
  assessContentMediaReadiness,
} from './readiness'

function artifact(
  artifactId: string,
  kind: ActivityArtifact['kind'],
): Pick<ActivityArtifact, 'artifactId' | 'kind'> {
  return { artifactId, kind }
}

describe('content publication readiness', () => {
  it('requires final matching media and ignores intermediate recording artifacts', () => {
    const readiness = assessContentMediaReadiness(
      {
        allowedKinds: ['video'],
        maxCount: 1,
        minCount: 1,
      },
      ['clip-1', 'preview-1'],
      [
        artifact('clip-1', 'video-clip'),
        artifact('preview-1', 'preview-frame'),
      ],
    )

    expect(readiness).toMatchObject({
      matchingArtifactIds: [],
      missingMediaKinds: ['video'],
      ready: false,
    })
  })

  it('accepts the final media variant and enforces an explicit maximum', () => {
    const readiness = assessContentMediaReadiness(
      {
        allowedKinds: ['video'],
        maxCount: 1,
        minCount: 1,
      },
      ['video-1'],
      [artifact('video-1', 'video')],
    )

    expect(readiness).toMatchObject({
      matchingArtifactIds: ['video-1'],
      missingMediaKinds: [],
      ready: true,
    })

    expect(assessContentMediaReadiness(
      {
        allowedKinds: ['video'],
        maxCount: 1,
        minCount: 1,
      },
      ['video-1', 'video-2'],
      [artifact('video-1', 'video'), artifact('video-2', 'video')],
    )).toMatchObject({
      matchingArtifactIds: ['video-1', 'video-2'],
      ready: false,
    })
  })

  it('keeps media-optional forms ready without inventing an artifact', () => {
    expect(assessContentMediaReadiness(
      {
        allowedKinds: ['image'],
        minCount: 0,
      },
      [],
      [],
    )).toMatchObject({
      matchingArtifactIds: [],
      missingMediaKinds: [],
      ready: true,
    })
  })

  it('uses the format safety default for legacy content outside a channel blueprint', () => {
    expect(assessChannelContentReadiness(
      'youtube',
      'image-text',
      [],
      [],
    )).toMatchObject({
      missingMediaKinds: ['image'],
      ready: false,
      requirement: {
        allowedKinds: ['image'],
        minCount: 1,
      },
    })
  })
})
