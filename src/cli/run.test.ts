import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('drafts a web-assisted project manifest through project init', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    try {
      const outputPath = join(temporaryDirectory, 'project.json')
      await runCli(
        [
          'project',
          'init',
          '--name',
          'My Landing',
          '--url',
          'https://landing.example.com/',
          '--out',
          outputPath,
        ],
        {
          cwd: temporaryDirectory,
          write: () => undefined,
        },
      )
      const manifest = JSON.parse(
        await readFile(outputPath, 'utf8'),
      ) as Record<string, unknown>
      expect(manifest.projectId).toBe('my-landing')
      expect(manifest.sourceAccess).toBe('web-assisted')
      expect(manifest.captureMode).toBe('assisted')
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('drafts a source-owned project manifest through project import', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    try {
      const sourceDirectory = join(temporaryDirectory, 'repo')
      await mkdir(sourceDirectory, { recursive: true })
      await writeFile(
        join(sourceDirectory, 'package.json'),
        JSON.stringify({
          name: 'demo-project',
          description: 'Demo project',
          homepage: 'https://demo.example.com/',
          repository: 'https://github.com/acme/demo-project.git',
        }),
        'utf8',
      )
      await writeFile(
        join(sourceDirectory, 'README.md'),
        '# Demo\n- [演示指南](/docs/guide)\n',
        'utf8',
      )
      await mkdir(join(sourceDirectory, 'src'), { recursive: true })
      await writeFile(
        join(sourceDirectory, 'src', 'App.vue'),
        '<button data-testid="animation-play">Play</button>\n',
        'utf8',
      )
      const outputPath = join(temporaryDirectory, 'project.json')
      await runCli(
        [
          'project',
          'import',
          '--source',
          sourceDirectory,
          '--out',
          outputPath,
        ],
        {
          cwd: temporaryDirectory,
          write: () => undefined,
        },
      )
      const manifest = JSON.parse(
        await readFile(outputPath, 'utf8'),
      ) as Record<string, unknown>
      expect(manifest.projectId).toBe('demo-project')
      expect(manifest.sourceAccess).toBe('source-owned')
      expect(manifest.captureMode).toBe('deterministic')
      expect(manifest.repositoryUrl).toBe('https://github.com/acme/demo-project.git')
      expect(manifest.captureFlows).toMatchObject([
        { id: 'docs-guide', startPath: '/docs/guide' },
      ])
      expect(manifest.captureTargets).toMatchObject([
        { id: 'animation-play', locator: { by: 'test-id', value: 'animation-play' } },
      ])
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('requires a source directory when importing a project', async () => {
    await expect(runCli(
      ['project', 'import', '--out', 'project.json'],
      {
        cwd: '/tmp',
        write: () => undefined,
      },
    )).rejects.toThrow(/Missing required option: --source/)
  })

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

  it('runs a local doctor without creating project or database directories', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-doctor-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const messages: string[] = []

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await expect(runCli(
        [
          'doctor',
          '--project',
          projectPath,
          '--db',
          join(temporaryDirectory, '.content-studio', 'state.sqlite'),
        ],
        {
          cwd: temporaryDirectory,
          write: message => messages.push(message),
        },
      )).resolves.toBe(0)

      const report = messages.join('\n')
      expect(report).toContain('Content Studio doctor')
      expect(report).toContain('项目模式')
      expect(report).toContain('SQLite 目录')
      expect(report).toContain('不会自动读取凭据')
      await expect(access(join(temporaryDirectory, '.content-studio'))).rejects.toThrow()
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('reports assisted projects and unsafe local directories without modifying them', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-doctor-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const assistedProjectPath = join(temporaryDirectory, 'assisted-project.json')
    const messages: string[] = []

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await writeFile(assistedProjectPath, JSON.stringify({
        ...project,
        captureMode: 'assisted',
        sourceAccess: 'web-assisted',
      }), 'utf8')
      await mkdir(join(temporaryDirectory, '.content-studio'), { recursive: true })

      await expect(runCli(
        [
          'doctor',
          '--project',
          projectPath,
          '--db',
          join(temporaryDirectory, '.content-studio', 'state.sqlite'),
        ],
        {
          cwd: temporaryDirectory,
          write: message => messages.push(message),
        },
      )).resolves.toBe(0)
      expect(messages.join('\n')).toContain('[✓] 产物目录')

      messages.length = 0
      await expect(runCli(
        [
          'doctor',
          '--project',
          assistedProjectPath,
          '--db',
          join(temporaryDirectory, 'missing', 'nested', 'state.sqlite'),
        ],
        {
          cwd: temporaryDirectory,
          write: message => messages.push(message),
        },
      )).resolves.toBe(1)
      expect(messages.join('\n')).toContain('辅助模式')
      expect(messages.join('\n')).toContain('父目录不可写')

      messages.length = 0
      await expect(runCli(
        [
          'doctor',
          '--project',
          projectPath,
          '--db',
          '/dev/null/content-studio/state.sqlite',
        ],
        {
          cwd: temporaryDirectory,
          write: message => messages.push(message),
        },
      )).resolves.toBe(1)
      expect(messages.join('\n')).toContain('不可写')
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
          supportedVersions: ['2026-07-28'],
          _meta: {
            'io.content-studio/project': {
              projectId: 'algorithm-visualizer',
            },
          },
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

  it('binds the bundled MCP runtime through CONTENT_STUDIO_PROJECT', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const output: string[] = []
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk))
        callback()
      },
    })

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await expect(runCli(
        ['mcp', '--stdio'],
        {
          cwd: temporaryDirectory,
          env: { CONTENT_STUDIO_PROJECT: projectPath },
          input: Readable.from([
            `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' })}\n`,
          ]),
          output: outputStream,
          write: () => undefined,
        },
      )).resolves.toBe(0)
      expect(JSON.parse(output[0]!)).toMatchObject({
        result: {
          _meta: {
            'io.content-studio/project': {
              projectId: 'algorithm-visualizer',
            },
          },
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

  it('binds plugin campaign and state paths through explicit MCP environment variables', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const databasePath = join(temporaryDirectory, 'plugin-state.sqlite')
    const output: string[] = []
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk))
        callback()
      },
    })

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await writeFile(campaignPath, JSON.stringify(campaign), 'utf8')
      await expect(runCli(
        ['mcp', '--stdio'],
        {
          cwd: temporaryDirectory,
          env: {
            CONTENT_STUDIO_CAMPAIGN: campaignPath,
            CONTENT_STUDIO_DB: databasePath,
            CONTENT_STUDIO_PROJECT: projectPath,
          },
          input: Readable.from([
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                arguments: { projectId: 'algorithm-visualizer' },
                name: 'get_project_view',
              },
            })}\n`,
          ]),
          output: outputStream,
          write: () => undefined,
        },
      )).resolves.toBe(0)
      expect(JSON.parse(output[0]!).result.structuredContent)
        .toMatchObject({
          projectChannelBindings: [
            {
              channel: 'github',
              enabled: true,
              projectId: 'algorithm-visualizer',
            },
          ],
        })
      await expect(access(databasePath)).resolves.toBeUndefined()
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('starts the local MCP Streamable HTTP runtime on the dedicated MCP port', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const messages: string[] = []
    const controller = new AbortController()
    controller.abort()

    try {
      await writeFile(projectPath, JSON.stringify(project), 'utf8')
      await expect(runCli(
        [
          'mcp',
          '--http',
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
      )).resolves.toBe(130)
      expect(messages[0]).toMatch(/Content Studio MCP listening at http:\/\/127\.0\.0\.1:\d+\/mcp/)
    }
    finally {
      await rm(temporaryDirectory, {
        force: true,
        recursive: true,
      })
    }
  })

  it('runs a queued video task through the MCP stdio worker', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'content-studio-cli-'))
    const projectPath = join(temporaryDirectory, 'project.json')
    const campaignPath = join(temporaryDirectory, 'campaign.json')
    const output: string[] = []
    const videoProject = {
      ...project,
      canonicalUrl: 'https://algo.illegalscreed.cn/',
      captureFlows: [{
        id: 'quick-sort',
        startPath: '/quick-sort',
        steps: [{ durationMs: 10, kind: 'capture', label: 'algorithm' }],
        title: { 'en': 'Quick sort', 'zh-CN': '快速排序' },
      }],
    }
    const videoCampaign = {
      ...campaign,
      campaignId: 'mcp-cli-video',
      channels: [{ id: 'youtube', locale: 'en' }],
      targetUrl: 'https://algo.illegalscreed.cn/quick-sort/',
      video: { flowIds: ['quick-sort'], format: 'landscape' },
    }
    const requests = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_publishing_activity',
          arguments: {
            activityId: 'mcp-cli-video',
            campaignId: 'mcp-cli-video',
            channels: [{ id: 'youtube', locale: 'en' }],
            goal: 'education',
            projectId: 'algorithm-visualizer',
            projectSnapshotId: 'algorithm-visualizer-snapshot-1',
            status: 'draft',
            targetUrl: 'https://algo.illegalscreed.cn/quick-sort/',
            topic: { 'en': 'Worker demo', 'zh-CN': 'Worker 演示' },
            video: { flowIds: ['quick-sort'], format: 'landscape' },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_content_group',
          arguments: {
            activityId: 'mcp-cli-video',
            contentGroupId: 'mcp-cli-video-group',
            coreMessage: 'Show the worker demo.',
            projectId: 'algorithm-visualizer',
            title: 'Worker demo',
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'save_channel_content',
          arguments: {
            activityId: 'mcp-cli-video',
            artifactIds: [],
            body: 'Worker demo video',
            channel: 'youtube',
            contentGroupId: 'mcp-cli-video-group',
            contentId: 'mcp-cli-video-content',
            format: 'video',
            locale: 'en',
            projectId: 'algorithm-visualizer',
            title: 'Worker demo video',
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'start_production_task',
          arguments: {
            projectId: 'algorithm-visualizer',
            taskId: 'production-mcp-cli-video-content',
          },
        },
      },
    ]

    try {
      await writeFile(projectPath, JSON.stringify(videoProject), 'utf8')
      await writeFile(campaignPath, JSON.stringify(videoCampaign), 'utf8')
      await expect(runCli(
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
          input: Readable.from(requests.map(request => `${JSON.stringify(request)}\n`)),
          output: new Writable({
            write(chunk, _encoding, callback) {
              output.push(String(chunk))
              callback()
            },
          }),
          write: () => undefined,
        },
        {
          record: async input => ({
            attempts: [],
            receipt: {
              artifactDirectory: input.outputDirectory,
              artifacts: [],
              attempt: 1,
              campaignId: 'mcp-cli-video',
              completedActions: 1,
              completedScenes: 1,
              jobId: input.jobId,
              logs: {
                consoleErrors: 0,
                consoleWarnings: 0,
                entries: [],
                pageErrors: 0,
              },
              outcome: 'succeeded',
              planSha256: 'mcp-cli-worker-plan',
              projectId: input.projectId,
              recordingConfig: input.plan.recordingConfig,
              receiptVersion: 1,
              totalActions: 1,
              totalScenes: 1,
            },
          }),
        },
      )).resolves.toBe(0)

      const responses = output
        .join('')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as { result?: { structuredContent?: { status?: string } } })
      expect(responses.at(-1)).toMatchObject({
        result: {
          structuredContent: { status: 'working' },
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
                  recordingConfig: input.plan.recordingConfig,
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
        recordingContext: {
          captureMode: 'deterministic',
          humanIntervention: false,
          planVersion: 1,
          repeatability: 'high',
          sourceAccess: 'source-owned',
        },
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
