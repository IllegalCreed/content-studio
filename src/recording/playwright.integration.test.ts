import type { Buffer } from 'node:buffer'
import type { VideoPlan } from '../types'
import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { recordWithPlaywright } from './playwright'

const browserIsInstalled = await access(chromium.executablePath())
  .then(() => true)
  .catch(() => false)
const ffmpegIsAvailable = ((): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
    })
    return true
  }
  catch {
    return false
  }
})()
const execFile = promisify(execFileCallback)

async function probeVideoDurationSeconds(filePath: string): Promise<number> {
  let stderr = ''
  try {
    const result = await execFile('ffmpeg', ['-i', filePath, '-f', 'null', '-'], {
      maxBuffer: 4 * 1024 * 1024,
    })
    stderr = String(result.stderr)
  }
  catch (error: unknown) {
    stderr = error instanceof Error && 'stderr' in error
      ? String((error as { stderr: string | Buffer }).stderr)
      : ''
  }
  const match = /Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/u.exec(stderr)
  if (match === null)
    throw new Error('Could not probe video duration')
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

async function sampleVideoColors(
  filePath: string,
  outputDirectory: string,
): Promise<Array<{ blue: number, green: number, red: number }>> {
  const samplePath = join(outputDirectory, 'sampled-video.rgb')
  await execFile(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      filePath,
      '-vf',
      'fps=4,scale=1:1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      samplePath,
    ],
    {
      maxBuffer: 4 * 1024 * 1024,
    },
  )
  const samples = await readFile(samplePath)
  const colors: Array<{ blue: number, green: number, red: number }> = []
  for (let index = 0; index + 2 < samples.length; index += 3) {
    colors.push({
      blue: samples[index + 2]!,
      green: samples[index + 1]!,
      red: samples[index]!,
    })
  }
  return colors
}

const temporaryDirectories: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(server =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined)
            resolve()
          else
            reject(error)
        })
      }),
    ),
  )
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe.skipIf(!browserIsInstalled)('playwright recorder integration', () => {
  it('records a semantic local flow with previews, clips, events, and a receipt', async () => {
    const server = createServer((request, response) => {
      if (request.url !== '/demo') {
        response.writeHead(404)
        response.end()
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
        <html lang="en">
          <body style="background: rgb(15, 40, 80); color: rgb(230, 240, 255); margin: 0; min-height: 100vh">
            <button type="button">Start</button>
            <label>Values <input /></label>
            <output data-testid="status">Ready</output>
            <script>
              document.querySelector('button').addEventListener('click', () => {
                document.querySelector('[data-testid="status"]').textContent = 'Running'
                console.warn('warning details are not persisted')
                console.error('error details are not persisted')
                setTimeout(() => {
                  throw new Error('page details are not persisted')
                }, 0)
              })
            </script>
          </body>
        </html>`)
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-playwright-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    const outputDirectory = join(temporaryDirectory, 'recording-job')
    const events: string[] = []
    const plan: VideoPlan = {
      campaignId: 'local-demo',
      durationMs: 550,
      format: 'landscape',
      scenes: [
        {
          actions: [
            {
              durationMs: 500,
              kind: 'wait-for',
              locator: {
                by: 'role',
                name: 'Start',
                value: 'button',
              },
              startMs: 0,
            },
            {
              durationMs: 10,
              kind: 'fill',
              locator: {
                by: 'label',
                value: 'Values',
              },
              startMs: 500,
              value: '5, 3, 1',
            },
            {
              durationMs: 10,
              key: 'Tab',
              kind: 'press',
              startMs: 510,
            },
            {
              durationMs: 10,
              kind: 'click',
              locator: {
                by: 'role',
                name: 'Start',
                value: 'button',
              },
              startMs: 520,
            },
            {
              durationMs: 10,
              kind: 'wait',
              startMs: 530,
            },
            {
              durationMs: 10,
              kind: 'capture',
              label: 'running',
              startMs: 540,
            },
          ],
          id: 'local-demo',
          startMs: 0,
          startPath: '/demo',
          title: 'Local demo',
        },
      ],
      recordingConfig: {
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'en',
        outputSize: { height: 360, width: 640 },
        viewport: { height: 360, width: 640 },
      },
    }

    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'local-recording-job',
        outputDirectory,
        plan,
        projectId: 'local-project',
      },
      {
        actionTimeoutMs: 2000,
        emit: (event) => {
          events.push(event.kind)
        },
      },
    )

    expect(result.receipt).toMatchObject({
      completedActions: 6,
      logs: {
        consoleErrors: 1,
        consoleWarnings: 1,
        entries: [
          'console:warning',
          'console:error',
          'page:error',
        ],
        pageErrors: 1,
      },
      outcome: 'succeeded',
      totalActions: 6,
    })
    expect(result.receipt.artifacts.map(artifact => artifact.kind)).toEqual([
      'preview-frame',
      'video-clip',
    ])
    expect(events).toContain('preview-ready')
    expect(events.at(-1)).toBe('attempt-completed')
    await expect(
      readFile(
        join(outputDirectory, 'attempt-1', 'receipt.json'),
        'utf8',
      ),
    ).resolves.toContain('"outcome": "succeeded"')
    if (ffmpegIsAvailable) {
      const videoClip = result.receipt.artifacts.find(
        artifact => artifact.kind === 'video-clip',
      )
      expect(videoClip).toBeDefined()
      const sampledColors = await sampleVideoColors(
        join(result.receipt.artifactDirectory, videoClip!.relativePath),
        result.receipt.artifactDirectory,
      )
      expect(sampledColors.length).toBeGreaterThan(0)
      expect(sampledColors[0]!.red).toBeLessThan(180)
      expect(sampledColors[0]!.blue).toBeGreaterThan(60)
    }
  }, 15_000)

  it.skipIf(!ffmpegIsAvailable)('starts a clip after a semantic page-ready signal', async () => {
    const server = createServer((request, response) => {
      if (request.url !== '/delayed') {
        response.writeHead(404)
        response.end()
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
        <html lang="en">
          <body style="background: rgb(255, 255, 255); margin: 0; min-height: 100vh">
            <script>
              setTimeout(() => {
                document.body.style.background = 'rgb(15, 40, 80)'
                document.body.innerHTML = '<button type="button">Ready</button>'
              }, 300)
            </script>
          </body>
        </html>`)
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-playwright-ready-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'semantic-page-ready-job',
        outputDirectory: join(temporaryDirectory, 'recording-job'),
        plan: {
          campaignId: 'local-demo',
          durationMs: 500,
          format: 'landscape',
          scenes: [
            {
              actions: [
                {
                  durationMs: 400,
                  kind: 'wait-for',
                  locator: {
                    by: 'role',
                    name: 'Ready',
                    value: 'button',
                  },
                  startMs: 0,
                },
              ],
              id: 'delayed-ready',
              startMs: 0,
              startPath: '/delayed',
              title: 'Delayed ready',
            },
          ],
          recordingConfig: {
            colorScheme: 'light',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 360, width: 640 },
            viewport: { height: 360, width: 640 },
          },
        },
        projectId: 'local-project',
      },
      { actionTimeoutMs: 2000 },
    )

    expect(result.receipt.outcome).toBe('succeeded')
    const videoClip = result.receipt.artifacts.find(
      artifact => artifact.kind === 'video-clip',
    )
    expect(videoClip).toBeDefined()
    const sampledColors = await sampleVideoColors(
      join(result.receipt.artifactDirectory, videoClip!.relativePath),
      result.receipt.artifactDirectory,
    )
    expect(sampledColors.length).toBeGreaterThanOrEqual(2)
    for (const color of sampledColors.slice(0, 2)) {
      expect(color.red).toBeLessThan(180)
      expect(color.blue).toBeGreaterThan(60)
    }
  }, 15_000)

  it.skipIf(!ffmpegIsAvailable)('starts a clip after the first state-changing action', async () => {
    const server = createServer((request, response) => {
      if (request.url !== '/dismiss') {
        response.writeHead(404)
        response.end()
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(`<!doctype html>
        <html lang="en">
          <body style="background: rgb(255, 255, 255); margin: 0; min-height: 100vh">
            <button disabled type="button">Dismiss</button>
            <script>
              const button = document.querySelector('button')
              setTimeout(() => { button.disabled = false }, 250)
              button.addEventListener('click', () => {
                requestAnimationFrame(() => {
                  document.body.style.background = 'rgb(15, 40, 80)'
                })
              })
            </script>
          </body>
        </html>`)
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-playwright-action-ready-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'state-changing-action-job',
        outputDirectory: join(temporaryDirectory, 'recording-job'),
        plan: {
          campaignId: 'local-demo',
          durationMs: 1500,
          format: 'landscape',
          scenes: [
            {
              actions: [
                {
                  durationMs: 1000,
                  kind: 'wait-for',
                  locator: {
                    by: 'role',
                    name: 'Dismiss',
                    value: 'button',
                  },
                  startMs: 0,
                },
                {
                  durationMs: 500,
                  kind: 'click',
                  locator: {
                    by: 'role',
                    name: 'Dismiss',
                    value: 'button',
                  },
                  startMs: 1000,
                },
              ],
              id: 'dismiss-banner',
              startMs: 0,
              startPath: '/dismiss',
              title: 'Dismiss banner',
            },
          ],
          recordingConfig: {
            colorScheme: 'light',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 360, width: 640 },
            viewport: { height: 360, width: 640 },
          },
        },
        projectId: 'local-project',
      },
      { actionTimeoutMs: 2000 },
    )

    expect(result.receipt.outcome).toBe('succeeded')
    const videoClip = result.receipt.artifacts.find(
      artifact => artifact.kind === 'video-clip',
    )
    expect(videoClip).toBeDefined()
    const sampledColors = await sampleVideoColors(
      join(result.receipt.artifactDirectory, videoClip!.relativePath),
      result.receipt.artifactDirectory,
    )
    expect(sampledColors.length).toBeGreaterThan(0)
    expect(sampledColors[0]!.red).toBeLessThan(180)
    expect(sampledColors[0]!.blue).toBeGreaterThan(60)
  }, 15_000)

  it('returns a retryable locator failure when a wait-for target never appears', async () => {
    const server = createServer((request, response) => {
      if (request.url !== '/missing') {
        response.writeHead(404)
        response.end()
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><body><p>Loading</p></body></html>')
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-playwright-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'local-missing-locator-job',
        maxAttempts: 1,
        outputDirectory: join(temporaryDirectory, 'recording-job'),
        plan: {
          campaignId: 'local-demo',
          durationMs: 100,
          format: 'landscape',
          scenes: [
            {
              actions: [
                {
                  durationMs: 100,
                  kind: 'wait-for',
                  locator: {
                    by: 'role',
                    name: 'Start',
                    value: 'button',
                  },
                  startMs: 0,
                },
              ],
              id: 'missing-locator',
              startMs: 0,
              startPath: '/missing',
              title: 'Missing locator',
            },
          ],
          recordingConfig: {
            colorScheme: 'dark',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 360, width: 640 },
            viewport: { height: 360, width: 640 },
          },
        },
        projectId: 'local-project',
      },
      {
        actionTimeoutMs: 2000,
      },
    )

    expect(result.receipt).toMatchObject({
      completedActions: 0,
      failure: {
        code: 'locator-not-found',
        retryable: true,
      },
      outcome: 'failed',
    })
  }, 15_000)

  it.skipIf(!ffmpegIsAvailable)('pauses at an authentication page, waits for owner confirmation, and continues the same session', async () => {
    let sessionReady = false
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (request.method === 'POST' && pathname === '/owner/session') {
        sessionReady = true
        response.writeHead(204)
        response.end()
        return
      }
      if (request.method === 'GET' && pathname === '/session') {
        if (sessionReady) {
          response.writeHead(200)
          response.end('ready')
        }
        else {
          response.writeHead(404)
          response.end()
        }
        return
      }
      if (pathname === '/login') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(`<!doctype html>
          <html lang="en">
            <body style="background: rgb(255, 0, 0); margin: 0; min-height: 100vh">
              <form data-testid="owner-login">
                <input type="password" placeholder="mock password" />
              </form>
              <script>
                const poll = async () => {
                  const response = await fetch('/session')
                  if (response.ok) location.replace('/app')
                  else setTimeout(poll, 50)
                }
                poll()
              </script>
            </body>
          </html>`)
        return
      }
      if (pathname === '/app') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(`<!doctype html>
          <html lang="en">
            <body style="background: rgb(0, 255, 0); margin: 0; min-height: 100vh">
              <output data-testid="authenticated">Ready</output>
            </body>
          </html>`)
        return
      }
      if (pathname === '/') {
        response.writeHead(302, {
          location: '/login?oauth_code=never-persist-this#callback-token',
        })
        response.end()
        return
      }
      response.writeHead(404)
      response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-owner-takeover-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    const requestedUrls: string[] = []
    const ownerTakeover = {
      request: async ({ pageUrl }: { pageUrl: string }) => {
        requestedUrls.push(pageUrl)
        await fetch(`http://127.0.0.1:${address.port}/owner/session`, {
          method: 'POST',
        })
        await wait(2000)
      },
    }

    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'owner-takeover-job',
        outputDirectory: join(temporaryDirectory, 'recording-job'),
        plan: {
          campaignId: 'owner-takeover-demo',
          durationMs: 3000,
          format: 'landscape',
          scenes: [
            {
              actions: [
                {
                  durationMs: 3000,
                  kind: 'wait-for',
                  locator: {
                    by: 'test-id',
                    value: 'authenticated',
                  },
                  startMs: 0,
                },
                {
                  durationMs: 800,
                  kind: 'wait',
                  startMs: 3000,
                },
                {
                  durationMs: 10,
                  kind: 'capture',
                  label: 'authenticated',
                  startMs: 3800,
                },
              ],
              id: 'owner-takeover',
              startMs: 0,
              startPath: '/',
              title: 'Owner takeover',
            },
          ],
          recordingConfig: {
            colorScheme: 'dark',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 360, width: 640 },
            viewport: { height: 360, width: 640 },
          },
        },
        projectId: 'local-project',
        recordingContext: {
          captureMode: 'deterministic',
          humanIntervention: true,
          ownerTakeover: true,
          planVersion: 1,
          repeatability: 'conditional',
          sourceAccess: 'source-owned',
        },
      },
      {
        actionTimeoutMs: 2000,
        ownerTakeover,
      },
    )

    expect(requestedUrls).toEqual([
      `http://127.0.0.1:${address.port}/login`,
    ])
    expect(result.receipt.failure).toBeUndefined()
    expect(result.receipt).toMatchObject({
      completedActions: 3,
      outcome: 'succeeded',
    })
    expect(result.receipt.ownerTakeover).toMatchObject({
      confirmedAt: expect.any(String),
      requestedAt: expect.any(String),
    })
    expect(result.receipt.logs.entries).toContain('owner-takeover:requested')
    expect(result.receipt.logs.entries).toContain('owner-takeover:confirmed')
    expect(
      result.receipt.artifacts.some(artifact => artifact.kind === 'preview-frame'),
    ).toBe(true)
    const videoClips = result.receipt.artifacts.filter(
      artifact => artifact.kind === 'video-clip',
    )
    expect(videoClips).toHaveLength(1)
    const videoPath = join(
      result.receipt.artifactDirectory,
      videoClips[0]!.relativePath,
    )
    const durationSeconds = await probeVideoDurationSeconds(videoPath)
    expect(durationSeconds).toBeGreaterThanOrEqual(0.6)
    expect(durationSeconds).toBeLessThan(3.2)
    const sampledColors = await sampleVideoColors(
      videoPath,
      result.receipt.artifactDirectory,
    )
    expect(sampledColors.length).toBeGreaterThanOrEqual(2)
    for (const color of sampledColors) {
      expect(color.green).toBeGreaterThan(180)
      expect(color.red).toBeLessThan(80)
      expect(color.blue).toBeLessThan(80)
    }
  }, 15_000)

  it.skipIf(!ffmpegIsAvailable)('fails closed when the owner confirms while still on an authentication page', async () => {
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (pathname === '/login') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(`<!doctype html>
          <html lang="en">
            <body>
              <form data-testid="owner-login">
                <input type="password" placeholder="mock password" />
              </form>
            </body>
          </html>`)
        return
      }
      if (pathname === '/') {
        response.writeHead(302, {
          location: '/login',
        })
        response.end()
        return
      }
      response.writeHead(404)
      response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('Test server did not provide a TCP address')

    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'content-studio-owner-takeover-failed-'),
    )
    temporaryDirectories.push(temporaryDirectory)
    let takeoverRequests = 0
    const ownerTakeover = {
      request: async () => {
        takeoverRequests += 1
      },
    }

    const result = await recordWithPlaywright(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        jobId: 'owner-takeover-failed-job',
        outputDirectory: join(temporaryDirectory, 'recording-job'),
        plan: {
          campaignId: 'owner-takeover-failed-demo',
          durationMs: 10,
          format: 'landscape',
          scenes: [
            {
              actions: [
                {
                  durationMs: 10,
                  kind: 'wait',
                  startMs: 0,
                },
              ],
              id: 'owner-takeover-failed',
              startMs: 0,
              startPath: '/',
              title: 'Owner takeover failed',
            },
          ],
          recordingConfig: {
            colorScheme: 'dark',
            deviceScaleFactor: 1,
            locale: 'en',
            outputSize: { height: 360, width: 640 },
            viewport: { height: 360, width: 640 },
          },
        },
        projectId: 'local-project',
        recordingContext: {
          captureMode: 'deterministic',
          humanIntervention: true,
          ownerTakeover: true,
          planVersion: 1,
          repeatability: 'conditional',
          sourceAccess: 'source-owned',
        },
      },
      {
        actionTimeoutMs: 1000,
        ownerTakeover,
      },
    )

    expect(takeoverRequests).toBe(1)
    expect(result.receipt).toMatchObject({
      completedActions: 0,
      failure: {
        code: 'authentication-page',
        retryable: false,
      },
      outcome: 'failed',
    })
  }, 15_000)
})
