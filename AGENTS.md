# AGENTS.md

## Purpose

Content Studio is an open-source, local-first, cross-project, AI-native MCP
content-production control plane. An MCP-hosted AI uses versioned project facts
and publishing-activity briefs to create articles, images, video scripts, and
channel-specific content, then coordinates observable production, human
handoffs, and reporting. Algorithm Visualizer is the first proving project, not
a product-specific boundary.

Global channel definitions are enabled per project. Projects own their reusable
assets and publishing activities; activity outputs remain activity-scoped
unless explicitly promoted into the project asset library. Production,
publication, and monitoring tasks are execution records projected into global
and project task boards, not the business hierarchy inside an activity.

The Vue workspace is a replaceable control surface over the same core, job,
artifact, MCP, and `marketing-ops` contracts used by the CLI. It must not become
a second generation, recording, composition, monitoring, or publishing engine.
The installer should deliver `marketing-ops` as a pinned, compatible managed
runtime dependency, but publishing still belongs to that independently
versioned trust boundary, not this repository.

The public distribution target is a Plugin for the shared ChatGPT/Codex
directory, combining Skills, a stateless MCP server, and optional MCP Apps UI.
Prefer MCP `2026-07-28`, explicit project-scoped state handles, and the Tasks
extension for long-running calls. Core tools must remain useful without UI.
Public hosting is an optional entry and coordination layer; project data,
browser execution, and media production remain local by default.

## Required boundaries

- Use pnpm only. Do not use npm or yarn.
- Never accept, read, print, or persist tokens, cookies, passwords, Keychain values, browser profiles, or payment data.
- Do not add channel publishing, replies, deletion, login automation, CAPTCHA bypass, stealth, internal APIs, arbitrary scripts, or arbitrary selectors.
- A generated package never grants publishing authority. Any external write still requires the separate matching campaign authorization and channel policy.
- Installing, starting, or bundling `marketing-ops` never grants publishing
  authority and must not configure channels without an explicit local
  owner-controlled setup flow.
- Project capture flows may use only semantic role, label, text, and test-id locators.
- Project-owned integration code requires explicit project-owner permission and
  a registered, reviewed, narrow adapter. Never expose arbitrary project code,
  shell commands, scripts, or selectors through MCP or data contracts.
- Keep generated output under `.content-studio/` or another explicit narrow directory. Never delete unknown output files.
- Displayed channel health, policy, authorization, and publication state must
  come from fresh `marketing-ops` snapshots or receipts; local UI state cannot
  grant or expand external-write authority.
- Marketplace review accounts or credentials must be configured directly by the
  publisher in the official submission flow. Never put them in this repository,
  its docs, fixtures, MCP arguments, or agent context.

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
