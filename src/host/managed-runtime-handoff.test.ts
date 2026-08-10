import { describe, expect, it } from 'vitest'
import {
  parseInstallerManagedRuntimeHandoff,
  serializeInstallerManagedRuntimeHandoff,
} from './managed-runtime-handoff'

const validHandoff = {
  contractVersion: 3,
  manifestSha256: 'a'.repeat(64),
  runtimeName: 'marketing-ops',
  runtimeRoot: '/opt/content-studio/runtimes/marketing-ops/0.1.0',
  runtimeVersion: '0.1.0',
} as const

describe('installer-managed runtime handoff', () => {
  it('accepts the exact fixed runtime contract', () => {
    expect(parseInstallerManagedRuntimeHandoff(validHandoff)).toEqual(validHandoff)
    expect(parseInstallerManagedRuntimeHandoff(JSON.stringify(validHandoff))).toEqual(validHandoff)
  })

  it('serializes a canonical exact-key handoff', () => {
    expect(serializeInstallerManagedRuntimeHandoff(validHandoff)).toBe(JSON.stringify(validHandoff))
    expect(() => serializeInstallerManagedRuntimeHandoff({
      ...validHandoff,
      command: 'must-not-cross-boundary',
    })).toThrowError('Invalid managed runtime handoff')
  })

  it('rejects extra fields and incompatible identity or digest formats', () => {
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, extra: true })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, runtimeName: 'other' })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, runtimeVersion: '1.0.0' })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, contractVersion: 4 })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, manifestSha256: 'A'.repeat(64) })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, manifestSha256: 'not-a-digest' })).toBeNull()
  })

  it('rejects unsafe runtime roots and malformed JSON without exposing input details', () => {
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, runtimeRoot: 'relative/path' })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, runtimeRoot: '/opt/../tmp/runtime' })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({
      ...validHandoff,
      runtimeRoot: '/opt/content-studio/runtimes/other/0.1.0',
    })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({
      ...validHandoff,
      runtimeRoot: '/opt/content-studio/runtimes/marketing-ops/0.1.0/extra',
    })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff({ ...validHandoff, runtimeRoot: '/tmp/runtime\u0000leak' })).toBeNull()
    expect(parseInstallerManagedRuntimeHandoff('{"runtimeRoot":"/private/secret"')).toBeNull()
    expect(() => serializeInstallerManagedRuntimeHandoff({ ...validHandoff, manifestSha256: 'secret' })).toThrowError(
      'Invalid managed runtime handoff',
    )
  })
})
