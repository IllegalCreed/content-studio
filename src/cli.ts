#!/usr/bin/env node
// @env node

import process from 'node:process'
import { runCli } from './cli/run'

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  process.stderr.write(`content-studio: ${message}\n`)
  process.exitCode = 1
})
