// @env node

import type { MarketingOpsStatusClient, ProjectManifest } from '../types'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { isMarketingOpsStatusSnapshotFresh } from '../marketing-ops/client'
import { createProjectRecord } from '../project/record'

interface DoctorRuntime {
  cwd: string
  marketingOpsStatus?: MarketingOpsStatusClient
  write: (message: string) => void
}

type DoctorCheckStatus = 'error' | 'ok' | 'warn'

interface DoctorCheck {
  detail: string
  label: string
  status: DoctorCheckStatus
}

export async function runDoctor(
  project: ProjectManifest,
  options: ReadonlyMap<string, string>,
  runtime: DoctorRuntime,
): Promise<number> {
  const projectRecord = createProjectRecord(
    project,
    `${project.projectId}-doctor-snapshot`,
  )
  const contentDirectory = resolve(runtime.cwd, '.content-studio')
  const databasePath = resolve(
    runtime.cwd,
    options.get('db') ?? '.content-studio/content-studio.sqlite',
  )
  runtime.write(`Content Studio doctor · ${project.projectId}`)
  const checks: DoctorCheck[] = [
    nodeCheck(),
    {
      detail: `已读取并通过校验：${project.projectId}`,
      label: '项目清单',
      status: 'ok',
    },
    {
      detail: `${projectRecord.sourceAccess} / ${projectRecord.captureMode} / ${projectRecord.repeatability}`,
      label: '项目模式',
      status: projectRecord.sourceAccess === 'source-owned'
        && projectRecord.captureMode === 'deterministic'
        ? 'ok'
        : 'warn',
    },
    await directoryCheck('产物目录', contentDirectory),
    await directoryCheck('SQLite 目录', dirname(databasePath)),
    await playwrightCheck(projectRecord.sourceAccess, projectRecord.captureMode),
    await marketingOpsCheck(project.projectId, runtime.marketingOpsStatus),
  ]
  for (const check of checks)
    runtime.write(formatCheck(check))
  runtime.write('提示：doctor 只检查本地运行条件，不自动创建目录，也不会自动读取凭据或配置渠道。')
  return checks.some(check => check.status === 'error') ? 1 : 0
}

async function marketingOpsCheck(
  projectId: string,
  client: MarketingOpsStatusClient | undefined,
): Promise<DoctorCheck> {
  if (client === undefined) {
    return {
      detail: '受管 runtime 尚未连接；内容制作仍可用，发布保持阻塞',
      label: 'Marketing Ops runtime',
      status: 'warn',
    }
  }
  try {
    const snapshot = await client.getChannelsStatus(projectId)
    if (!isMarketingOpsStatusSnapshotFresh(snapshot)) {
      return {
        detail: '状态快照已过期；发布保持阻塞',
        label: 'Marketing Ops runtime',
        status: 'error',
      }
    }
    const ready = snapshot.channels.filter(channel => channel.adapterReady).length
    return {
      detail: `${snapshot.runtimeVersion} / contract v${snapshot.contractVersion}；${ready}/${snapshot.channels.length} 个适配器已就绪`,
      label: 'Marketing Ops runtime',
      status: ready > 0 ? 'ok' : 'warn',
    }
  }
  catch {
    return {
      detail: '运行时不兼容、不可用或状态响应未通过校验；发布保持阻塞',
      label: 'Marketing Ops runtime',
      status: 'error',
    }
  }
}

function nodeCheck(): DoctorCheck {
  const [major = 0, minor = 0, patch = 0] = process.versions.node
    .split('.')
    .map(value => Number(value))
  const supported = major > 22
    || (major === 22 && minor > 5)
    || (major === 22 && minor === 5 && patch >= 0)
  return {
    detail: `当前 ${process.versions.node}，要求 Node.js >= 22.5.0`,
    label: 'Node.js 版本',
    status: supported ? 'ok' : 'error',
  }
}

async function directoryCheck(
  label: string,
  directory: string,
): Promise<DoctorCheck> {
  try {
    const directoryStatus = await stat(directory)
    if (!directoryStatus.isDirectory()) {
      return {
        detail: `${directory} 不是目录`,
        label,
        status: 'error',
      }
    }
    await access(directory, constants.W_OK | constants.X_OK)
    return {
      detail: `${directory} 可写`,
      label,
      status: 'ok',
    }
  }
  catch (error: unknown) {
    if (isMissingPath(error)) {
      try {
        await access(dirname(directory), constants.W_OK | constants.X_OK)
        return {
          detail: `${directory} 尚未创建，但父目录可写；首次运行时会按需创建`,
          label,
          status: 'warn',
        }
      }
      catch {
        return {
          detail: `${directory} 不存在，且父目录不可写`,
          label,
          status: 'error',
        }
      }
    }
    return {
      detail: `${directory} 不可写`,
      label,
      status: 'error',
    }
  }
}

async function playwrightCheck(
  sourceAccess: ProjectManifest['sourceAccess'],
  captureMode: ProjectManifest['captureMode'],
): Promise<DoctorCheck> {
  if (sourceAccess === 'web-assisted' || captureMode === 'assisted') {
    return {
      detail: '当前项目使用辅助模式，内置 Playwright Worker 不会自动接管',
      label: 'Playwright Worker',
      status: 'warn',
    }
  }
  const executablePath = chromium.executablePath()
  try {
    await access(executablePath, constants.X_OK)
    return {
      detail: `浏览器可执行文件已就绪：${executablePath}`,
      label: 'Playwright Worker',
      status: 'ok',
    }
  }
  catch {
    return {
      detail: '未找到 Chromium，请运行 pnpm exec playwright install chromium',
      label: 'Playwright Worker',
      status: 'warn',
    }
  }
}

function formatCheck(check: DoctorCheck): string {
  const marker = check.status === 'ok' ? '✓' : check.status === 'warn' ? '!' : '×'
  return `[${marker}] ${check.label}：${check.detail}`
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
