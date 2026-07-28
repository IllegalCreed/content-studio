import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('repository tooling contract', () => {
  it('maps the reusable workflow to the repository read-only gate names', async () => {
    const workflow = await readFile(
      '.github/workflows/unit-test.yml',
      'utf8',
    )

    expect(workflow).toContain('typecheck: pnpm run type-check')
    expect(workflow).toContain('lint: pnpm run lint:check')
  })
})
