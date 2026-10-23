# Upstream fix intake

[简体中文](upstream-intake.zh-CN.md)

This repository is an independent fork. It does not merge `upstream/main` or
rebase onto upstream releases. Upstream bug fixes are imported one commit at a
time, on a dedicated branch, verified, and recorded before they reach `main`.

## Cadence

| When | What |
| --- | --- |
| Weekly | Review the report from `.github/workflows/upstream-intake.yml`, or run `bun run upstream:scan`. |
| Monthly | Import the selected fixes in one batch, each logical fix on its own branch. |
| Every import | Full verification, one ledger row in `UPSTREAM_IMPORTS.md`, then merge. |
| Emergency | Port a security or data-loss fix immediately, even outside the cadence. |

The weekly workflow only reads upstream and opens/comments on an Issue. It
never cherry-picks, commits, pushes, or merges.

## One-time setup

```sh
git remote add upstream https://github.com/tianma-if/edgeever.git
git fetch upstream main --tags
```

The scripts add the remote automatically when it is missing.

## Weekly scan

```sh
bun run upstream:scan            # fixes, perf, reverts, security
bun run upstream:scan -- --all   # every commit type, for the monthly review
bun run upstream:scan -- --json  # machine-readable
```

The scan uses `git cherry -v main upstream/main`, so commits that are already
patch-equivalent on this fork are not reported again. Use `git show <sha>` and
`git show --stat <sha>` to read the change.

To ignore a commit permanently:

```sh
bun run upstream:scan -- --skip <sha> --reason "Cloudflare-only, not used here"
bun run upstream:scan -- --list-skipped
```

The skip list lives in `.upstream-intake.json` and should be committed.

## What to import

| Import | Skip |
| --- | --- |
| Security, auth, permission, data-loss fixes | Branding, logos, README, i18n copy |
| Sync conflicts, import/export, backups, attachments | Upstream release commits and `release-summary.json` |
| Database consistency and migration repairs | Upstream workflows, signing, store delivery |
| Platform compatibility and dependency security | Pure refactors and large component rewrites |
| Bugs that affect a feature you actually ship | Features you do not need |

Only import a fix when you can explain which real problem it solves here.

## Monthly import

```sh
git switch main
git pull origin main

bun run upstream:import -- --sha <sha> --name <short-name>
```

The script:

1. requires a clean working tree and creates `upstream/<date>-<sha>-<name>`;
2. runs `git cherry-pick -x <sha>` so the upstream commit is recorded;
3. runs lint, both type checks, the web build, and the non-E2E regression suite;
4. optionally appends a row to `UPSTREAM_IMPORTS.md` with `--record`;
5. stops before merging or pushing.

If a cherry-pick conflicts, the script stops and leaves the conflict in place:

```sh
git status
# resolve the conflicts
git add <paths>
git cherry-pick --continue
```

To abandon:

```sh
git cherry-pick --abort
git switch main
git branch -D <branch>
```

For heavily customized files, prefer a manual minimal port over a conflict-heavy
cherry-pick. Add the upstream regression test when it applies. Record the manual
port with `bun run upstream:scan -- --skip <sha> --reason "manual port as <sha>"`.

## Verification

The import script runs these commands; run them again after any manual change:

```sh
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test
```

Additional checks by area:

- **Sync / conflicts**: offline writes, conflict recovery, old client with new server.
- **Migrations**: start the new version against an old database, not only a fresh one.
- **Auth**: login, session, token scopes, owner/member boundaries.
- **Resources**: upload, read, delete, backup, restore.

## Special files

- **`package.json` / `bun.lock`**: edit dependencies manually, run `bun install`,
  and let Bun regenerate the lockfile. Do not hand-merge lockfile hunks.
- **`migrations/`**: append only. Keep an upstream migration's original filename
  when the number is free; renumber only unapplied migrations on collision.
  Never rename a migration that has already run; the runtime tracks applied
  filenames.
- **`.github/workflows/`, release scripts, `release-summary.json`**: skip during
  import. This fork has its own CI and release path.

## Merge and release

```sh
git push -u origin <branch>
# review the PR, then:
git switch main
git merge --no-ff <branch>
git push origin main
```

Bug-fix imports ship as patch releases. Update `release-summary.json` whenever
the root `package.json` version changes; `bun run build:web` rejects a mismatch.

## Ledger

`UPSTREAM_IMPORTS.md` records the date, upstream commit, subject, method,
adaptations, verification, and branch. Keep it current: it is the audit trail
for future imports and for AGPL attribution.
