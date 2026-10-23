# Upstream Imports

This repository is an independent fork of [`tianma-if/edgeever`](https://github.com/tianma-if/edgeever). Upstream branches are **never merged**. Individual fixes are imported on dedicated branches, verified, recorded here, and only then merged into `main`.

Cadence:

- **Weekly**: review the report from `.github/workflows/upstream-intake.yml` (or run `bun run upstream:scan`).
- **Monthly**: batch-import the selected fixes with `bun run upstream:import -- --sha <sha>`.
- **Every import**: one branch, full verification, one ledger row, then merge.

See [docs/upstream-intake.md](docs/upstream-intake.md) for the full procedure and [docs/fork-maintenance.md](docs/fork-maintenance.md) for the broader fork rules.

| Date | Upstream commit | Subject | Method | Adaptations | Verification | Branch |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-23 | `eccda710` | Fork baseline | - | - | - | `main` |
