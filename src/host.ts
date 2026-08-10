#!/usr/bin/env node
// @env node

import process from 'node:process'
import { runContentStudioHost } from './host/run'

const controller = new AbortController()
const cancel = (): void => controller.abort()
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)

runContentStudioHost(
  process.argv.slice(2),
  {
    signal: controller.signal,
    write: message => process.stdout.write(`${message}\n`),
  },
)
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    process.stderr.write(`content-studio-host: ${message}\n`)
    process.exitCode = 1
  })
  .finally(() => {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  })
