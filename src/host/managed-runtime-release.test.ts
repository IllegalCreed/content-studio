// @env node

import type { KeyObject } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  verifyManagedMarketingOpsReleaseStatement,
} from './managed-runtime-release'

const supportedTarget = { arch: 'arm64', os: 'darwin' } as const

type JsonValue = boolean | number | string | JsonObject | JsonValue[]

interface JsonObject {
  [key: string]: JsonValue
}

function canonicalStatement(value: JsonValue): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, 'utf8')
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function releaseStatement(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    archive: {
      fileName: 'marketing-ops-0.1.0-darwin-arm64.tar.gz',
      sha256: 'a'.repeat(64),
      sizeBytes: 123_456,
    },
    compatibility: {
      contentStudioVersion: '0.1.0',
      contractVersion: 3,
    },
    keyId: 'test-key-2026',
    kind: 'marketing-ops-runtime-release',
    releaseId: 'marketing-ops-0.1.0-darwin-arm64',
    runtime: {
      contractVersion: 3,
      manifestSha256: 'b'.repeat(64),
      name: 'marketing-ops',
      version: '0.1.0',
    },
    schemaVersion: 1,
    target: supportedTarget,
    ...overrides,
  }
}

function signedInput(
  statement: JsonObject,
  privateKey: KeyObject,
  trustedPublicKeys: ReadonlyMap<string, KeyObject>,
) {
  const payload = canonicalStatement(statement)
  return {
    signature: sign(null, payload, privateKey).toString('base64'),
    statement: payload,
    trustedPublicKeys,
  }
}

function trustedKey(
  keyId: string,
  publicKey: KeyObject,
): ReadonlyMap<string, KeyObject> {
  return new Map([[keyId, publicKey]])
}

describe('installer-only marketing-ops release statement verification', () => {
  // This ephemeral key pair exists only in memory for this test. It is not a
  // production release root and is never written to the repository.
  const signingKeyPair = generateKeyPairSync('ed25519')

  it('returns a verified, data-only statement for the current supported target', () => {
    const input = signedInput(
      releaseStatement(),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const result = verifyManagedMarketingOpsReleaseStatement(input, supportedTarget)

    expect(result).toEqual({
      archive: {
        fileName: 'marketing-ops-0.1.0-darwin-arm64.tar.gz',
        sha256: 'a'.repeat(64),
        sizeBytes: 123_456,
      },
      compatibility: {
        contentStudioVersion: '0.1.0',
        contractVersion: 3,
      },
      keyId: 'test-key-2026',
      kind: 'marketing-ops-runtime-release',
      releaseId: 'marketing-ops-0.1.0-darwin-arm64',
      runtime: {
        contractVersion: 3,
        manifestSha256: 'b'.repeat(64),
        name: 'marketing-ops',
        version: '0.1.0',
      },
      schemaVersion: 1,
      target: supportedTarget,
    })
    if (result === null)
      throw new Error('Expected a valid signed release statement')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.archive)).toBe(true)
    expect(Object.isFrozen(result.compatibility)).toBe(true)
    expect(Object.isFrozen(result.runtime)).toBe(true)
    expect(Object.isFrozen(result.target)).toBe(true)
  })

  it('rejects a payload modified after its detached signature was made', () => {
    const input = signedInput(
      releaseStatement(),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const tampered = Buffer.from(input.statement)
    tampered[tampered.indexOf(Buffer.from('123_456'.replace('_', ''), 'utf8'))] = '9'.charCodeAt(0)

    expect(verifyManagedMarketingOpsReleaseStatement({ ...input, statement: tampered }, supportedTarget)).toBeNull()
  })

  it('rejects another key and malformed or wrong detached signatures', () => {
    const input = signedInput(
      releaseStatement(),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const otherKeyPair = generateKeyPairSync('ed25519')
    const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })

    expect(verifyManagedMarketingOpsReleaseStatement({
      ...input,
      trustedPublicKeys: trustedKey('test-key-2026', otherKeyPair.publicKey),
    }, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement({
      ...input,
      trustedPublicKeys: trustedKey('test-key-2026', rsaKeyPair.publicKey),
    }, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement({ ...input, signature: 'a'.repeat(88) }, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement({ ...input, signature: 'AAAA' }, supportedTarget)).toBeNull()
  })

  it('binds the statement keyId to exactly one caller-trusted public key', () => {
    const otherKeyPair = generateKeyPairSync('ed25519')
    const mismatched = signedInput(
      releaseStatement({ keyId: 'other-key' }),
      signingKeyPair.privateKey,
      trustedKey('other-key', otherKeyPair.publicKey),
    )
    const unknown = signedInput(
      releaseStatement({ keyId: 'unknown-key' }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )

    expect(verifyManagedMarketingOpsReleaseStatement(mismatched, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(unknown, supportedTarget)).toBeNull()
  })

  it('rejects unknown fields and duplicate JSON object keys before accepting a signature', () => {
    const unknown = signedInput(
      releaseStatement({ unexpected: 'field' }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const valid = canonicalStatement(releaseStatement()).toString('utf8')
    const duplicatePayload = Buffer.from(valid.replace(
      '"keyId":"test-key-2026",',
      '"keyId":"test-key-2026","keyId":"duplicate",',
    ), 'utf8')
    const duplicate = {
      signature: sign(null, duplicatePayload, signingKeyPair.privateKey).toString('base64'),
      statement: duplicatePayload,
      trustedPublicKeys: trustedKey('test-key-2026', signingKeyPair.publicKey),
    }

    expect(verifyManagedMarketingOpsReleaseStatement(unknown, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(duplicate, supportedTarget)).toBeNull()
  })

  it('rejects valid JSON that is not canonical UTF-8 with a trailing newline', () => {
    const payload = Buffer.from(JSON.stringify(releaseStatement()), 'utf8')
    const input = {
      signature: sign(null, payload, signingKeyPair.privateKey).toString('base64'),
      statement: payload,
      trustedPublicKeys: trustedKey('test-key-2026', signingKeyPair.publicKey),
    }

    expect(verifyManagedMarketingOpsReleaseStatement(input, supportedTarget)).toBeNull()
  })

  it('rejects malformed UTF-8 and statements larger than the bounded envelope', () => {
    const input = signedInput(
      releaseStatement(),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )

    expect(verifyManagedMarketingOpsReleaseStatement({ ...input, statement: Buffer.from([0xFF]) }, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement({
      ...input,
      statement: Buffer.alloc(16 * 1024 + 1, 0x20),
    }, supportedTarget)).toBeNull()

    const throwingInput = new Proxy({}, {
      ownKeys: () => {
        throw new Error('untrusted getter')
      },
    })
    expect(verifyManagedMarketingOpsReleaseStatement(throwingInput, supportedTarget)).toBeNull()
  })

  it('rejects unsafe archive names and malformed archive digests', () => {
    const unsafeName = signedInput(
      releaseStatement({
        archive: {
          fileName: '../marketing-ops.tar.gz',
          sha256: 'a'.repeat(64),
          sizeBytes: 123_456,
        },
      }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const malformedDigest = signedInput(
      releaseStatement({
        archive: {
          fileName: 'marketing-ops-0.1.0-darwin-arm64.tar.gz',
          sha256: 'A'.repeat(64),
          sizeBytes: 123_456,
        },
      }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const nulName = signedInput(
      releaseStatement({
        archive: {
          fileName: 'marketing-ops\u0000.tar.gz',
          sha256: 'a'.repeat(64),
          sizeBytes: 123_456,
        },
      }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const oversizedKeyId = signedInput(
      releaseStatement({ keyId: 'a'.repeat(129) }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )

    expect(verifyManagedMarketingOpsReleaseStatement(unsafeName, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(malformedDigest, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(nulName, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(oversizedKeyId, supportedTarget)).toBeNull()
  })

  it('rejects a target mismatch and never falls back to another target', () => {
    const input = signedInput(
      releaseStatement(),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )

    expect(verifyManagedMarketingOpsReleaseStatement(input, { arch: 'x64', os: 'darwin' })).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(input, { arch: 'riscv64', os: 'darwin' })).toBeNull()
  })

  it('rejects incompatible Content Studio contracts and unsupported matching targets', () => {
    const incompatible = signedInput(
      releaseStatement({
        compatibility: {
          contentStudioVersion: '0.2.0',
          contractVersion: 3,
        },
      }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )
    const unsupported = signedInput(
      releaseStatement({ target: { arch: 'x64', os: 'linux' } }),
      signingKeyPair.privateKey,
      trustedKey('test-key-2026', signingKeyPair.publicKey),
    )

    expect(verifyManagedMarketingOpsReleaseStatement(incompatible, supportedTarget)).toBeNull()
    expect(verifyManagedMarketingOpsReleaseStatement(unsupported, { arch: 'x64', os: 'linux' })).toBeNull()
  })
})
