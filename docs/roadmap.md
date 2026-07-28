# Roadmap

> Status: active
> Last reviewed: 2026-07-28

## V0.1 — compiler foundation

- [x] Versioned project and campaign contracts.
- [x] Sensitive-field, HTTPS, canonical-origin, fact, locale, channel, and flow validation.
- [x] Deterministic content generation for the 19-channel inventory.
- [x] Semantic capture-flow compiler for landscape, portrait, and square video.
- [x] Safe local bundle writer and fixed CLI grammar.
- [x] Algorithm Visualizer example.

## V0.2 — real local recording

- [ ] Add a Playwright recorder that consumes only compiled semantic actions.
- [ ] Start or attach to a project preview through an explicit project-owned adapter.
- [ ] Record isolated clips with fixed viewport, reduced motion policy, and deterministic waits.
- [ ] Fail closed on missing locators, navigation outside the project origin, dialogs, downloads, or authentication pages.
- [ ] Preserve screenshot/video evidence and a machine-readable recorder receipt.

## V0.3 — automated composition

- [ ] Add FFmpeg scene composition, transitions, crops, loudness normalization, and platform aspect-ratio variants.
- [ ] Generate captions and narration scripts from the same declared facts.
- [ ] Support a zero-cost local narration path and an optional reviewed provider interface.
- [ ] Produce thumbnails, cover frames, subtitles, descriptions, and media checksums.

## V0.4 — marketing-ops handoff

- [ ] Convert content/media artifacts into a versioned, project-scoped handoff contract.
- [ ] Keep media references local and checksum-addressed; never pass arbitrary file paths through MCP.
- [ ] Reconcile owner-assisted public URLs with receipts and 1h/48h/7d follow-up plans.
- [ ] Add per-channel artifact constraints before any upload adapter can be considered.

## Non-goals

- Credential storage or browser-session ownership.
- Channel login, CAPTCHA/2FA handling, stealth, or internal APIs.
- Publishing authority inferred from generated content.
- Project-specific recorder forks when a declarative manifest is sufficient.
