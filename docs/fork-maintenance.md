# Independent fork maintenance

[简体中文](fork-maintenance.zh-CN.md)

This repository is an independent derivative of [EdgeEver](https://github.com/tianma-if/edgeever). It does **not** merge `upstream/main`, rebase onto upstream releases, or run the upstream mirror updater. Upstream changes are reviewed as individual commits and imported only when they solve a problem this fork actually ships.

## Repository model

| Ref | Purpose |
| --- | --- |
| `origin` | This fork (`tuigou888/edgeever-bijiapp`). |
| `upstream` | Read-only reference (`tianma-if/edgeever`); never merged. |
| `main` | Deployable product branch. |
| `upstream/<date>-<sha>-<name>` | One branch per import. |
| `vX.Y.Z` tags | This fork's releases, not upstream's version line. |

The former `.github/workflows/sync-edgeever-upstream.yml` mirror updater has been removed. It could snapshot-replace the managed product tree with an upstream release, which conflicts with independent development.

## Cadence

| When | Action |
| --- | --- |
| Weekly | Review the `Upstream intake` Issue, or run `bun run upstream:scan`. |
| Monthly | Import the selected fixes with `bun run upstream:import`. |
| Every import | One branch, full verification, one ledger row, then merge. |
| Emergency | Port security or data-loss fixes immediately, outside the cadence. |

The detailed procedure, selection criteria, conflict guidance, and migration rules live in [upstream-intake.md](upstream-intake.md).

## Weekly scan

```sh
bun run upstream:scan
bun run upstream:scan -- --all    # monthly review, every commit type
bun run upstream:scan -- --json   # machine-readable
```

The scan compares `main` with `upstream/main` using `git cherry`, so commits already applied in patch-equivalent form are not reported again. Commits that are intentionally not imported are recorded in `.upstream-intake.json`:

```sh
bun run upstream:scan -- --skip <sha> --reason "not applicable to this fork"
bun run upstream:scan -- --list-skipped
```

The scheduled workflow `.github/workflows/upstream-intake.yml` only reads upstream and opens or comments on an Issue. It never cherry-picks, commits, pushes, or merges.

## Monthly import

```sh
git switch main
git pull origin main

bun run upstream:import -- --sha <sha> --name <short-name>
```

The script:

1. requires a clean working tree;
2. creates `upstream/<date>-<sha>-<name>` from `main`;
3. runs `git cherry-pick -x <sha>`;
4. runs lint, both type checks, the web build, and the non-E2E regression suite;
5. optionally appends a ledger row with `--record`;
6. stops before merging or pushing.

If a cherry-pick conflicts, the script stops and leaves the conflict in place:

```sh
git status
# resolve the conflicts
git add <paths>
git cherry-pick --continue
```

To abandon the import:

```sh
git cherry-pick --abort
git switch main
git branch -D <branch>
```

After verification:

```sh
git push -u origin <branch>
# review the pull request, then:
git switch main
git merge --no-ff <branch>
git push origin main
```

## Verification gates

Every import must pass:

```sh
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test
```

Area-specific checks:

- **Sync / conflicts**: offline writes, conflict recovery, old client with new server.
- **Migrations**: start the new version against an old database, not only a fresh one.
- **Auth**: login, session, token scopes, owner/member boundaries.
- **Resources**: upload, read, delete, backup, restore.

## Release and deployment

- Version: root `package.json`.
- `release-summary.json` must match that version and contain an `en-US` entry; `bun run build:web` rejects a mismatch.
- Mobile changes also require `apps/mobile/app.json` (`expo.version`, `android.versionCode`).
- Docker deployment uses `compose.yaml` plus this fork's `compose.override.yaml`.
- Do **not** use `bun scripts/release.mjs`: it defaults to the upstream repository and orchestrates upstream release workflows, native-asset audits, and signing checks.
- Do **not** run the upstream release, store-delivery, or mirror workflows. They assume official secrets and certificates.

## Branding and distribution identity

Change user-visible branding first:

- `packages/shared/src/i18n/*.ts` (`appName` and related copy)
- `apps/web/index.html`
- the PWA manifest in `apps/web/vite.config.ts`
- `assets/brand/*`, then `bun run prepare:brand:icons`
- default notebooks, templates, and AI prompts

If this fork ships its own desktop or mobile clients, also change:

- `apps/desktop/electron-builder.yml` (`appId`, `productName`, `publish.owner/repo`)
- desktop update and diagnostics URLs
- `apps/mobile/app.json` (name, slug, scheme, EAS owner/project, bundle ID, package, update URL)
- `apps/mobile/src/lib/mobile-release.ts` (GitHub release feed)
- iOS bundle identifiers and the extension store metadata

Keep internal identifiers such as the `EDGE_EVER_*` environment prefix, table names, API paths, and storage keys. They have no user-facing value and renaming them increases maintenance cost.

## Licensing

The project is licensed under **AGPL-3.0**. Keep `LICENSE`, retain copyright notices, and record modifications. If a modified version is offered as a network service, make the corresponding source available to its users. Add a `NOTICE` that names the upstream project and the modifications.

## Ledger and state

| File | Purpose |
| --- | --- |
| `UPSTREAM_IMPORTS.md` | Human audit trail: date, upstream commit, subject, method, adaptations, verification, branch. |
| `.upstream-intake.json` | Commits intentionally skipped, with reasons. |
| `docs/upstream-intake.md` | Detailed intake procedure. |

Commit both files so the next import starts from the same decisions.

## Emergency security fixes

1. Read the upstream commit and its tests.
2. Create the import branch immediately.
3. If the cherry-pick is conflict-heavy, port the minimal logic manually and add a regression test.
4. Run the full verification suite plus the affected area checks.
5. Record the commit in `UPSTREAM_IMPORTS.md`, merge, and release a patch version.

## Command reference

```sh
# Weekly
bun run upstream:scan
bun run upstream:scan -- --all
bun run upstream:scan -- --skip <sha> --reason "<reason>"

# Monthly
bun run upstream:import -- --sha <sha> --name <short-name>
bun run upstream:import -- --sha <sha> --record

# Verification
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test

# Docker deployment
EDGE_EVER_AUTH_PASSWORD='<strong-password>' \
  docker compose -f compose.yaml -f compose.override.yaml up -d --build
```
