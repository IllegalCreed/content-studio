import type {
  CampaignSpec,
  CaptureStep,
  ChannelId,
  CompiledCaptureAction,
  Locale,
  ProjectManifest,
  VideoPlan,
} from '../types'
import { DEFAULT_ACTION_DURATION_MS } from '../constants'
import { validateCampaign, validateProjectManifest } from '../validation'
import { resolveVideoRecordingConfig } from './recording-config'

export function compileVideoPlan(
  projectInput: ProjectManifest,
  campaignInput: CampaignSpec,
  channelId?: ChannelId,
): VideoPlan {
  const project = validateProjectManifest(projectInput)
  const campaign = validateCampaign(campaignInput, project)
  if (campaign.video === undefined)
    throw new Error('Campaign does not define a video plan')

  const locale = resolveVideoLocale(campaign)
  const recordingConfig = resolveVideoRecordingConfig(
    project,
    campaign,
    channelId,
  )
  const flowsById = new Map(project.captureFlows.map(flow => [flow.id, flow]))
  let timelineOffset = 0
  const scenes = campaign.video.flowIds.map((flowId) => {
    const flow = flowsById.get(flowId)!
    let sceneOffset = 0
    const actions = flow.steps.map((step) => {
      const action = compileAction(step, sceneOffset)
      sceneOffset += action.durationMs
      return action
    })
    const scene = {
      actions,
      id: flow.id,
      startMs: timelineOffset,
      startPath: flow.startPath,
      title: flow.title[locale],
    }
    timelineOffset += sceneOffset
    return scene
  })

  return {
    campaignId: campaign.campaignId,
    durationMs: timelineOffset,
    format: recordingConfig.format ?? campaign.video.format,
    ...(campaign.video.outline === undefined
      ? {}
      : { outline: campaign.video.outline }),
    ...(campaign.video.planVersion === undefined
      ? {}
      : { planVersion: campaign.video.planVersion }),
    recordingConfig,
    scenes,
  }
}

function compileAction(
  step: CaptureStep,
  startMs: number,
): CompiledCaptureAction {
  const durationMs = step.durationMs ?? DEFAULT_ACTION_DURATION_MS[step.kind]
  return {
    ...step,
    durationMs,
    startMs,
  }
}

function resolveVideoLocale(campaign: CampaignSpec): Locale {
  const videoChannel = campaign.channels.find(channel =>
    ['bilibili', 'douyin', 'youtube'].includes(channel.id),
  )
  return videoChannel?.locale ?? campaign.channels[0]!.locale
}
