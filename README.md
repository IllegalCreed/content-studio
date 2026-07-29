# Content Studio

Content Studio is a cross-project content-production control plane. It turns a
small, versioned project manifest and a campaign brief into:

- platform-native content packages for a 19-channel inventory;
- an owner/API/content-only delivery classification without granting publishing authority;
- a deterministic video recording plan built from semantic project interactions;
- observable media jobs and local artifacts;
- a versioned handoff that can later be submitted to independent `marketing-ops`.

The default content engine is deterministic and uses only declared project facts. It does not require a paid LLM API, channel credentials, browser cookies, or modifications to the target project's business logic.

The future visual workspace is a control surface over the same reusable core. It
does not duplicate content generation, recording, composition, or publishing
logic in the browser application.

## Why this is cross-project

Target projects provide data, not recorder code:

- current product facts and localized positioning;
- canonical and repository URLs;
- reusable capture flows using role, label, text, or test-id locators.

Changing projects normally means adding another JSON manifest. Target source changes are only needed when the UI lacks a stable semantic locator or a reproducible demo state.

## Current MVP

```bash
corepack enable
pnpm install
pnpm verify
pnpm generate:example
```

The example writes:

```text
.content-studio/example/
├── bundle.json
├── content/
│   ├── bilibili.zh-CN.md
│   ├── github.en.md
│   └── ...
└── video/
    └── plan.json
```

V0.1 is complete. V0.2 is now focused on an observable, cancellable, retryable
Playwright recorder that consumes only the compiled semantic video plan. The
Vue 3 workspace follows the recorder contract instead of defining a second
execution path.

Use the CLI with another project:

```bash
pnpm build
node dist/cli.mjs validate \
  --project path/to/project.json \
  --campaign path/to/campaign.json

node dist/cli.mjs generate \
  --project path/to/project.json \
  --campaign path/to/campaign.json \
  --out .content-studio/my-campaign
```

## Safety boundary

Content Studio does not publish, log in, solve challenges, store credentials, or
run arbitrary browser scripts/selectors. Generated packages describe delivery
candidates only. Real publishing remains subject to the matching campaign
authorization and channel policy enforced by `marketing-ops`.

For owner-assisted channels, Content Studio may create a handoff and show
progress, while the Owner performs login, 2FA/CAPTCHA, review, and the final
publish click in the platform's official UI. The control plane may ingest the
resulting `marketing-ops` receipt; it never treats a generated package or an
Owner handoff as publishing authority.

See [product vision](docs/product-vision.md),
[architecture](docs/architecture.md), [control-plane model](docs/control-plane.md),
and [roadmap](docs/roadmap.md).

## Development

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm coverage
pnpm build
```

Package manager: pnpm 10.29.2. Runtime: Node.js 22 or newer. The project is pure ESM.
