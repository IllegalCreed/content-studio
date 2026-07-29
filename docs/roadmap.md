# Roadmap

> Status: active
> Last reviewed: 2026-07-29

## Product direction

Content Studio is evolving from a deterministic compiler into a cross-project
content-production control plane. Algorithm Visualizer remains the first
end-to-end fixture. The visual workspace is a client of the reusable core, and
all publishing remains behind independent `marketing-ops` authorization and
policy.

## V0.1 — compiler foundation

- [x] Versioned project and campaign contracts.
- [x] Sensitive-field, HTTPS, canonical-origin, fact, locale, channel, and flow validation.
- [x] Deterministic content generation for the 19-channel inventory.
- [x] Semantic capture-flow compiler for landscape, portrait, and square video.
- [x] Safe local bundle writer and fixed CLI grammar.
- [x] Algorithm Visualizer example.

## V0.2 — observable local recording

### Contract and execution kernel

- [x] Record the product vision, control-plane boundary, aggregate model, and
      lifecycle state machine.
- [ ] Define standard recorder progress events, log summaries, preview frames,
      attempt receipts, and typed failure codes.
- [ ] Add a recording runner with cooperative cancellation and bounded,
      policy-driven retry.
- [ ] Preserve every attempt under a distinct narrow output directory.

### Playwright adapter

- [ ] Add a Playwright recorder that consumes only compiled semantic actions.
- [ ] Start or attach to a project preview through an explicit project-owned adapter.
- [ ] Record isolated clips with fixed viewport, reduced motion policy, and deterministic waits.
- [ ] Fail closed on missing locators, navigation outside the project origin, dialogs, downloads, or authentication pages.
- [ ] Preserve video evidence, sanitized log summaries, preview frames, and a machine-readable recorder receipt.
- [ ] Add the fixed `record` CLI grammar after the library contract is stable.

### V0.2 acceptance gates

- [ ] Unit tests prove event order, cancellation, retry isolation, semantic-only
      locator mapping, and fail-closed policy.
- [ ] An integration fixture records a local deterministic page without secrets
      or a persistent browser profile.
- [ ] `pnpm lint:check`, `pnpm type-check`, `pnpm test`, `pnpm coverage`,
      `pnpm build`, and `pnpm generate:example` pass.

## V0.3 — minimal workspace and composition

### Vue 3 workspace

- [ ] Create a minimal Vue 3 + TypeScript control surface.
- [ ] Add the first real projections: Project Portfolio, Campaign Board, Video
      Job Detail, and Owner Inbox.
- [ ] Show lifecycle stage, attempt history, progress events, bounded logs,
      preview frames, and landscape/portrait/square artifacts.
- [ ] Support cancel and retry through application-service commands.
- [ ] Add a read-only Channel Center backed by fresh `marketing-ops` health and
      policy snapshots; local UI state cannot enable publishing.
- [ ] Keep all production behavior in Content Studio core/runtime adapters.

### Media automation

- [ ] Add FFmpeg scene composition, transitions, crops, loudness normalization, and platform aspect-ratio variants.
- [ ] Generate captions and narration scripts from the same declared facts.
- [ ] Support a zero-cost local narration path and an optional reviewed provider interface.
- [ ] Produce thumbnails, cover frames, subtitles, descriptions, and media checksums.

## V0.4 — marketing-ops handoff

- [ ] Convert content/media artifacts into a versioned, project-scoped handoff contract.
- [ ] Keep media references local and checksum-addressed; never pass arbitrary file paths through MCP.
- [ ] Display authorization and channel-health snapshots without treating them as local publishing authority.
- [ ] Support Owner handoff packets for official-UI login, 2FA/CAPTCHA, review, and final click.
- [ ] Ingest matching publication receipts and reconcile public URLs.
- [ ] Add 1h/48h/7d follow-up reports from monitoring observations.
- [ ] Add per-channel artifact constraints before any upload adapter can be considered.

## Later — portable application surfaces

- [ ] Stabilize project, campaign, job, artifact, handoff, receipt, and report
      application-service contracts.
- [ ] Expose high-level projections, commands, and progress events through an
      optional MCP application adapter without binding the product to one host.
- [ ] Add Content Library, full Channel Center, Report Timeline, and audit views
      after their backing contracts are real.
- [ ] Keep the local-first workspace usable when a channel is content-only,
      reauthentication-required, blocked, or Owner-assisted.

## Non-goals

- Credential storage or browser-session ownership.
- Channel login, CAPTCHA/2FA handling, stealth, or internal APIs.
- Publishing, replies, or deletion without matching external authorization.
- Publishing authority inferred from generated content or an Owner handoff.
- Arbitrary scripts, arbitrary selectors, or project-specific recorder forks
  when a declarative manifest is sufficient.
