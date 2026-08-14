// @env node

import { Buffer } from 'node:buffer'
import { KeyObject, timingSafeEqual, verify } from 'node:crypto'
import process from 'node:process'
import { MARKETING_OPS_MANAGED_RUNTIME_VERSION } from '../constants'

const RELEASE_SCHEMA_VERSION = 1
const RELEASE_KIND = 'marketing-ops-runtime-release'
const RUNTIME_NAME = 'marketing-ops'
const RUNTIME_VERSION = MARKETING_OPS_MANAGED_RUNTIME_VERSION
const CONTENT_STUDIO_VERSION = '0.1.0'
const CONTRACT_VERSION = 3
const SUPPORTED_TARGET = { arch: 'arm64', os: 'darwin' } as const
const MAX_STATEMENT_BYTES = 16 * 1024
const MAX_ARCHIVE_SIZE_BYTES = 1024 * 1024 * 1024
const MAX_IDENTIFIER_LENGTH = 128
const SIGNATURE_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u
export type ManagedMarketingOpsReleaseArchitecture = 'arm64' | 'x64'
export type ManagedMarketingOpsReleaseOperatingSystem = 'darwin' | 'linux' | 'win32'

const SUPPORTED_ARCHITECTURES: readonly ManagedMarketingOpsReleaseArchitecture[] = ['arm64', 'x64']
const SUPPORTED_OPERATING_SYSTEMS: readonly ManagedMarketingOpsReleaseOperatingSystem[] = ['darwin', 'linux', 'win32']

export interface ManagedMarketingOpsReleaseTarget {
  readonly arch: ManagedMarketingOpsReleaseArchitecture
  readonly os: ManagedMarketingOpsReleaseOperatingSystem
}

export interface ManagedMarketingOpsReleaseVerificationInput {
  /**
   * The caller-owned key set binds each statement keyId to one Ed25519 public
   * key. This module does not provide, discover, or designate an official
   * trust root.
   */
  trustedPublicKeys: ReadonlyMap<string, KeyObject>
  /** A canonical standard-base64 Ed25519 detached signature. */
  signature: string
  /** Exact UTF-8 release-statement bytes, including the final newline. */
  statement: Uint8Array
}

export interface VerifiedManagedMarketingOpsReleaseStatement {
  readonly archive: {
    readonly fileName: string
    readonly sha256: string
    readonly sizeBytes: number
  }
  readonly compatibility: {
    readonly contentStudioVersion: typeof CONTENT_STUDIO_VERSION
    readonly contractVersion: typeof CONTRACT_VERSION
  }
  readonly keyId: string
  readonly kind: typeof RELEASE_KIND
  readonly releaseId: string
  readonly runtime: {
    readonly contractVersion: typeof CONTRACT_VERSION
    readonly manifestSha256: string
    readonly name: typeof RUNTIME_NAME
    readonly version: typeof RUNTIME_VERSION
  }
  readonly schemaVersion: typeof RELEASE_SCHEMA_VERSION
  readonly target: Readonly<ManagedMarketingOpsReleaseTarget>
}

interface ParsedReleaseStatement {
  archive: {
    fileName: string
    sha256: string
    sizeBytes: number
  }
  compatibility: {
    contentStudioVersion: typeof CONTENT_STUDIO_VERSION
    contractVersion: typeof CONTRACT_VERSION
  }
  keyId: string
  kind: typeof RELEASE_KIND
  releaseId: string
  runtime: {
    contractVersion: typeof CONTRACT_VERSION
    manifestSha256: string
    name: typeof RUNTIME_NAME
    version: typeof RUNTIME_VERSION
  }
  schemaVersion: typeof RELEASE_SCHEMA_VERSION
  target: ManagedMarketingOpsReleaseTarget
}

/**
 * Strictly verifies an installer-only release statement. It neither acquires
 * a public key nor treats the supplied key as an official trust root. Calling
 * code must obtain the key map from the installer's embedded or independently
 * verified trust source; user input, environment variables, and project files
 * are not trust sources.
 *
 * The optional target exists only as a deterministic test seam. Production
 * installers should omit it so the current process target is selected, with
 * no fallback to a different archive.
 */
export function verifyManagedMarketingOpsReleaseStatement(
  input: unknown,
  target: unknown = currentTarget(),
): VerifiedManagedMarketingOpsReleaseStatement | null {
  try {
    const verification = parseVerificationInput(input)
    const selectedTarget = parseTarget(target)
    if (verification === null || selectedTarget === null)
      return null

    const payload = parseCanonicalPayload(verification.statement)
    if (payload === null)
      return null
    const statement = parseReleaseStatement(payload)
    if (statement === null
      || !sameTarget(statement.target, selectedTarget)
      || !sameTarget(selectedTarget, SUPPORTED_TARGET)) {
      return null
    }

    const publicKey = selectTrustedPublicKey(
      verification.trustedPublicKeys,
      statement.keyId,
    )
    if (publicKey === null)
      return null

    const signature = parseEd25519Signature(verification.signature)
    if (signature === null)
      return null
    if (!verify(null, verification.statement, publicKey, signature))
      return null
    return freezeVerifiedReleaseStatement(statement)
  }
  catch {
    return null
  }
}

function parseVerificationInput(
  input: unknown,
): ManagedMarketingOpsReleaseVerificationInput | null {
  if (!isRecord(input) || !hasExactKeys(input, ['signature', 'statement', 'trustedPublicKeys']))
    return null
  if (
    typeof input.signature !== 'string'
    || !(input.statement instanceof Uint8Array)
    || !(input.trustedPublicKeys instanceof Map)
  ) {
    return null
  }
  if (input.statement.byteLength === 0 || input.statement.byteLength > MAX_STATEMENT_BYTES)
    return null
  const statement = Buffer.from(input.statement)
  if (statement.byteLength === 0 || statement.byteLength > MAX_STATEMENT_BYTES)
    return null
  return {
    signature: input.signature,
    // Take one owned snapshot so canonical validation and signature checking
    // cannot observe different bytes if the caller mutates its view.
    statement,
    trustedPublicKeys: input.trustedPublicKeys,
  }
}

function parseCanonicalPayload(input: Uint8Array): Record<string, unknown> | null {
  if (input.byteLength === 0 || input.byteLength > MAX_STATEMENT_BYTES)
    return null
  const payload = Buffer.from(input)
  let decoded: string
  let parsed: unknown
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(payload)
    parsed = JSON.parse(decoded) as unknown
  }
  catch {
    return null
  }
  if (!isRecord(parsed))
    return null
  const canonical = Buffer.from(`${canonicalJson(parsed)}\n`, 'utf8')
  return canonical.length === payload.length && timingSafeEqual(canonical, payload)
    ? parsed
    : null
}

function parseReleaseStatement(
  input: Record<string, unknown>,
): ParsedReleaseStatement | null {
  if (!hasExactKeys(input, [
    'archive',
    'compatibility',
    'keyId',
    'kind',
    'releaseId',
    'runtime',
    'schemaVersion',
    'target',
  ])) {
    return null
  }
  const target = parseTarget(input.target)
  const runtime = parseRuntime(input.runtime)
  const archive = parseArchive(input.archive)
  const compatibility = parseCompatibility(input.compatibility)
  if (
    input.schemaVersion !== RELEASE_SCHEMA_VERSION
    || input.kind !== RELEASE_KIND
    || !isSafeIdentifier(input.releaseId)
    || !isSafeIdentifier(input.keyId)
    || target === null
    || runtime === null
    || archive === null
    || compatibility === null
  ) {
    return null
  }
  return {
    archive,
    compatibility,
    keyId: input.keyId,
    kind: RELEASE_KIND,
    releaseId: input.releaseId,
    runtime,
    schemaVersion: RELEASE_SCHEMA_VERSION,
    target,
  }
}

function parseTarget(input: unknown): ManagedMarketingOpsReleaseTarget | null {
  if (!isRecord(input) || !hasExactKeys(input, ['arch', 'os']))
    return null
  if (!isSupportedArchitecture(input.arch) || !isSupportedOperatingSystem(input.os))
    return null
  return { arch: input.arch, os: input.os }
}

function parseRuntime(input: unknown): ParsedReleaseStatement['runtime'] | null {
  if (!isRecord(input) || !hasExactKeys(input, [
    'contractVersion',
    'manifestSha256',
    'name',
    'version',
  ])) {
    return null
  }
  if (
    input.name !== RUNTIME_NAME
    || input.version !== RUNTIME_VERSION
    || input.contractVersion !== CONTRACT_VERSION
    || !isSha256(input.manifestSha256)
  ) {
    return null
  }
  return {
    contractVersion: CONTRACT_VERSION,
    manifestSha256: input.manifestSha256,
    name: RUNTIME_NAME,
    version: RUNTIME_VERSION,
  }
}

function parseArchive(input: unknown): ParsedReleaseStatement['archive'] | null {
  if (!isRecord(input) || !hasExactKeys(input, ['fileName', 'sha256', 'sizeBytes']))
    return null
  if (
    !isSafeArchiveFileName(input.fileName)
    || !isSha256(input.sha256)
    || typeof input.sizeBytes !== 'number'
    || !Number.isSafeInteger(input.sizeBytes)
    || input.sizeBytes < 1
    || input.sizeBytes > MAX_ARCHIVE_SIZE_BYTES
  ) {
    return null
  }
  return {
    fileName: input.fileName,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
  }
}

function parseCompatibility(
  input: unknown,
): ParsedReleaseStatement['compatibility'] | null {
  if (!isRecord(input) || !hasExactKeys(input, ['contentStudioVersion', 'contractVersion']))
    return null
  if (
    input.contentStudioVersion !== CONTENT_STUDIO_VERSION
    || input.contractVersion !== CONTRACT_VERSION
  ) {
    return null
  }
  return {
    contentStudioVersion: CONTENT_STUDIO_VERSION,
    contractVersion: CONTRACT_VERSION,
  }
}

function parseEd25519Signature(input: string): Buffer | null {
  if (!SIGNATURE_BASE64_PATTERN.test(input))
    return null
  const signature = Buffer.from(input, 'base64')
  return signature.length === 64 && signature.toString('base64') === input
    ? signature
    : null
}

function selectTrustedPublicKey(
  keys: ReadonlyMap<string, KeyObject>,
  keyId: string,
): KeyObject | null {
  try {
    const key = Map.prototype.get.call(keys, keyId) as unknown
    return key instanceof KeyObject
      && key.type === 'public'
      && key.asymmetricKeyType === 'ed25519'
      ? key
      : null
  }
  catch {
    return null
  }
}

function freezeVerifiedReleaseStatement(
  statement: ParsedReleaseStatement,
): VerifiedManagedMarketingOpsReleaseStatement {
  return Object.freeze({
    archive: Object.freeze({ ...statement.archive }),
    compatibility: Object.freeze({ ...statement.compatibility }),
    keyId: statement.keyId,
    kind: statement.kind,
    releaseId: statement.releaseId,
    runtime: Object.freeze({ ...statement.runtime }),
    schemaVersion: statement.schemaVersion,
    target: Object.freeze({ ...statement.target }),
  })
}

function canonicalJson(input: unknown): string {
  if (Array.isArray(input))
    return `[${input.map(canonicalJson).join(',')}]`
  if (isRecord(input)) {
    const entries = Object.keys(input)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
    return `{${entries.join(',')}}`
  }
  const encoded = JSON.stringify(input)
  return typeof encoded === 'string' ? encoded : ''
}

function currentTarget(): { arch: string, os: string } {
  return { arch: process.arch, os: process.platform }
}

function sameTarget(
  left: ManagedMarketingOpsReleaseTarget,
  right: ManagedMarketingOpsReleaseTarget,
): boolean {
  return left.arch === right.arch && left.os === right.os
}

function isSafeArchiveFileName(input: unknown): input is string {
  return isSafeIdentifier(input)
    && !input.includes('/')
    && !input.includes('\\')
}

function isSafeIdentifier(input: unknown): input is string {
  return typeof input === 'string'
    && input.length > 0
    && input.length <= MAX_IDENTIFIER_LENGTH
    && !input.includes('\u0000')
    && !input.includes('..')
    && !input.includes('/')
    && !input.includes('\\')
    && IDENTIFIER_PATTERN.test(input)
}

function isSupportedArchitecture(
  input: unknown,
): input is ManagedMarketingOpsReleaseArchitecture {
  return typeof input === 'string'
    && SUPPORTED_ARCHITECTURES.includes(input as typeof SUPPORTED_ARCHITECTURES[number])
}

function isSupportedOperatingSystem(
  input: unknown,
): input is ManagedMarketingOpsReleaseOperatingSystem {
  return typeof input === 'string'
    && SUPPORTED_OPERATING_SYSTEMS.includes(input as typeof SUPPORTED_OPERATING_SYSTEMS[number])
}

function isSha256(input: unknown): input is string {
  return typeof input === 'string' && SHA256_PATTERN.test(input)
}

function hasExactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input)
  return keys.length === expected.length
    && keys.every(key => expected.includes(key))
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
