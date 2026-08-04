// @env node

import type { ProjectPreviewAdapter } from '../types'

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface ProjectPreviewAdapterRegistration {
  adapter: ProjectPreviewAdapter
  adapterId: string
  adapterVersion: string
  ownerApproved: boolean
  projectId: string
}

/**
 * Local-only registry for reviewed project preview adapters.
 *
 * Registrations are supplied by the application bootstrap code. They are not
 * serializable MCP input and are never discovered from a project directory.
 */
export class ProjectPreviewAdapterRegistry {
  private readonly adapters = new Map<string, ProjectPreviewAdapter>()

  constructor(registrations: readonly ProjectPreviewAdapterRegistration[] = []) {
    for (const registration of registrations)
      this.register(registration)
  }

  register(registration: ProjectPreviewAdapterRegistration): void {
    validateRegistration(registration)
    const key = registrationKey(registration.projectId, registration.adapterId)
    if (this.adapters.has(key))
      throw new Error(`Project preview adapter is already registered: ${key}`)
    this.adapters.set(key, registration.adapter)
  }

  resolve(
    projectId: string,
    adapterId: string | undefined,
  ): ProjectPreviewAdapter | undefined {
    if (adapterId === undefined)
      return undefined
    return this.adapters.get(registrationKey(projectId, adapterId))
  }
}

function validateRegistration(
  registration: ProjectPreviewAdapterRegistration,
): void {
  if (!IDENTIFIER_PATTERN.test(registration.projectId))
    throw new Error('Project preview adapter projectId must use lowercase kebab-case')
  if (!IDENTIFIER_PATTERN.test(registration.adapterId))
    throw new Error('Project preview adapter adapterId must use lowercase kebab-case')
  if (typeof registration.adapterVersion !== 'string' || registration.adapterVersion.trim() === '')
    throw new Error('Project preview adapter adapterVersion must be a non-empty string')
  if (registration.ownerApproved !== true)
    throw new Error('Project preview adapter requires explicit owner approval')
  if (registration.adapter.adapterId !== registration.adapterId)
    throw new Error('Project preview adapter adapterId must match its implementation')
  if (typeof registration.adapter.open !== 'function')
    throw new Error('Project preview adapter must implement open')
}

function registrationKey(projectId: string, adapterId: string): string {
  return `${projectId}:${adapterId}`
}
