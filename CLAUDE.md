# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork context

This repository is a fork (`origin: tuigou888/edgeever-bijiapp`) of `tianma-if/edgeever`, kept for derivative development; `main` carries product changes and is also the deployment branch. `upstream` is a **read-only reference remote**; upstream branches are never merged. The former `.github/workflows/sync-edgeever-upstream.yml` mirror updater has been removed, so upstream fixes must be imported explicitly through the intake workflow described below.

`LICENSE` is AGPL-3.0; network use of a modified version carries source-availability obligations. Upstream-owned identifiers are still wired into update and release paths (`tianma-if/edgeever` release feeds in mobile/desktop, `org.edgeever.*` bundle IDs, EAS project/owner, GHCR image reference); change them before shipping a renamed or self-updated client.

## Upstream intake

This fork never merges upstream branches. Upstream fixes are scanned weekly (`bun run upstream:scan`, also `.github/workflows/upstream-intake.yml`) and imported monthly one logical fix at a time (`bun run upstream:import -- --sha <sha>`). Each import uses its own branch, must pass the full verification suite, and needs a row in `UPSTREAM_IMPORTS.md` before merging. Skipped commits are recorded in `.upstream-intake.json`. Detailed procedure: `docs/upstream-intake.md` / `docs/upstream-intake.zh-CN.md`. Fork-wide rules: `docs/fork-maintenance.md` / `docs/fork-maintenance.zh-CN.md`.

## Authoritative project rules

`AGENTS.md` (root) and `apps/site/AGENTS.md` already load as project instructions. They are the binding rules for risk assessment, bilingual documentation sync, release constraints, migrations, Android real-device testing, GitHub communication language, and UX/design conventions. Follow them; this file covers commands and architecture only.

## Commands

All commands run with [Bun](https://bun.sh) (`bun@1.3.14`, pinned in `package.json`).

```sh
bun install
bun run dev                 # local profile: migrations + API (127.0.0.1:8787) + web (127.0.0.1:5173)
bun run dev:web             # web only (only when explicitly asked)
bun run dev:desktop         # web + Electron shell
bun run dev:mobile:android  # Expo Android on a USB device
EDGE_EVER_INSTANCE=<name> bun run dev:remote   # API against a remote instance
```

```sh
bun run test                # non-E2E regression suite (test:bulk + test:integration)
bun test path/to/file.test.ts                  # single test file
bun test --test-name-pattern "case name" path # single test case
bun run test:e2e            # Playwright; install browsers once with bun run test:e2e:install
bun run lint                # oxlint, warnings are failures
bun run typecheck           # root TS project (web + api + shared + client + desktop)
bun run typecheck:mobile    # apps/mobile only
bun run build:web
bun run build:cloudflare    # typecheck + web build + Worker bundle
```

Test files are co-located with the source (`*.test.ts`, `*.test.mjs`, using `bun:test`), with cross-cutting tests in `tests/` and release/deploy tooling tests in `scripts/*.test.mjs`. `test:integration` runs the heavier API and desktop suites that the bulk command excludes.

## Architecture

### Monorepo shape

- `apps/api` — the single Hono application. Business logic and routes live here.
- `apps/web` — React 19 + Vite + React Router + TanStack Query. This renderer is also reused verbatim by the Electron desktop app.
- `packages/shared` — isomorphic domain logic: Markdown/Tiptap content, schemas, sync, notebooks/memos, diagrams, i18n, plugin capability contracts.
- `packages/client` — the typed API client and direct AI-provider orchestration used by web, desktop, mobile, iOS, and the extension.
- `packages/plugin-api` — public plugin/theme contracts (published package).
- `packages/public-network` — runtime-neutral outbound-network policy.
- `apps/desktop` — Electron main/preload. `crates/desktop-sidecar` — Rust/Rusqlite sidecar owning the desktop local database.
- `apps/mobile` — Expo/React Native Android app; `apps/ios` — native SwiftUI iOS app (separate codebase and build chain).
- `apps/extension` — browser web clipper; `apps/site` — Astro marketing site.
- `migrations` — append-only SQL applied by both D1 and the self-hosted SQLite runtime.
- `scripts` — dev, build, deploy, store-delivery, and release tooling.

### One app, two runtimes

`apps/api/src/index.ts` exports both the Cloudflare Worker default entry and `fetchEdgeEverApp(request, deps)`. The API depends only on the contracts in `apps/api/src/storage-contract.ts` (`DatabaseAdapter`, `BlobStoreAdapter`); provider SDK types must not leak into routes or services.

- **Cloudflare**: `wrangler.toml` uses `no_bundle`; `scripts/build-cloudflare-worker.mjs` esbuilds the Hono app into `.wrangler/edgeever-worker`, and `apps/web/dist` is served as Worker assets.
- **Docker/self-hosted**: `scripts/self-hosted-server.mjs` opens SQLite, applies `migrations/*.sql` itself, and injects `self-hosted-storage-adapter.ts` (SQLite + filesystem or S3) into the same `fetchEdgeEverApp`. PostgreSQL contracts exist but are intentionally unimplemented.

Keep `/api/health`, `/api/openapi.json`, `/api/*`, and `/mcp` reachable; they are deployment probes and compatibility surfaces.

### Routing and auth

Route modules register on the Hono app via `register*Routes(app, deps)`. Authenticated endpoints live under `/api/v1/*`, unauthenticated sharing/forms/publishing under `/api/public/*`, and MCP JSON-RPC at `/mcp`. `api-context.ts` defines `Bindings`/`WorkerBindings`; every row is scoped to a `workspaceId` from `AuthContext`. User sessions and API tokens share the same scope model (`request-auth.ts`).

### Web data flow (offline-first)

`createRepository(scope)` in `apps/web/src/lib/repository.ts` picks the implementation:

- Browser: `createWebRepository` → Dexie/IndexedDB local mirror (`local-mirror.ts`, `local-db.ts`) plus an outbox (`sync-queue.ts`), with server reconciliation through `/api/v1/sync/*`.
- Electron: `createDesktopRepository`, backed by the desktop bridge and Rust sidecar.

Writes update the local mirror and queue first, then sync. Conflict safety relies on expected `revision` + `contentHash` and edit-session ids — preserve these fields when touching save paths.

### Desktop

Electron owns the window/OS lifecycle; the renderer runs the built web app with `EDGEEVER_DESKTOP_BUILD=1` (HashRouter, desktop preload bridge) and never gets Node access. The sidecar protocol is versioned in `packages/shared/src/desktop-rpc.ts` (`DESKTOP_RPC_METHODS`, protocol 2); changing RPC methods requires updating both the Rust side and the renderer bridge. Packaging/auto-update/signing details live in `apps/desktop/README.md` and `docs/release.md`.

### AI requests

AI calls are client-direct by default: `packages/client/src/ai-provider-direct.ts` / `ai-direct-stream.ts`. Web retries the **initial** fetch through the authenticated instance relay only on a browser network/CORS failure (`ai-provider-relay.ts`); HTTP errors or a started stream must never trigger a second model call. Desktop and native mobile always connect directly. Server-side credentials are AES-GCM ciphertext derived from instance secrets.

### Plugins and themes

`@edgeever/plugin-api` defines manifests; the host runtime is `apps/web/src/lib/plugins/plugin-host.ts`, with server-side workspace extension state in `workspace_extensions` (`workspace-extension-routes.ts`). Plugins are a trusted-code model and run on Web/desktop only.

### Internationalization and docs

UI locales are `zh-CN` (default), `en-US`, `ja`, `pl`, defined in `packages/shared/src/i18n/locales.ts` and `apps/web/src/i18n`. READMEs exist in five languages. Many `docs/*` files have a `.zh-CN` counterpart; update both sides when editing.

### Releases and versions

Version lives in root `package.json`; mobile changes also require `apps/mobile/app.json` (`expo.version`, `android.versionCode`). Native asset rebuild/reuse is decided by `scripts/plan-native-release.mjs`. Run `bun scripts/release.mjs --bump patch|minor|major` only as described in `AGENTS.md` and `docs/release.md`.
