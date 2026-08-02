import type { ProjectManifest, ProjectRecord } from '../types'

export function createProjectRecord(
  manifest: ProjectManifest,
  snapshotId: string,
): ProjectRecord {
  const sourceAccess = manifest.sourceAccess ?? 'source-owned'
  const captureMode = manifest.captureMode
    ?? (sourceAccess === 'web-assisted' ? 'assisted' : 'deterministic')

  return {
    captureMode,
    currentSnapshotId: snapshotId,
    name: manifest.name,
    projectId: manifest.projectId,
    repeatability: manifest.repeatability
      ?? (captureMode === 'deterministic' ? 'high' : 'low'),
    sourceAccess,
  }
}
