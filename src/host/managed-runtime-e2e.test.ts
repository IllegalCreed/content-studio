// @env node

import type {
  ChannelContentFormat,
  MarketingOpsCampaignRequest,
  MarketingOpsManagedRuntime,
} from '../types'
import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContentStudioApplicationService,
  InMemoryContentStudioRepository,
} from '../control-plane/service'
import { installManagedMarketingOpsRuntime } from '../installer-host'
import { InMemoryExecutionTaskStore } from '../jobs/task'
import { createContentStudioMcpServer } from '../mcp/server'
import { resolveManagedMarketingOpsRuntimeAsset } from './managed-runtime-asset'
import {
  createInstallerManagedRuntimeBootstrap,
} from './managed-runtime-bootstrap'
import { createManagedMarketingOpsStdioConnector } from './managed-runtime-stdio'

const stagingRoot = process.env.CONTENT_STUDIO_TEST_MARKETING_OPS_STAGING
const temporaryDirectories: string[] = []

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function packageValue(
  form: 'image-text' | 'short-post' | 'video',
  packageId: string,
  mediaKind?: 'image' | 'video',
  videoOrientation: 'landscape' | 'portrait' = 'landscape',
): MarketingOpsCampaignRequest['packages'][number] {
  const link = `https://example.com/stdio-e2e/${packageId}/`
  return {
    channel: 'bilibili',
    contentStudio: {
      activityId: `stdio-e2e-${packageId}-activity`,
      artifactRefs: mediaKind === undefined
        ? []
        : [{
            artifactId: `${packageId}-asset`,
            kind: mediaKind,
            locale: 'en',
            mediaKind,
            sha256: mediaKind === 'image' ? 'b'.repeat(64) : 'c'.repeat(64),
            version: 1,
          }],
      contentFormat: form,
      contentHash: (mediaKind === undefined ? 'a' : mediaKind === 'image' ? 'b' : 'c').repeat(64),
      contentId: `stdio-e2e-${packageId}-content`,
      contentVersion: 1,
      packageId,
      projectId: 'algorithm-visualizer',
      publicationId: packageId,
      schemaVersion: 1,
      ...(form === 'video' ? { videoOrientation } : {}),
    },
    format: 'manual-package',
    utmMedium: 'social',
    variants: [{
      body: `A local MCP ${form} handoff ${link}`,
      links: [link],
      locale: 'en',
      media: mediaKind === undefined ? [] : [mediaKind],
      title: `Local MCP ${form}`,
    }],
  }
}

function request(): MarketingOpsCampaignRequest {
  const packages = [
    packageValue('image-text', 'stdio-e2e-image-text', 'image'),
    packageValue('video', 'stdio-e2e-video-landscape', 'video', 'landscape'),
    packageValue('video', 'stdio-e2e-video-portrait', 'video', 'portrait'),
    packageValue('short-post', 'stdio-e2e-short-post'),
  ]
  return {
    authorization: {
      authorizedAt: '2026-08-10T00:00:00.000Z',
      source: 'owner-prompt',
    },
    campaignId: 'stdio-e2e-campaign',
    execution: { mode: 'assisted-prepare' },
    idempotencyKey: 'content-studio/stdio-e2e/12345678',
    packages,
    projectId: 'algorithm-visualizer',
    spec: {
      campaign: 'stdio-e2e-campaign',
      channels: ['bilibili'],
      content: {
        media: ['image', 'video'],
        variants: {
          en: {
            angle: 'A local MCP handoff',
            callToAction: 'Open',
            title: 'Local MCP handoff',
          },
        },
      },
      failureMode: 'continue-supported',
      id: 'stdio-e2e-campaign',
      locales: ['en'],
      publishAt: '2026-08-10T00:00:00.000Z',
      replies: { createBugIssues: false, mode: 'off' },
      schemaVersion: 1,
      targetUrls: packages.map(packageValue => packageValue.variants[0]!.links[0]!),
      topic: 'Local MCP handoff',
    },
  }
}

function createMcpFixture(): {
  publicationIds: Record<'image-text' | 'short-post' | 'video', string>
  service: ContentStudioApplicationService
} {
  const projectId = 'algorithm-visualizer'
  const repository = new InMemoryContentStudioRepository()
  const service = new ContentStudioApplicationService(
    repository,
    new InMemoryExecutionTaskStore(),
  )
  const snapshotId = 'stdio-mcp-fixture-snapshot-1'
  service.registerProject({
    captureMode: 'deterministic',
    currentSnapshotId: snapshotId,
    name: 'stdio MCP fixture',
    projectId,
    repeatability: 'high',
    sourceAccess: 'source-owned',
  }, {
    manifest: {
      canonicalUrl: 'https://example.com/',
      captureFlows: [{
        id: 'stdio-flow',
        startPath: '/',
        steps: [],
        title: { 'en': 'stdio flow', 'zh-CN': 'stdio flow' },
      }],
      facts: [],
      locales: ['en'],
      name: 'stdio MCP fixture',
      projectId,
      repositoryUrl: 'https://github.com/example/stdio-mcp-fixture',
      schemaVersion: 1,
      tagline: { 'en': 'stdio MCP fixture', 'zh-CN': 'stdio MCP fixture' },
    },
    projectId,
    snapshotId,
    version: 1,
  })
  service.bindProjectChannel({
    channel: 'bilibili',
    delivery: 'owner-assisted',
    enabled: true,
    projectId,
  })
  const activity = service.createActivity({
    activityId: 'stdio-mcp-activity',
    campaignId: 'stdio-mcp-campaign',
    channels: [{
      contentFormats: ['image-text', 'short-post', 'video-metadata'],
      id: 'bilibili',
      locale: 'en',
    }],
    goal: 'education',
    projectId,
    projectSnapshotId: snapshotId,
    status: 'draft',
    targetUrl: 'https://example.com/docs',
    topic: { 'en': 'MCP fixture', 'zh-CN': 'MCP fixture' },
    video: { flowIds: ['stdio-flow'], format: 'landscape' },
  })
  const imageArtifact = service.createActivityArtifact({
    activityId: activity.activityId,
    artifactId: 'stdio-mcp-image-asset',
    kind: 'image',
    locale: 'en',
    projectId,
    relativePath: 'assets/stdio-mcp-image.png',
    sha256: 'd'.repeat(64),
  })
  const videoArtifact = service.createActivityArtifact({
    activityId: activity.activityId,
    artifactId: 'stdio-mcp-video-asset',
    kind: 'video',
    locale: 'en',
    projectId,
    relativePath: 'composed/stdio-mcp-video.mp4',
    sha256: 'e'.repeat(64),
  })
  const contents = [
    {
      artifactIds: [imageArtifact.artifactId],
      body: 'Image-text fixture https://example.com/docs',
      channel: 'bilibili' as const,
      contentId: 'stdio-mcp-image-text',
      format: 'image-text' as const,
      locale: 'en' as const,
      title: 'Image-text fixture',
    },
    {
      artifactIds: [videoArtifact.artifactId],
      body: 'Video fixture https://example.com/docs',
      channel: 'bilibili' as const,
      contentId: 'stdio-mcp-video',
      format: 'video' as const,
      locale: 'en' as const,
      title: 'Video fixture',
    },
    {
      artifactIds: [],
      body: 'Short-post fixture https://example.com/docs',
      channel: 'bilibili' as const,
      contentId: 'stdio-mcp-short-post',
      format: 'short-post' as const,
      locale: 'en' as const,
      title: 'Short-post fixture',
    },
  ]
  const pack = service.saveActivityContentPack({
    activityId: activity.activityId,
    contentGroupId: 'stdio-mcp-content-group',
    contents,
    coreMessage: 'MCP fixture content',
    projectId,
    title: 'MCP fixture content',
  })
  const publicationIds = Object.fromEntries(pack.contents.map(content => [
    content.format,
    service.createPublicationPlan({
      activityId: activity.activityId,
      channel: 'bilibili',
      contentId: content.contentId,
      projectId,
      publicationId: `stdio-mcp-${content.format}-publication`,
    }).publicationId,
  ])) as Record<ChannelContentFormat & ('image-text' | 'short-post' | 'video'), string>
  return { publicationIds, service }
}

async function createPrivateHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'content-studio-marketing-ops-home-'))
  temporaryDirectories.push(home)
  const root = join(home, 'Library', 'Application Support', 'marketing-ops')
  const projects = join(root, 'projects')
  await mkdirPrivate(projects)
  await writeFile(join(projects, 'algorithm-visualizer.json'), `${JSON.stringify({
    canonicalOrigins: ['https://example.com'],
    channels: ['bilibili'],
    displayName: 'stdio fixture',
    id: 'algorithm-visualizer',
    schemaVersion: 1,
  })}\n`, { encoding: 'utf8', mode: 0o600 })
  return home
}

async function mkdirPrivate(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true })
  await chmod(path, 0o700)
}

async function closeRuntime(runtime: MarketingOpsManagedRuntime | undefined): Promise<void> {
  try {
    await runtime?.close()
  }
  catch {
    // The test must not expose child stderr or transport details.
  }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe.runIf(process.platform !== 'win32' && stagingRoot !== undefined)(
  'managed marketing-ops real stdio handoff',
  () => {
    it('connects the installed runtime, reports capability, and prepares without a channel write', async () => {
      const home = await createPrivateHome()
      vi.stubEnv('HOME', home)
      const installerRoot = await mkdtemp(join(tmpdir(), 'content-studio-marketing-ops-install-'))
      temporaryDirectories.push(installerRoot)
      const canonicalInstallerRoot = await realpath(installerRoot)
      const manifest = await readFile(join(stagingRoot!, 'runtime-manifest.json'))
      expect(await resolveManagedMarketingOpsRuntimeAsset(
        stagingRoot!,
        sha256(manifest),
      )).not.toBeNull()
      const handoff = await installManagedMarketingOpsRuntime({
        expectedManifestSha256: sha256(manifest),
        installerRoot: canonicalInstallerRoot,
        sourceRoot: stagingRoot!,
      })
      expect(handoff).not.toBeNull()
      const bootstrap = createInstallerManagedRuntimeBootstrap({
        connector: createManagedMarketingOpsStdioConnector({ requestTimeoutMs: 10_000 }),
        manifestSha256: handoff!.manifestSha256,
        runtimeRoot: handoff!.runtimeRoot,
      })
      const runtime = await bootstrap.start()
      try {
        expect(runtime).toBeDefined()
        const status = await runtime!.statusClient.getChannelsStatus('algorithm-visualizer')
        expect(status.capabilities).toContain('content-studio-assisted-publication-v1')
        expect(status.channels).toEqual(expect.arrayContaining([
          expect.objectContaining({
            assistedPublicationReady: true,
            channel: 'bilibili',
          }),
        ]))
        const result = await runtime!.publishClient!.publishCampaign(request())
        expect(result.receipts).toEqual([])
        expect(result.handoffs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            form: 'image-text',
            packageId: 'stdio-e2e-image-text',
            status: 'awaiting-owner',
          }),
          expect.objectContaining({
            form: 'video',
            packageId: 'stdio-e2e-video-landscape',
            status: 'awaiting-owner',
            videoOrientation: 'landscape',
          }),
          expect.objectContaining({
            form: 'video',
            packageId: 'stdio-e2e-video-portrait',
            status: 'awaiting-owner',
            videoOrientation: 'portrait',
          }),
          expect.objectContaining({
            form: 'short-post',
            packageId: 'stdio-e2e-short-post',
            status: 'awaiting-owner',
          }),
        ]))
      }
      finally {
        await closeRuntime(runtime)
      }
    })

    it('runs the Content Studio MCP prepare and confirm flow for all three Bilibili forms', async () => {
      const home = await createPrivateHome()
      vi.stubEnv('HOME', home)
      const installerRoot = await mkdtemp(join(tmpdir(), 'content-studio-marketing-ops-install-'))
      temporaryDirectories.push(installerRoot)
      const canonicalInstallerRoot = await realpath(installerRoot)
      const manifest = await readFile(join(stagingRoot!, 'runtime-manifest.json'))
      const manifestSha256 = sha256(manifest)
      const handoff = await installManagedMarketingOpsRuntime({
        expectedManifestSha256: manifestSha256,
        installerRoot: canonicalInstallerRoot,
        sourceRoot: stagingRoot!,
      })
      expect(handoff).not.toBeNull()
      const bootstrap = createInstallerManagedRuntimeBootstrap({
        connector: createManagedMarketingOpsStdioConnector({ requestTimeoutMs: 10_000 }),
        manifestSha256: handoff!.manifestSha256,
        runtimeRoot: handoff!.runtimeRoot,
      })
      const runtime = await bootstrap.start()
      try {
        expect(runtime).toBeDefined()
        const fixture = createMcpFixture()
        const server = createContentStudioMcpServer({
          marketingOpsPublish: runtime!.publishClient,
          marketingOpsStatus: runtime!.statusClient,
          projectId: 'algorithm-visualizer',
          service: fixture.service,
        })
        const publicUrls: Record<'image-text' | 'short-post' | 'video', string> = {
          'image-text': 'https://www.bilibili.com/opus/123456',
          'short-post': 'https://t.bilibili.com/123457',
          'video': 'https://www.bilibili.com/video/BV1xx411c7mD',
        }
        const renderers: Record<'image-text' | 'short-post' | 'video', Record<string, unknown>> = {
          'image-text': {
            canonicalUrl: 'https://example.com/docs',
            format: 'manual-package',
            links: ['https://example.com/docs'],
            media: ['image'],
            utmMedium: 'social',
          },
          'short-post': {
            canonicalUrl: 'https://example.com/docs',
            format: 'manual-package',
            links: ['https://example.com/docs'],
            media: [],
            utmMedium: 'social',
          },
          'video': {
            canonicalUrl: 'https://example.com/docs',
            format: 'manual-package',
            links: ['https://example.com/docs'],
            media: ['video'],
            utmMedium: 'social',
          },
        }
        const handoffIds: Partial<Record<'image-text' | 'short-post' | 'video', string>> = {}
        for (const form of ['image-text', 'video', 'short-post'] as const) {
          const response = await server.handleMessage({
            id: `prepare-${form}`,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              arguments: {
                authorization: {
                  authorizedAt: new Date().toISOString(),
                  source: 'owner-prompt',
                },
                execution: { mode: 'assisted-prepare' },
                projectId: 'algorithm-visualizer',
                publicationId: fixture.publicationIds[form],
                renderer: renderers[form],
              },
              name: 'publish_marketing_ops_package',
            },
          })
          const structured = (response?.result as { structuredContent?: Record<string, unknown> })
            .structuredContent
          expect(structured).toMatchObject({
            mode: 'assisted-prepare',
            package: { contentFormat: form },
            handoff: { status: 'pending' },
          })
          handoffIds[form] = (structured?.handoff as { handoffId: string }).handoffId
        }
        for (const form of ['image-text', 'video', 'short-post'] as const) {
          const handoffId = handoffIds[form]
          expect(handoffId).toEqual(expect.any(String))
          if (handoffId === undefined)
            throw new Error(`Missing ${form} handoff`)
          const confirmation = {
            authorization: {
              authorizedAt: new Date().toISOString(),
              source: 'owner-prompt',
            },
            execution: {
              mode: 'assisted-confirm',
              publicUrl: publicUrls[form],
            },
            handoffId,
            projectId: 'algorithm-visualizer',
          }
          const first = await server.handleMessage({
            id: `confirm-${form}`,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              arguments: confirmation,
              name: 'publish_marketing_ops_package',
            },
          })
          expect(first?.result).toMatchObject({
            isError: false,
            structuredContent: {
              mode: 'assisted-confirm',
              receipts: [expect.objectContaining({
                publicUrl: publicUrls[form],
                status: 'published',
              })],
            },
          })
          const retry = await server.handleMessage({
            id: `confirm-retry-${form}`,
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
              arguments: confirmation,
              name: 'publish_marketing_ops_package',
            },
          })
          expect(retry?.result).toMatchObject({
            isError: false,
            structuredContent: {
              mode: 'assisted-confirm',
              receipts: [expect.objectContaining({
                publicUrl: publicUrls[form],
                status: 'published',
              })],
            },
          })
        }
        expect(fixture.service.getProjectView('algorithm-visualizer').publicationReceipts)
          .toHaveLength(3)
        expect(fixture.service.getProjectView('algorithm-visualizer').ownerHandoffs)
          .toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'completed' }),
          ]))
      }
      finally {
        await closeRuntime(runtime)
      }
    })
  },
)
