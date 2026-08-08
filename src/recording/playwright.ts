// @env node

import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Locator,
  Page,
  Video,
} from 'playwright'
import type {
  CompiledCaptureAction,
  CompiledScene,
  OwnerTakeoverController,
  OwnerTakeoverRecord,
  PlaywrightRecordingOptions,
  ProjectPreviewAdapter,
  ProjectRecordingJobInput,
  RecorderArtifact,
  RecorderLogSummary,
  RecordingActionContext,
  RecordingActionResult,
  RecordingAttemptContext,
  RecordingContext,
  RecordingJobInput,
  RecordingJobResult,
  RecordingSceneContext,
  RecordingSession,
  SemanticLocator,
  VideoPlan,
} from '../types'
import {
  execFile as execFileCallback,
  execFileSync,
} from 'node:child_process'
import {
  mkdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import { chromium } from 'playwright'
import {
  createRecorderArtifact,
  prepareAttemptDirectory,
  writeRecorderReceipt,
} from './artifacts'
import { withProjectPreview } from './preview'
import {
  RecorderError,
  runRecordingJob,
} from './run'

const DEFAULT_ACTION_TIMEOUT_MS = 10_000
const MAX_LOG_ENTRIES = 20
const AUTHENTICATION_PATH_PATTERN
  = /(?:^|\/)(?:auth|captcha|challenge|log-in|login|oauth|sign-in|signin|verify)(?:\/|$)/i
const execFile = promisify(execFileCallback)

interface SemanticLocatorPage<TLocator = unknown> {
  getByLabel: (
    text: string,
    options: { exact: boolean },
  ) => TLocator
  getByRole: (
    role: string,
    options: { exact: boolean, name?: string },
  ) => TLocator
  getByTestId: (testId: string) => TLocator
  getByText: (
    text: string,
    options: { exact: boolean },
  ) => TLocator
}

export async function recordWithPlaywright(
  input: RecordingJobInput,
  options: PlaywrightRecordingOptions = {},
): Promise<RecordingJobResult> {
  assertBuiltInRecorderContext(input.recordingContext)
  return runRecordingJob(input, {
    createSession: context =>
      createPlaywrightRecordingSession(context, options),
    ...(options.emit === undefined ? {} : { emit: options.emit }),
    persistReceipt: writeRecorderReceipt,
    prepareAttempt: async (context) => {
      let preparedDirectory: string
      try {
        preparedDirectory = await prepareAttemptDirectory(
          dirname(context.artifactDirectory),
          context.attempt,
        )
      }
      catch {
        throw new RecorderError(
          'runtime-error',
          'The recording attempt directory could not be prepared.',
          false,
        )
      }
      if (preparedDirectory !== context.artifactDirectory)
        throw new Error('Recorder attempt directory did not match the job plan')
    },
  })
}

export async function recordProjectWithPlaywright(
  input: ProjectRecordingJobInput,
  previewAdapter: ProjectPreviewAdapter,
  options: PlaywrightRecordingOptions = {},
): Promise<RecordingJobResult> {
  return withProjectPreview(
    previewAdapter,
    {
      projectId: input.projectId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
    baseUrl =>
      recordWithPlaywright(
        {
          ...input,
          baseUrl,
        },
        options,
      ),
  )
}

export async function createPlaywrightRecordingSession(
  context: RecordingAttemptContext,
  options: PlaywrightRecordingOptions = {},
): Promise<RecordingSession> {
  assertBuiltInRecorderContext(context.recordingContext)
  const actionTimeoutMs = options.actionTimeoutMs
    ?? DEFAULT_ACTION_TIMEOUT_MS
  if (
    !Number.isInteger(actionTimeoutMs)
    || actionTimeoutMs < 100
    || actionTimeoutMs > 60_000
  ) {
    throw new Error(
      'Playwright actionTimeoutMs must be between 100 and 60000',
    )
  }

  const ownerTakeover = resolveOwnerTakeoverController(
    context.recordingContext,
    options.ownerTakeover,
  )
  if (ownerTakeover !== undefined)
    resolveManagedRecorderFfmpegPath()
  const browser = await chromium.launch({
    headless: options.headless ?? true,
  })
  return new PlaywrightRecordingSession(
    browser,
    context,
    actionTimeoutMs,
    ownerTakeover,
  )
}

export function resolveOwnerTakeoverController(
  recordingContext: RecordingContext | undefined,
  controller: OwnerTakeoverController | undefined,
): OwnerTakeoverController | undefined {
  if (controller === undefined)
    return undefined
  if (recordingContext?.ownerTakeover !== true) {
    throw new RecorderError(
      'runtime-error',
      'An owner takeover controller requires recordingContext.ownerTakeover to be true.',
      false,
    )
  }
  return controller
}

function resolveManagedRecorderFfmpegPath(): string {
  if (ffmpegStatic !== null)
    return ffmpegStatic
  try {
    execFileSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
    })
    return 'ffmpeg'
  }
  catch {
    throw new RecorderError(
      'runtime-error',
      'Owner takeover recording requires a system ffmpeg binary on PATH.',
      false,
    )
  }
}

async function concatWebmSegments(
  segments: string[],
  outputPath: string,
  ffmpegPath: string,
): Promise<void> {
  const listPath = `${outputPath}.concat.txt`
  await writeFile(listPath, concatListFileContent(segments), 'utf8')
  try {
    await execFile(
      ffmpegPath,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath],
      {
        maxBuffer: 4 * 1024 * 1024,
      },
    )
  }
  catch {
    await unlink(listPath).catch(() => {})
    throw new RecorderError(
      'runtime-error',
      'Video segment concatenation failed.',
      true,
    )
  }
  await unlink(listPath).catch(() => {})
  for (const segment of segments)
    await unlink(segment).catch(() => {})
}

function concatListFileContent(segments: string[]): string {
  return `${segments
    .map(segment => `file '${segment.replace(/'/g, `'\\''`)}'`)
    .join('\n')}\n`
}

function assertBuiltInRecorderContext(
  context: RecordingContext | undefined,
): void {
  if (
    context?.sourceAccess === 'web-assisted'
    || context?.captureMode === 'assisted'
  ) {
    throw new RecorderError(
      'assisted-mode-unsupported',
      'The built-in Playwright recorder does not execute web-assisted projects.',
      false,
    )
  }
}

export function resolveSemanticLocator<TLocator>(
  page: SemanticLocatorPage<TLocator>,
  locator: SemanticLocator,
): TLocator {
  if (locator.by === 'label') {
    return page.getByLabel(locator.value, {
      exact: true,
    })
  }
  if (locator.by === 'role') {
    return page.getByRole(locator.value, {
      exact: true,
      ...(locator.name === undefined ? {} : { name: locator.name }),
    })
  }
  if (locator.by === 'test-id')
    return page.getByTestId(locator.value)
  return page.getByText(locator.value, {
    exact: true,
  })
}

export function validateProjectNavigation(
  pageUrl: string,
  projectOrigin: string,
): void {
  if (pageUrl === 'about:blank')
    return

  let url: URL
  try {
    url = new URL(pageUrl)
  }
  catch {
    throw new RecorderError(
      'cross-origin-navigation',
      'Navigation did not produce an allowed project URL.',
      false,
    )
  }
  if (url.origin !== projectOrigin) {
    throw new RecorderError(
      'cross-origin-navigation',
      'Navigation left the project origin.',
      false,
    )
  }
  if (AUTHENTICATION_PATH_PATTERN.test(url.pathname)) {
    throw new RecorderError(
      'authentication-page',
      'Navigation reached an authentication page.',
      false,
    )
  }
}

export function sanitizeOwnerTakeoverPageUrl(pageUrl: string): string {
  const url = new URL(pageUrl)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString()
}

function assertOwnerLeftAuthenticationPage(
  pageUrl: string,
  projectOrigin: string,
): void {
  try {
    validateProjectNavigation(pageUrl, projectOrigin)
  }
  catch (error) {
    if (
      error instanceof RecorderError
      && error.code === 'authentication-page'
    ) {
      throw new RecorderError(
        'authentication-page',
        'Owner confirmed but the recording is still on an authentication page.',
        false,
      )
    }
    throw error
  }
}

export function resolvePlaywrightRecordingContextOptions(
  plan: VideoPlan,
  rawVideoDirectory: string,
): BrowserContextOptions {
  return {
    acceptDownloads: false,
    colorScheme: plan.recordingConfig.colorScheme,
    deviceScaleFactor: plan.recordingConfig.deviceScaleFactor,
    locale: plan.recordingConfig.locale,
    recordVideo: {
      dir: rawVideoDirectory,
      size: plan.recordingConfig.outputSize,
    },
    reducedMotion: 'reduce',
    viewport: plan.recordingConfig.viewport,
  }
}

class PlaywrightRecordingSession implements RecordingSession {
  private readonly actionTimeoutMs: number
  private readonly artifacts: RecorderArtifact[] = []
  private readonly browser: Browser
  private readonly context: RecordingAttemptContext
  private readonly logs: RecorderLogSummary = {
    consoleErrors: 0,
    consoleWarnings: 0,
    entries: [],
    pageErrors: 0,
  }

  private readonly ownerTakeover: OwnerTakeoverController | undefined

  private browserContext: BrowserContext | undefined
  private currentScene: CompiledScene | undefined
  private currentSceneIndex: number | undefined
  private ownerTakeoverRecord: OwnerTakeoverRecord | undefined
  private page: Page | undefined
  private policyViolation: RecorderError | undefined
  private activeScreencastSegment: string | undefined
  private screencastActive = false
  private readonly screencastSegments: string[] = []
  private screencastSegmentIndex = 0
  private readonly useSegmentedVideo: boolean
  private video: Video | null | undefined

  constructor(
    browser: Browser,
    context: RecordingAttemptContext,
    actionTimeoutMs: number,
    ownerTakeover: OwnerTakeoverController | undefined,
  ) {
    this.actionTimeoutMs = actionTimeoutMs
    this.browser = browser
    this.context = context
    this.ownerTakeover = ownerTakeover
    this.useSegmentedVideo = ownerTakeover !== undefined
  }

  async beginScene(
    scene: CompiledScene,
    sceneContext: RecordingSceneContext,
  ): Promise<void> {
    if (this.page !== undefined)
      throw new Error('A recorder scene is already active')

    throwIfAborted(sceneContext.signal)
    const rawVideoDirectory = join(
      this.context.artifactDirectory,
      '.playwright-video',
    )
    await mkdir(rawVideoDirectory, {
      recursive: true,
    })
    await mkdir(
      join(this.context.artifactDirectory, 'clips'),
      {
        recursive: true,
      },
    )
    await mkdir(
      join(this.context.artifactDirectory, 'previews'),
      {
        recursive: true,
      },
    )

    const contextOptions = resolvePlaywrightRecordingContextOptions(
      this.context.plan,
      rawVideoDirectory,
    )
    if (this.useSegmentedVideo)
      delete contextOptions.recordVideo
    const browserContext = await this.browser.newContext(contextOptions)
    browserContext.setDefaultTimeout(this.actionTimeoutMs)
    this.browserContext = browserContext
    this.currentScene = scene
    this.currentSceneIndex = sceneContext.sceneIndex
    this.policyViolation = undefined

    browserContext.on('page', (newPage) => {
      if (this.page !== undefined && newPage !== this.page) {
        this.policyViolation = new RecorderError(
          'cross-origin-navigation',
          'The project opened an unexpected browser page.',
          false,
        )
        void newPage.close()
      }
    })

    const page = await browserContext.newPage()
    this.page = page
    if (this.useSegmentedVideo) {
      this.video = null
      this.screencastSegments.length = 0
      this.screencastSegmentIndex = 0
      this.activeScreencastSegment = undefined
      this.screencastActive = false
    }
    else {
      this.video = page.video()
    }
    this.observePage(page)
    await page.emulateMedia({
      colorScheme: this.context.plan.recordingConfig.colorScheme,
      reducedMotion: 'reduce',
    })

    const sceneUrl = new URL(scene.startPath, this.context.baseUrl)
    try {
      validateProjectNavigation(sceneUrl.toString(), this.context.baseUrl)
    }
    catch (error) {
      if (
        !(
          error instanceof RecorderError
          && error.code === 'authentication-page'
          && this.ownerTakeover !== undefined
        )
      ) {
        throw error
      }
    }
    await withAbort(
      page.goto(sceneUrl.toString(), {
        waitUntil: 'domcontentloaded',
      }),
      sceneContext.signal,
    )
    await this.assertPolicy()
    if (this.useSegmentedVideo && !this.screencastActive)
      await this.startScreencastSegment(sceneContext.sceneIndex)
  }

  async runAction(
    action: CompiledCaptureAction,
    actionContext: RecordingActionContext,
  ): Promise<RecordingActionResult> {
    const page = this.requirePage()
    throwIfAborted(actionContext.signal)
    await this.assertPolicy()

    if (action.kind === 'wait') {
      await abortableDelay(action.durationMs, actionContext.signal)
      await this.assertPolicy()
      return {}
    }

    if (action.kind === 'capture') {
      const relativePath = [
        'previews',
        `scene-${formatIndex(actionContext.sceneIndex)}-action-${formatIndex(actionContext.actionIndex)}.png`,
      ].join('/')
      await withAbort(
        page.screenshot({
          animations: 'disabled',
          path: join(this.context.artifactDirectory, relativePath),
        }),
        actionContext.signal,
      )
      await abortableDelay(action.durationMs, actionContext.signal)
      await this.assertPolicy()
      const preview = await createRecorderArtifact(
        this.context.artifactDirectory,
        relativePath,
        'preview-frame',
        `preview-${formatIndex(actionContext.sceneIndex)}-${formatIndex(actionContext.actionIndex)}`,
        this.currentScene?.id,
      )
      return {
        preview,
      }
    }

    if (action.kind === 'wait-for') {
      const locator = resolveSemanticLocator(
        page as unknown as SemanticLocatorPage<Locator>,
        action.locator,
      )
      await waitForVisibleLocator(locator, action.durationMs, actionContext.signal)
      await this.assertPolicy()
      return {}
    }

    if (action.kind === 'press') {
      await withAbort(
        page.keyboard.press(action.key),
        actionContext.signal,
      )
      await abortableDelay(action.durationMs, actionContext.signal)
      await this.assertPolicy()
      return {}
    }

    const locator = resolveSemanticLocator(
      page as unknown as SemanticLocatorPage<Locator>,
      action.locator,
    )
    await assertSingleLocator(locator)
    if (action.kind === 'click') {
      await withAbort(
        locator.click(),
        actionContext.signal,
      )
    }
    else {
      await withAbort(
        locator.fill(action.value),
        actionContext.signal,
      )
    }
    await abortableDelay(action.durationMs, actionContext.signal)
    await this.assertPolicy()
    return {}
  }

  async endScene(
    scene: CompiledScene,
    sceneContext: RecordingSceneContext,
  ): Promise<void> {
    if (
      this.currentScene?.id !== scene.id
      || this.currentSceneIndex !== sceneContext.sceneIndex
    ) {
      throw new Error('Recorder scene completion did not match the active scene')
    }
    await this.assertPolicy()
    await this.finishCurrentScene()
  }

  async close(): Promise<{
    artifacts: RecorderArtifact[]
    logs: RecorderLogSummary
  }> {
    try {
      if (this.page !== undefined)
        await this.finishCurrentScene()
    }
    finally {
      await this.browser.close()
    }
    return {
      artifacts: this.artifacts,
      logs: {
        ...this.logs,
        entries: [...this.logs.entries],
      },
      ...(this.ownerTakeoverRecord === undefined
        ? {}
        : { ownerTakeover: this.ownerTakeoverRecord }),
    }
  }

  private observePage(page: Page): void {
    page.on('console', (message) => {
      if (message.type() === 'error') {
        this.logs.consoleErrors += 1
        this.addLogEntry('console:error')
      }
      if (message.type() === 'warning') {
        this.logs.consoleWarnings += 1
        this.addLogEntry('console:warning')
      }
    })
    page.on('dialog', (dialog) => {
      this.policyViolation = new RecorderError(
        'dialog-opened',
        'The project opened a browser dialog.',
        false,
      )
      void dialog.dismiss()
    })
    page.on('download', (download) => {
      this.policyViolation = new RecorderError(
        'download-started',
        'The project started a browser download.',
        false,
      )
      void download.cancel()
    })
    page.on('pageerror', () => {
      this.logs.pageErrors += 1
      this.addLogEntry('page:error')
    })
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame())
        return
      try {
        validateProjectNavigation(frame.url(), this.context.baseUrl)
      }
      catch (error) {
        this.policyViolation = error instanceof RecorderError
          ? error
          : new RecorderError(
              'cross-origin-navigation',
              'Navigation left the project origin.',
              false,
            )
      }
    })
  }

  private addLogEntry(entry: string): void {
    if (this.logs.entries.length < MAX_LOG_ENTRIES)
      this.logs.entries.push(entry)
  }

  private async assertPolicy(): Promise<void> {
    if (this.policyViolation !== undefined) {
      const violation = this.policyViolation
      this.policyViolation = undefined
      if (
        violation.code === 'authentication-page'
        && this.ownerTakeover !== undefined
      ) {
        await this.pauseForOwnerTakeover()
        return
      }
      throw violation
    }
    if (this.page !== undefined) {
      try {
        validateProjectNavigation(
          this.page.url(),
          this.context.baseUrl,
        )
      }
      catch (error) {
        if (
          error instanceof RecorderError
          && error.code === 'authentication-page'
          && this.ownerTakeover !== undefined
        ) {
          await this.pauseForOwnerTakeover()
          return
        }
        throw error
      }
    }
  }

  private async pauseForOwnerTakeover(): Promise<void> {
    const page = this.requirePage()
    const requestedAt = new Date().toISOString()
    await this.stopScreencastSegment(true)
    this.addLogEntry('owner-takeover:requested')
    await withAbort(
      this.ownerTakeover!.request({
        jobId: this.context.jobId,
        pageUrl: sanitizeOwnerTakeoverPageUrl(page.url()),
        projectId: this.context.projectId,
      }),
      this.context.signal,
    )
    const confirmedAt = new Date().toISOString()
    const violation = this.policyViolation
    if (violation !== undefined && violation.code !== 'authentication-page') {
      throw violation
    }
    assertOwnerLeftAuthenticationPage(page.url(), this.context.baseUrl)
    await this.startScreencastSegment(this.currentSceneIndex ?? 0)
    this.ownerTakeoverRecord = {
      confirmedAt,
      requestedAt,
    }
    this.addLogEntry('owner-takeover:confirmed')
  }

  private async startScreencastSegment(sceneIndex: number): Promise<void> {
    const page = this.requirePage()
    this.screencastSegmentIndex += 1
    const segmentPath = join(
      this.context.artifactDirectory,
      `clips/scene-${formatIndex(sceneIndex)}.segment-${this.screencastSegmentIndex}.webm`,
    )
    this.screencastSegments.push(segmentPath)
    let resolveFirstFrame: (() => void) | undefined
    const firstFrame = new Promise<void>((resolve) => {
      resolveFirstFrame = resolve
    })
    await page.screencast.start({
      onFrame: () => resolveFirstFrame?.(),
      path: segmentPath,
      size: {
        height: this.context.plan.recordingConfig.viewport.height,
        width: this.context.plan.recordingConfig.viewport.width,
      },
    })
    this.activeScreencastSegment = segmentPath
    this.screencastActive = true
    const repaint = await page.screencast.showOverlay(
      '<div aria-hidden="true" style="position:fixed;inset:0;pointer-events:none;opacity:0"></div>',
    )
    try {
      await Promise.race([
        firstFrame,
        wait(this.actionTimeoutMs, undefined, { ref: false }).then(() => {
          throw new RecorderError(
            'runtime-error',
            'The recorder could not capture a safe page frame.',
            true,
          )
        }),
      ])
    }
    finally {
      await repaint.dispose()
    }
  }

  private async stopScreencastSegment(discard = false): Promise<void> {
    const page = this.page
    if (!this.screencastActive || page === undefined)
      return
    await page.screencast.stop()
    this.screencastActive = false
    const segmentPath = this.activeScreencastSegment
    this.activeScreencastSegment = undefined
    if (!discard || segmentPath === undefined)
      return
    const segmentIndex = this.screencastSegments.lastIndexOf(segmentPath)
    if (segmentIndex !== -1)
      this.screencastSegments.splice(segmentIndex, 1)
    try {
      await unlink(segmentPath)
    }
    catch (error: unknown) {
      if (!isMissingFileError(error))
        throw error
    }
  }

  private async finalizeScreencastScene(
    sceneIndex: number,
    scene: CompiledScene,
  ): Promise<void> {
    if (this.screencastSegments.length === 0)
      return
    const relativePath = `clips/scene-${formatIndex(sceneIndex)}.webm`
    const finalPath = join(this.context.artifactDirectory, relativePath)
    if (this.screencastSegments.length === 1) {
      await rename(this.screencastSegments[0]!, finalPath)
    }
    else {
      await concatWebmSegments(
        [...this.screencastSegments],
        finalPath,
        resolveManagedRecorderFfmpegPath(),
      )
    }
    this.screencastSegments.length = 0
    this.artifacts.push(
      await createRecorderArtifact(
        this.context.artifactDirectory,
        relativePath,
        'video-clip',
        `clip-${formatIndex(sceneIndex)}`,
        scene.id,
      ),
    )
  }

  private requirePage(): Page {
    if (this.page === undefined)
      throw new Error('Recorder action requires an active scene')
    return this.page
  }

  private async finishCurrentScene(): Promise<void> {
    const browserContext = this.browserContext
    const page = this.page
    const scene = this.currentScene
    const sceneIndex = this.currentSceneIndex
    const video = this.video

    if (
      browserContext === undefined
      || page === undefined
      || scene === undefined
      || sceneIndex === undefined
    ) {
      this.browserContext = undefined
      this.currentScene = undefined
      this.currentSceneIndex = undefined
      this.page = undefined
      this.video = undefined
      return
    }

    if (this.useSegmentedVideo)
      await this.stopScreencastSegment()
    this.browserContext = undefined
    this.currentScene = undefined
    this.currentSceneIndex = undefined
    this.page = undefined
    this.video = undefined
    await page.close()
    await browserContext.close()
    const relativePath = `clips/scene-${formatIndex(sceneIndex)}.webm`
    if (this.useSegmentedVideo) {
      await this.finalizeScreencastScene(sceneIndex, scene)
      return
    }
    if (video === null || video === undefined)
      return
    await video.saveAs(
      join(this.context.artifactDirectory, relativePath),
    )
    await video.delete()
    this.artifacts.push(
      await createRecorderArtifact(
        this.context.artifactDirectory,
        relativePath,
        'video-clip',
        `clip-${formatIndex(sceneIndex)}`,
        scene.id,
      ),
    )
  }
}

async function assertSingleLocator(locator: Locator): Promise<void> {
  const count = await locator.count()
  if (count === 0) {
    throw new RecorderError(
      'locator-not-found',
      'A compiled semantic locator did not match an element.',
      true,
    )
  }
  if (count !== 1) {
    throw new RecorderError(
      'locator-not-unique',
      'A compiled semantic locator matched more than one element.',
      false,
    )
  }
}

async function waitForVisibleLocator(
  locator: Locator,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await withAbort(
      locator.waitFor({
        state: 'visible',
        timeout: timeoutMs,
      }),
      signal,
    )
  }
  catch (error) {
    if (error instanceof RecorderError)
      throw error
    throw new RecorderError(
      'locator-not-found',
      'A compiled semantic locator did not become visible.',
      true,
    )
  }
  await assertSingleLocator(locator)
}

function formatIndex(index: number): string {
  return String(index + 1).padStart(3, '0')
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === 'ENOENT'
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new RecorderError(
      'cancelled',
      'Recording was cancelled.',
      false,
    )
  }
}

async function withAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfAborted(signal)
  if (signal === undefined)
    return operation

  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(
        new RecorderError(
          'cancelled',
          'Recording was cancelled.',
          false,
        ),
      )
    }
    signal.addEventListener('abort', abort, {
      once: true,
    })
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

async function abortableDelay(
  durationMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal)
  try {
    await wait(
      durationMs,
      undefined,
      signal === undefined ? {} : { signal },
    )
  }
  catch (error) {
    throwIfAborted(signal)
    throw error
  }
}
