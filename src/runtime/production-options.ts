import type { ContentStudioApplicationService } from '../control-plane/service'
import type { OwnerTakeoverRegistry } from '../jobs/owner-takeover'
import type { ProductionTaskDependencies } from '../jobs/production'

/**
 * Builds the recording dependencies for one project. Owner takeover projects
 * get an injected confirmation controller and must run in a visible browser
 * so the owner can complete login or CAPTCHA; other projects are untouched.
 */
export function productionForProject(
  production: ProductionTaskDependencies,
  ownerTakeovers: OwnerTakeoverRegistry,
  service: ContentStudioApplicationService,
  projectId: string,
): ProductionTaskDependencies {
  if (service.getProjectView(projectId).project.ownerTakeover !== true)
    return production
  return {
    ...production,
    options: {
      ...production.options,
      headless: false,
      ownerTakeover: {
        request: async ({
          jobId,
          pageUrl,
          projectId: requestProjectId,
        }) => {
          await ownerTakeovers.request({
            jobId,
            pageUrl,
            projectId: requestProjectId,
          })
        },
      },
    },
  }
}
