# AGENTS.md

## Purpose

Content Studio is a cross-project content-production control plane. It compiles
versioned project facts and campaign briefs into deterministic content packages
and semantic video plans, then coordinates observable recording, composition,
Owner handoffs, and reporting from one reusable workspace. Algorithm Visualizer
is the first proving project, not a product-specific boundary.

The future Vue workspace is a replaceable control surface over the same core,
job, artifact, and `marketing-ops` contracts used by the CLI. It must not become
a second generation, recording, composition, or publishing engine. Publishing
belongs to `marketing-ops`, not this repository.

## Required boundaries

- Use pnpm only. Do not use npm or yarn.
- Never accept, read, print, or persist tokens, cookies, passwords, Keychain values, browser profiles, or payment data.
- Do not add channel publishing, replies, deletion, login automation, CAPTCHA bypass, stealth, internal APIs, arbitrary scripts, or arbitrary selectors.
- A generated package never grants publishing authority. Any external write still requires the separate matching campaign authorization and channel policy.
- Project capture flows may use only semantic role, label, text, and test-id locators.
- Keep generated output under `.content-studio/` or another explicit narrow directory. Never delete unknown output files.
- Displayed channel health, policy, authorization, and publication state must
  come from fresh `marketing-ops` snapshots or receipts; local UI state cannot
  grant or expand external-write authority.

## Engineering conventions

- TypeScript, pure ESM, Node.js 22+, pnpm 10.29.2.
- Follow TDD: add a failing Vitest case, implement the smallest change, then run the relevant full gates.
- Keep types in `src/types.ts` and constants in `src/constants.ts`.
- Keep runtime-specific files marked with `// @env node`.
- Prefer small single-purpose modules and explicit return types.
- Test files use `*.test.ts`, `describe`, and `it`.
- Use `pnpm lint` for formatting/fixes; do not add a separate formatter.

## Gates

- `pnpm lint:check`
- `pnpm type-check`
- `pnpm test`
- `pnpm coverage`
- `pnpm build`
- `pnpm generate:example`

Before commit, inspect `git status`, stage exact files, and do not use `git add -A`.
