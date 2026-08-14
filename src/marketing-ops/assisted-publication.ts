// @env node

import type { ContentStudioApplicationService } from '../control-plane/service'
import type {
  MarketingOpsAssistedPublicationAuthorization,
  MarketingOpsAssistedPublicationResult,
  MarketingOpsAssistedPublicationService,
  MarketingOpsChannelsStatusSnapshot,
  MarketingOpsChannelStatus,
  MarketingOpsPublicationPackage,
  MarketingOpsPublishClient,
  MarketingOpsPublishResult,
  MarketingOpsStatusClient,
  PrepareMarketingOpsPublicationPackageInput,
} from '../types'
import { createHash } from 'node:crypto'
import {
  BILIBILI_OWNER_LOGIN_REQUIRED_MESSAGE,
  BILIBILI_OWNER_STATUS_UNCONFIRMED_MESSAGE,
  MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE,
} from '../constants'
import { stageMarketingOpsAssetBundle } from './assets'
import { isMarketingOpsStatusSnapshotFresh } from './client'
import {
  buildMarketingOpsCampaignRequest,
  createMarketingOpsCampaignSpec,
} from './publish'

interface MarketingOpsAssistedPublicationDependencies {
  assetBundleRoot?: string
  publish: MarketingOpsPublishClient
  service: ContentStudioApplicationService
  sourceRoot?: string
  status?: MarketingOpsStatusClient
}

export function createMarketingOpsAssistedPublicationService(
  dependencies: MarketingOpsAssistedPublicationDependencies,
): MarketingOpsAssistedPublicationService {
  return {
    abandon: input => abandonMarketingOpsPublication(input, dependencies),
    confirm: input => confirmMarketingOpsPublication(input, dependencies),
    prepare: input => prepareMarketingOpsPublication(input, dependencies),
    prepareBilibili: input => prepareBilibiliMarketingOpsPublication(input, dependencies),
    resume: input => resumeMarketingOpsPublication(input, dependencies),
  }
}

async function prepareBilibiliMarketingOpsPublication(
  input: {
    authorization: MarketingOpsAssistedPublicationAuthorization
    projectId: string
    publicationId: string
  },
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  const preparedPackage = dependencies.service
    .prepareBilibiliMarketingOpsPublicationPackage(input)
    .package
  const statusBefore = await readMarketingOpsStatus(
    input.projectId,
    dependencies.status,
  )
  const accountRef = syncBilibiliOwnerAssistedBinding(
    dependencies.service,
    input.projectId,
    statusBefore,
  )
  const packageValue = withBilibiliPackageAccountRef(preparedPackage, accountRef)
  return preparePackage(packageValue, input.authorization, statusBefore, dependencies)
}

async function prepareMarketingOpsPublication(
  input: {
    authorization: MarketingOpsAssistedPublicationAuthorization
    preparation: PrepareMarketingOpsPublicationPackageInput
  },
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  const statusBefore = await readMarketingOpsStatus(
    input.preparation.projectId,
    dependencies.status,
  )
  syncBilibiliOwnerAssistedBinding(
    dependencies.service,
    input.preparation.projectId,
    statusBefore,
  )
  const packageValue = dependencies.service
    .prepareMarketingOpsPublicationPackage(input.preparation)
    .package
  return preparePackage(packageValue, input.authorization, statusBefore, dependencies)
}

async function resumeMarketingOpsPublication(
  input: {
    authorization: MarketingOpsAssistedPublicationAuthorization
    handoffId: string
    projectId: string
  },
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  const handoff = dependencies.service.getMarketingOpsPublicationHandoff(
    input.projectId,
    input.handoffId,
  )
  if (handoff.status !== 'pending')
    throw new Error('Completed marketing-ops handoffs cannot be resumed')
  const storedPackageValue = handoff.marketingOpsPackage
  if (storedPackageValue === undefined)
    throw new Error('Owner handoff does not contain a marketing-ops package')
  const statusBefore = await readMarketingOpsStatus(
    storedPackageValue.projectId,
    dependencies.status,
  )
  const accountRef = syncBilibiliOwnerAssistedBinding(
    dependencies.service,
    storedPackageValue.projectId,
    statusBefore,
  )
  const packageValue = withBilibiliPackageAccountRef(storedPackageValue, accountRef)
  return preparePackage(packageValue, input.authorization, statusBefore, dependencies)
}

async function preparePackage(
  packageValue: MarketingOpsPublicationPackage,
  authorization: MarketingOpsAssistedPublicationAuthorization,
  statusBefore: MarketingOpsChannelsStatusSnapshot,
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  assertBilibiliAssistedPackage(packageValue)
  assertCurrentBilibiliOwnerAssistedBinding(dependencies.service, packageValue)
  if (dependencies.assetBundleRoot === undefined)
    throw new Error('Marketing Ops asset bundle root is unavailable')
  if (dependencies.sourceRoot === undefined)
    throw new Error('Marketing Ops source root is unavailable')
  await stageMarketingOpsAssetBundle({
    artifacts: dependencies.service.getProjectView(packageValue.projectId).activityArtifacts,
    bundleRoot: dependencies.assetBundleRoot,
    package: packageValue,
    sourceRoot: dependencies.sourceRoot,
  })
  const result = await dependencies.publish.publishCampaign(
    campaignRequest(packageValue, authorization, { mode: 'assisted-prepare' }),
  )
  const remoteHandoff = exactAwaitingOwnerHandoff(result, packageValue)
  const statusAfter = await readMarketingOpsStatus(packageValue.projectId, dependencies.status)
  assertBilibiliStatusMatchesPackage(statusAfter, packageValue)
  let handoff = dependencies.service.createMarketingOpsPublicationHandoff(packageValue)
  if (remoteHandoff.action === 'assisted-confirm') {
    if (remoteHandoff.publicUrl === undefined)
      throw new Error('Marketing Ops did not return an observed public URL')
    handoff = dependencies.service.claimMarketingOpsPublicationConfirmation(
      packageValue.projectId,
      handoff.handoffId,
      remoteHandoff.publicUrl,
    )
  }
  return {
    ...result,
    channelsStatus: { after: statusAfter, before: statusBefore },
    handoff,
    mode: 'assisted-prepare',
    package: packageValue,
  }
}

async function confirmMarketingOpsPublication(
  input: {
    authorization: MarketingOpsAssistedPublicationAuthorization
    handoffId: string
    projectId: string
    publicUrl?: string
  },
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  const handoff = dependencies.service.getMarketingOpsPublicationHandoff(
    input.projectId,
    input.handoffId,
  )
  const storedPackageValue = handoff.marketingOpsPackage
  if (storedPackageValue === undefined)
    throw new Error('Owner handoff does not contain a marketing-ops package')
  const publicUrl = confirmationUrl(handoff, input.publicUrl)
  const statusBefore = await readMarketingOpsStatus(
    storedPackageValue.projectId,
    dependencies.status,
  )
  const accountRef = syncBilibiliOwnerAssistedBinding(
    dependencies.service,
    storedPackageValue.projectId,
    statusBefore,
  )
  const packageValue = withBilibiliPackageAccountRef(storedPackageValue, accountRef)
  assertBilibiliAssistedPackage(packageValue)
  assertCurrentBilibiliOwnerAssistedBinding(dependencies.service, packageValue)
  dependencies.service.claimMarketingOpsPublicationConfirmation(
    input.projectId,
    input.handoffId,
    publicUrl,
  )
  try {
    const result = await dependencies.publish.publishCampaign(
      campaignRequest(packageValue, input.authorization, {
        confirmations: [{
          channel: packageValue.channel,
          form: packageValue.contentFormat,
          packageId: packageValue.packageId,
          publicUrl,
          publicationId: packageValue.publicationId,
        }],
        mode: 'assisted-confirm',
      }),
    )
    const receipt = assertMarketingOpsAssistedConfirmationResult(
      result,
      packageValue,
      publicUrl,
    )
    const statusAfter = await readMarketingOpsStatus(packageValue.projectId, dependencies.status)
    assertBilibiliStatusMatchesPackage(statusAfter, packageValue)
    dependencies.service.recordPublicationReceipt(receipt)
    const completedHandoff = dependencies.service.completeMarketingOpsPublicationHandoff(
      input.projectId,
      input.handoffId,
      publicUrl,
    )
    return {
      ...result,
      channelsStatus: { after: statusAfter, before: statusBefore },
      handoff: completedHandoff,
      mode: 'assisted-confirm',
      package: packageValue,
    }
  }
  catch (error) {
    dependencies.service.releaseMarketingOpsPublicationConfirmation(
      input.projectId,
      input.handoffId,
      publicUrl,
    )
    throw error
  }
}

async function abandonMarketingOpsPublication(
  input: {
    authorization: MarketingOpsAssistedPublicationAuthorization
    handoffId: string
    projectId: string
  },
  dependencies: MarketingOpsAssistedPublicationDependencies,
): Promise<MarketingOpsAssistedPublicationResult> {
  const handoff = dependencies.service.getMarketingOpsPublicationHandoffForAbandonment(
    input.projectId,
    input.handoffId,
  )
  const packageValue = handoff.marketingOpsPackage
  if (packageValue === undefined)
    throw new Error('Owner handoff does not contain a marketing-ops package')
  assertBilibiliAssistedPackage(packageValue)
  if (packageValue.accountRef === undefined)
    throw new Error('Bilibili owner handoff has no locked account reference')
  assertCurrentBilibiliOwnerAssistedBinding(dependencies.service, packageValue)
  const result = await dependencies.publish.publishCampaign(
    campaignRequest(packageValue, input.authorization, { mode: 'assisted-abandon' }),
  )
  const abandoned = result.handoffs.filter(candidate =>
    candidate.packageId === packageValue.packageId
    && candidate.publicationId === packageValue.publicationId
    && candidate.form === packageValue.contentFormat
    && candidate.status === 'abandoned',
  )
  if (result.failures.length > 0 || result.receipts.length > 0 || abandoned.length !== 1)
    throw new Error('Marketing Ops did not abandon the exact owner handoff')
  const cancelled = dependencies.service.abandonMarketingOpsPublicationHandoff(
    input.projectId,
    input.handoffId,
  )
  return {
    ...result,
    handoff: cancelled,
    mode: 'assisted-abandon',
    package: packageValue,
  }
}

function campaignRequest(
  packageValue: MarketingOpsPublicationPackage,
  authorization: MarketingOpsAssistedPublicationAuthorization,
  execution: Parameters<typeof buildMarketingOpsCampaignRequest>[0]['execution'],
): ReturnType<typeof buildMarketingOpsCampaignRequest> {
  return buildMarketingOpsCampaignRequest({
    authorization,
    campaignId: packageValue.campaignId,
    execution,
    idempotencyKey: publicationIdempotencyKey(packageValue),
    packages: [packageValue],
    spec: createMarketingOpsCampaignSpec([packageValue]),
  })
}

async function readMarketingOpsStatus(
  projectId: string,
  statusClient: MarketingOpsStatusClient | undefined,
): Promise<MarketingOpsChannelsStatusSnapshot> {
  if (statusClient === undefined)
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  try {
    const status = await statusClient.getChannelsStatus(projectId)
    if (
      status.projectId !== projectId
      || status.authorizesExternalWrite !== false
      || !isMarketingOpsStatusSnapshotFresh(status)
    ) {
      throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
    }
    return status
  }
  catch {
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  }
}

function exactAwaitingOwnerHandoff(
  result: MarketingOpsPublishResult,
  packageValue: MarketingOpsPublicationPackage,
): MarketingOpsPublishResult['handoffs'][number] {
  const matches = result.handoffs.filter(handoff =>
    handoff.packageId === packageValue.packageId
    && handoff.publicationId === packageValue.publicationId
    && handoff.form === packageValue.contentFormat
    && handoff.status === 'awaiting-owner',
  )
  if (result.failures.length > 0 || matches.length !== 1) {
    const failureSummary = summarizeMarketingOpsFailures(result.failures)
    throw new Error(
      failureSummary === undefined
        ? 'Marketing Ops did not prepare the owner handoff'
        : `Marketing Ops did not prepare the owner handoff: ${failureSummary}`,
    )
  }
  return matches[0]!
}

function confirmationUrl(
  handoff: ReturnType<ContentStudioApplicationService['getMarketingOpsPublicationHandoff']>,
  requestedUrl: string | undefined,
): string {
  const claimed = handoff.marketingOpsConfirmation?.publicUrl
  if (requestedUrl !== undefined)
    return requestedUrl
  if (claimed === undefined || handoff.marketingOpsConfirmation?.status !== 'pending')
    throw new Error('Marketing-ops confirmation requires a runtime-observed public URL')
  return claimed
}

function assertCurrentBilibiliOwnerAssistedBinding(
  service: ContentStudioApplicationService,
  packageValue: MarketingOpsPublicationPackage,
): void {
  const binding = service
    .getProjectView(packageValue.projectId)
    .projectChannelBindings
    .find(candidate => candidate.channel === 'bilibili')
  if (
    binding?.enabled !== true
    || binding.delivery !== 'owner-assisted'
    || binding.accountRef !== packageValue.accountRef
  ) {
    throw new Error(
      'Bilibili owner-assisted confirmation requires the current matching channel binding',
    )
  }
}

function syncBilibiliOwnerAssistedBinding(
  service: ContentStudioApplicationService,
  projectId: string,
  status: MarketingOpsChannelsStatusSnapshot,
): string {
  const bilibili = assertBilibiliAssistedReady(status)
  const accountRef = bilibili.accountRef
  if (accountRef === undefined)
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  const binding = service
    .getProjectView(projectId)
    .projectChannelBindings
    .find(candidate => candidate.channel === 'bilibili')
  if (binding?.enabled !== true || binding.delivery !== 'owner-assisted') {
    throw new Error(
      'Bilibili owner-assisted publication requires the current matching channel binding',
    )
  }
  if (binding.accountRef !== undefined && binding.accountRef !== accountRef) {
    throw new Error(
      'Bilibili owner-assisted publication requires the current matching account scope',
    )
  }
  if (binding.accountRef === undefined)
    service.updateProjectChannelBinding({ ...binding, accountRef })
  return accountRef
}

function withBilibiliPackageAccountRef(
  packageValue: MarketingOpsPublicationPackage,
  accountRef: string,
): MarketingOpsPublicationPackage {
  if (packageValue.accountRef !== undefined && packageValue.accountRef !== accountRef) {
    throw new Error(
      'Bilibili owner-assisted publication requires the current matching account scope',
    )
  }
  return packageValue.accountRef === accountRef
    ? packageValue
    : { ...packageValue, accountRef }
}

function assertBilibiliStatusMatchesPackage(
  status: MarketingOpsChannelsStatusSnapshot,
  packageValue: MarketingOpsPublicationPackage,
): void {
  const bilibili = assertBilibiliAssistedReady(status)
  if (bilibili.accountRef !== packageValue.accountRef) {
    throw new Error(
      'Bilibili owner-assisted publication requires the current matching account scope',
    )
  }
}

function assertMarketingOpsAssistedConfirmationResult(
  result: MarketingOpsPublishResult,
  packageValue: MarketingOpsPublicationPackage,
  publicUrl: string,
): MarketingOpsPublishResult['receipts'][number] {
  if (result.failures.length > 0) {
    const failureSummary = summarizeMarketingOpsFailures(result.failures)
    throw new Error(
      failureSummary === undefined
        ? 'Marketing Ops returned failures for the owner confirmation'
        : `Marketing Ops returned failures for the owner confirmation: ${failureSummary}`,
    )
  }
  if (result.receipts.length !== 1)
    throw new Error('Marketing Ops must return exactly one confirmation receipt')
  const receipt = result.receipts[0]!
  if (
    receipt.projectId !== packageValue.projectId
    || receipt.activityId !== packageValue.activityId
    || receipt.publicationId !== packageValue.publicationId
    || receipt.channel !== packageValue.channel
    || receipt.accountRef !== packageValue.accountRef
    || receipt.contentSha256 !== packageValue.contentHash
    || receipt.videoOrientation !== packageValue.videoOrientation
    || receipt.publicUrl !== publicUrl
    || receipt.status !== 'published'
  ) {
    throw new Error('Marketing Ops did not return a matching confirmation receipt')
  }
  return receipt
}

function assertBilibiliAssistedPackage(
  packageValue: MarketingOpsPublicationPackage,
): void {
  if (packageValue.channel !== 'bilibili')
    throw new Error('Only Bilibili owner-assisted packages are enabled')
}

function assertBilibiliAssistedReady(
  status: MarketingOpsChannelsStatusSnapshot,
): MarketingOpsChannelStatus {
  if (!status.capabilities?.includes('content-studio-assisted-publication-v1'))
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  const bilibili = status.channels.find(channel => channel.channel === 'bilibili')
  if (bilibili?.health === 'reauth-required')
    throw new Error(BILIBILI_OWNER_LOGIN_REQUIRED_MESSAGE)
  if (bilibili?.health === 'blocked')
    throw new Error(BILIBILI_OWNER_STATUS_UNCONFIRMED_MESSAGE)
  if (
    bilibili === undefined
    || bilibili.health !== 'ready'
    || bilibili.adapterReady !== true
    || bilibili.assistedPublicationReady !== true
  ) {
    throw new Error(MARKETING_OPS_STATUS_UNAVAILABLE_MESSAGE)
  }
  return bilibili
}

function publicationIdempotencyKey(
  packageValue: Pick<MarketingOpsPublicationPackage, 'contentHash' | 'projectId' | 'publicationId'>,
): string {
  const digest = createHash('sha256')
    .update(`${packageValue.projectId}:${packageValue.publicationId}:${packageValue.contentHash}`)
    .digest('hex')
  return `content-studio/${digest}`
}

function summarizeMarketingOpsFailures(
  failures: MarketingOpsPublishResult['failures'],
): string | undefined {
  if (failures.length === 0)
    return undefined
  return failures
    .map((failure) => {
      const parts = [failure.packageId, failure.code, failure.message]
      if (failure.retryable === true)
        parts.push('retryable=true')
      return parts.join(': ')
    })
    .join(' | ')
}
