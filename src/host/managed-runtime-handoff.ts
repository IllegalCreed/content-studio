// @env node

import { isAbsolute, resolve } from 'node:path'

export const INSTALLER_MANAGED_RUNTIME_HANDOFF = {
  contractVersion: 3,
  runtimeName: 'marketing-ops',
  runtimeVersion: '0.1.0',
} as const

const HANDOFF_KEYS = [
  'contractVersion',
  'manifestSha256',
  'runtimeName',
  'runtimeRoot',
  'runtimeVersion',
] as const

export interface InstallerManagedRuntimeHandoff {
  contractVersion: typeof INSTALLER_MANAGED_RUNTIME_HANDOFF.contractVersion
  manifestSha256: string
  runtimeName: typeof INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeName
  runtimeRoot: string
  runtimeVersion: typeof INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeVersion
}

/**
 * Parses an installer-owned handoff without consulting process state or the
 * filesystem. Invalid input is deliberately reduced to null so paths and
 * other installer details never appear in an error message.
 */
export function parseInstallerManagedRuntimeHandoff(
  input: unknown,
): InstallerManagedRuntimeHandoff | null {
  const value = typeof input === 'string' ? parseJson(input) : input
  if (!isRecord(value))
    return null
  const keys = Object.keys(value)
  if (keys.length !== HANDOFF_KEYS.length || !keys.every(key => HANDOFF_KEYS.includes(key as typeof HANDOFF_KEYS[number])))
    return null
  if (
    value.contractVersion !== INSTALLER_MANAGED_RUNTIME_HANDOFF.contractVersion
    || value.runtimeName !== INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeName
    || value.runtimeVersion !== INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeVersion
    || typeof value.manifestSha256 !== 'string'
    || !isSha256(value.manifestSha256)
    || typeof value.runtimeRoot !== 'string'
    || !isSafeAbsoluteRuntimeRoot(value.runtimeRoot)
  ) {
    return null
  }
  return {
    contractVersion: INSTALLER_MANAGED_RUNTIME_HANDOFF.contractVersion,
    manifestSha256: value.manifestSha256,
    runtimeName: INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeName,
    runtimeRoot: value.runtimeRoot,
    runtimeVersion: INSTALLER_MANAGED_RUNTIME_HANDOFF.runtimeVersion,
  }
}

/**
 * Serializes only a validated handoff and keeps a deterministic key order for
 * the installer-to-host boundary. The error intentionally contains no input.
 */
export function serializeInstallerManagedRuntimeHandoff(input: unknown): string {
  const handoff = parseInstallerManagedRuntimeHandoff(input)
  if (handoff === null)
    throw new Error('Invalid managed runtime handoff')
  return JSON.stringify(handoff)
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  }
  catch {
    return null
  }
}

function isSafeAbsoluteRuntimeRoot(input: string): boolean {
  if (!input || input.includes('\u0000') || !isAbsolute(input))
    return false
  if (resolve(input) !== input)
    return false
  const segments = input.split(/[\\/]+/u).filter(Boolean)
  return segments.slice(-3).join('/') === 'runtimes/marketing-ops/0.1.0'
}

function isSha256(input: string): boolean {
  return /^[a-f0-9]{64}$/u.test(input)
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
