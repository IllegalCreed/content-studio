import type {
  CampaignSpec,
  ProjectManifest,
  StudioBundle,
} from '../types'
import { generateContentPackages } from '../content/generate'
import { validateCampaign, validateProjectManifest } from '../validation'
import { compileVideoPlan } from '../video/compile'

export function generateStudioBundle(
  projectInput: ProjectManifest,
  campaignInput: CampaignSpec,
): StudioBundle {
  const project = validateProjectManifest(projectInput)
  const campaign = validateCampaign(campaignInput, project)
  return {
    bundleVersion: 1,
    campaignId: campaign.campaignId,
    contentPackages: generateContentPackages(project, campaign),
    projectId: project.projectId,
    videoPlan: campaign.video === undefined
      ? null
      : compileVideoPlan(project, campaign),
  }
}
