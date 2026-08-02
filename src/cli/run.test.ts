import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runCli } from './run'

const project = {
  schemaVersion: 1,
  projectId: 'algorithm-visualizer',
  name: 'Algorithm Visualizer',
  canonicalUrl: 'https://algo.illegalscreed.cn/',
  repositoryUrl: 'https://github.com/IllegalCreed/algorithms-visualization',
  locales: ['zh-CN', 'en'],
  tagline: {
    'en': 'Learn algorithms through interactive animation.',
    'zh-CN': '通过交互动画学习算法。',
  },
  facts: [],
  captureFlows: [],
}

const campaign = {
  schemaVersion: 1,
  campaignId: 'quick-sort-launch',
  topic: {
    'en': 'Understand quick sort partitioning',
    'zh-CN': '看懂快速排序的分区过程',
  },
  goal: 'education',
  targetUrl: 'https://algo.illegalscreed.cn/quick-sort/',
  highlights: [],
  tags: ['algorithms'],
  channels: [
    {
      id: 'github',
      locale: 'en',
    },
  ],
}

describe('content-studio CLI', () => {
  it('validates and generates a bundle through a fixed argument grammar', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const outputPath = join(temporaryDirectory, 'output')
    const messages: string[] = []

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await writeFile(campaignPath, JSON.stringify(campaign), 'utf8')

      await expect(
        runCli(
          [
            'generate',
            '--project',
            projectPath,
            '--campaign',
            campaignPath,
            '--out',
            outputPath,
          ],
          {
            cwd: temporaryDirectory,
            write: message => messages.push(message),
          },
        ),
      ).resolves.toBe(0)
      await expect(access(join(outputPath, 'bundle.json'))).resolves.toBeUndefined()
      expect(messages.at(-1)).toContain('1 content package')
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('rejects unknown flags without reading files', async () => {
    await expect(
      runCli(['generate', '--project', 'project.json', '--unsafe', 'value']),
    ).rejects.toThrow(/Unknown option/)
  })

  it('supports help and fails closed for unknown commands and incomplete options', async () => {
    const messages: string[] = []
    await expect(
      runCli(['help'], {
        cwd: process.cwd(),
        write: message => messages.push(message),
      }),
    ).resolves.toBe(0)
    expect(messages[0]).toContain('content-studio generate')

    await expect(runCli(['publish'])).rejects.toThrow(/Unknown command/)
    await expect(runCli(['generate', 'project.json'])).rejects.toThrow(/Expected an option/)
    await expect(runCli(['generate', '--project'])).rejects.toThrow(/Missing value/)
    await expect(
      runCli([
        'generate',
        '--project',
        'one.json',
        '--project',
        'two.json',
      ]),
    ).rejects.toThrow(/Duplicate option/)
    await expect(
      runCli([
        'generate',
        '--project',
        'project.json',
      ]),
    ).rejects.toThrow(/Missing required option: --campaign/)
  })

  it('validates inputs without writing a bundle', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const messages: string[] = []

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await writeFile(campaignPath, JSON.stringify(campaign), 'utf8')
      await expect(
        runCli(
          [
            'validate',
            '--project',
            projectPath,
            '--campaign',
            campaignPath,
          ],
          {
            cwd: temporaryDirectory,
            write: message => messages.push(message),
          },
        ),
      ).resolves.toBe(0)
      expect(messages[0]).toContain('Validated algorithm-visualizer')
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('starts the local runtime on the dedicated application-service port', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const messages: string[] = []
    const controller = new AbortController()
    controller.abort()

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await expect(
        runCli(
          [
            'serve',
            '--project',
            projectPath,
            '--port',
            '0',
            '--db',
            join(temporaryDirectory, 'state.sqlite'),
          ],
          {
            cwd: temporaryDirectory,
            signal: controller.signal,
            write: message => messages.push(message),
          },
        ),
      ).resolves.toBe(130)
      expect(messages[0]).toMatch(/Content Studio runtime listening at http:\/\/127\.0\.0\.1:\d+/)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('starts the local MCP stdio runtime with an explicit project scope', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const output: string[] = []
    const controller = new AbortController()
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk))
        callback()
      },
    })

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await writeFile(campaignPath, JSON.stringify(campaign), 'utf8')
      await expect(
        runCli(
          [
            'mcp',
            '--stdio',
            '--project',
            projectPath,
            '--campaign',
            campaignPath,
            '--db',
            join(temporaryDirectory, 'state.sqlite'),
          ],
          {
            cwd: temporaryDirectory,
            input: Readable.from([
              `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' })}\n`,
            ]),
            output: outputStream,
            signal: controller.signal,
            write: () => undefined,
          },
        ),
      ).resolves.toBe(0)
      expect(JSON.parse(output[0]!)).toMatchObject({
        result: {
          projectId: 'algorithm-visualizer',
          protocolVersion: '2026-07-28',
        },
      })
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('records a compiled video plan through the fixed CLI grammar', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const outputPath = join(temporaryDirectory, 'recording')
    const messages: string[] = []
    const recordingInputs: unknown[] = []

    try {
      await writeFile(
        projectPath,
        JSON.stringify({
          ...project,
          captureFlows: [
            {
              id: 'demo',
              startPath: '/demo',
              steps: [
                {
                  kind: 'capture',
                  label: 'demo',
                  durationMs: 100,
                },
              ],
              title: {
                'en': 'Demo',
                'zh-CN': '演示',
              },
            },
          ],
        }),
        'utf8',
      )
      await writeFile(
        campaignPath,
        JSON.stringify({
          ...campaign,
          video: {
            flowIds: ['demo'],
            format: 'landscape',
          },
        }),
        'utf8',
      )

      await expect(
        runCli(
          [
            'record',
            '--project',
            projectPath,
            '--campaign',
            campaignPath,
            '--base-url',
            'http://127.0.0.1:11000',
            '--out',
            outputPath,
            '--attempts',
            '2',
          ],
          {
            cwd: temporaryDirectory,
            write: message => messages.push(message),
          },
          {
            record: async (input) => {
              recordingInputs.push(input)
              return {
                attempts: [],
                receipt: {
                  artifactDirectory: join(outputPath, 'attempt-1'),
                  artifacts: [],
                  attempt: 1,
                  campaignId: 'quick-sort-launch',
                  completedActions: 1,
                  completedScenes: 1,
                  jobId: 'quick-sort-launch-recording',
                  logs: {
                    consoleErrors: 0,
                    consoleWarnings: 0,
                    entries: [],
                    pageErrors: 0,
                  },
                  outcome: 'succeeded',
                  planSha256: 'plan-sha',
                  projectId: 'algorithm-visualizer',
                  receiptVersion: 1,
                  totalActions: 1,
                  totalScenes: 1,
                },
              }
            },
          },
        ),
      ).resolves.toBe(0)

      expect(recordingInputs[0]).toMatchObject({
        baseUrl: 'http://127.0.0.1:11000',
        jobId: 'quick-sort-launch-recording',
        maxAttempts: 2,
        outputDirectory: outputPath,
        projectId: 'algorithm-visualizer',
      })
      expect(messages.at(-1)).toContain('Recorded 1 action')
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('fails closed instead of sending web-assisted projects to Playwright', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const recordingInputs: unknown[] = []

    try {
      await writeFile(projectPath, JSON.stringify({
        ...project,
        captureMode: 'assisted',
        sourceAccess: 'web-assisted',
        captureFlows: [{
          id: 'demo',
          startPath: '/demo',
          steps: [{ kind: 'capture', label: 'demo' }],
          title: {
            'en': 'Demo',
            'zh-CN': '演示',
          },
        }],
      }), 'utf8')
      await writeFile(campaignPath, JSON.stringify({
        ...campaign,
        video: {
          flowIds: ['demo'],
          format: 'landscape',
        },
      }), 'utf8')

      await expect(runCli(
        [
          'record',
          '--project',
          projectPath,
          '--campaign',
          campaignPath,
          '--base-url',
          'https://algo.illegalscreed.cn',
          '--out',
          join(temporaryDirectory, 'recording'),
        ],
        {
          cwd: temporaryDirectory,
          write: () => undefined,
        },
        {
          record: async (input) => {
            recordingInputs.push(input)
            throw new Error('recorder must not run')
          },
        },
      )).rejects.toThrow(/source-owned deterministic/i)
      expect(recordingInputs).toHaveLength(0)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })
})
