import type { VideoPlan } from '../types'
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it } from 'vitest'
import { recordWithPlaywright } from './playwright'

const browserIsInstalled = await access(chromium.executablePath())
  .then(() => true)
  .catch(() => false)

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
          <body>
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
})
