#!/usr/bin/env node
/**
 * Imports selected upstream fixes onto a dedicated branch.
 *
 * The script creates one branch per import, cherry-picks with `-x`, runs the
 * full non-E2E verification suite, and stops before merging. `main` is never
 * modified automatically.
 *
 * Usage:
 *   node scripts/upstream-import.mjs --sha <sha>
 *   node scripts/upstream-import.mjs --sha <sha> --sha <sha> --name sync-fixes
 *   node scripts/upstream-import.mjs --sha <sha> --record
 *   node scripts/upstream-import.mjs --sha <sha> --dry-run
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BASE = "main";
const LEDGER_FILE = "UPSTREAM_IMPORTS.md";
const VERIFICATIONS = [
  { label: "Lint", command: ["bun", "run", "lint"] },
  { label: "Typecheck", command: ["bun", "run", "typecheck"] },
  { label: "Typecheck mobile", command: ["bun", "run", "typecheck:mobile"] },
  { label: "Build web", command: ["bun", "run", "build:web"] },
  { label: "Regression tests", command: ["bun", "run", "test"] },
];

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const shas = options.sha
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter(Boolean);

if (shas.length === 0) {
  fail("Provide at least one upstream commit with --sha <sha>.");
}

const root = git(["rev-parse", "--show-toplevel"]).trim();
process.chdir(root);

if (!options.noFetch) {
  ensureUpstreamRemote();
  fetchUpstream();
}

const resolvedShas = shas.map((value) => resolveSha(value));
const base = options.base ?? DEFAULT_BASE;
const nameSuffix = options.name?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const branch = options.branch ?? `upstream/${today()}-${resolvedShas[0].slice(0, 7)}${nameSuffix ? `-${nameSuffix}` : ""}`;

if (branch === base || branch === "main") {
  fail("Refusing to import directly onto main. Choose another branch name.");
}

if (options.dryRun) {
  console.log(`Would create branch: ${branch} (from ${base})`);
  for (const sha of resolvedShas) {
    console.log(`Would cherry-pick: ${sha} ${subjectOf(sha)}`);
  }
  if (!options.noVerify) {
    console.log("Would verify:");
    for (const step of VERIFICATIONS) {
      console.log(`  ${step.command.join(" ")}`);
    }
  }
  process.exit(0);
}

const dirty = git(["status", "--porcelain"]).trim();
if (dirty) {
  fail("Working tree is not clean. Commit or stash changes before importing.");
}

if (git(["rev-parse", "--verify", branch], { allowFailure: true }).trim()) {
  fail(`Branch already exists: ${branch}`);
}

console.log(`Creating ${branch} from ${base}...`);
git(["switch", "-c", branch, base]);

for (const sha of resolvedShas) {
  console.log(`\nCherry-picking ${sha} ${subjectOf(sha)}`);
  const result = spawnSync("git", ["cherry-pick", "-x", sha], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`
Cherry-pick stopped. Resolve the conflicts, then continue:

  git status
  # edit the conflicted files
  git add <paths>
  git cherry-pick --continue

To abandon this import:

  git cherry-pick --abort
  git switch ${base}
  git branch -D ${branch}
`);
    process.exit(result.status ?? 1);
  }
}

if (!options.noVerify) {
  for (const step of VERIFICATIONS) {
    console.log(`\n>>> ${step.label}: ${step.command.join(" ")}`);
    const result = spawnSync(step.command[0], step.command.slice(1), { stdio: "inherit" });
    if (result.error) {
      console.error(`Failed to run ${step.command.join(" ")}: ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(`
Verification failed: ${step.label}

Fix the failure on ${branch}. Do not merge until every check passes.
Re-run the remaining checks with:

  ${step.command.join(" ")}
`);
      process.exit(result.status ?? 1);
    }
  }
}

if (options.record) {
  recordLedger(resolvedShas);
}

console.log(`
Import branch ready: ${branch}

Next steps:
  1. Review the diff against ${base}.
  2. Record the adaptation and verification in ${LEDGER_FILE}.
  3. Push: git push -u origin ${branch}
  4. Open a pull request targeting ${base}, or merge locally:
       git switch ${base}
       git merge --no-ff ${branch}

Nothing has been merged or pushed by this script.`);

function recordLedger(shas) {
  const path = resolve(root, LEDGER_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, [
      "# Upstream Imports",
      "",
      "Independent fork of `tianma-if/edgeever`. Upstream fixes are imported commit by commit; upstream branches are never merged.",
      "",
      "| Date | Upstream commit | Subject | Method | Adaptations | Verification | Branch |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "",
    ].join("\n"), "utf8");
  }

  const current = readFileSync(path, "utf8");
  const rows = shas.map((sha) => {
    const subject = subjectOf(sha).replaceAll("|", "\\|");
    return `| ${today()} | \`${sha.slice(0, 12)}\` | ${subject} | \`git cherry-pick -x\` | (fill in) | lint/typecheck/build/test | \`${branch}\` |`;
  });
  const next = `${current.replace(/\s*$/, "")}\n${rows.join("\n")}\n`;
  writeFileSync(path, next, "utf8");
  console.log(`Appended ${rows.length} row(s) to ${LEDGER_FILE}. Commit the ledger entry with the import.`);
}

function subjectOf(sha) {
  return git(["show", "-s", "--format=%s", sha]).trim();
}

function resolveSha(value) {
  const sha = git(["rev-parse", "--verify", `${value}^{commit}`], { allowFailure: true }).trim();
  if (!sha) {
    fail(`Unknown commit: ${value}. Run "bun run upstream:scan -- --all" first.`);
  }
  return sha;
}

function fetchUpstream() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      execFileSync("git", ["fetch", "upstream", "main", "--tags"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`git fetch attempt ${attempt} failed; retrying...`);
      }
    }
  }
  const stderr = lastError?.stderr?.toString().trim();
  fail(`git fetch upstream failed${stderr ? `: ${stderr}` : ""}`);
}

function ensureUpstreamRemote() {
  const url = git(["remote", "get-url", "upstream"], { allowFailure: true }).trim();
  if (!url) {
    git(["remote", "add", "upstream", "https://github.com/tianma-if/edgeever.git"]);
  }
}

function parseOptions(argv) {
  const result = {
    sha: [],
    base: undefined,
    branch: undefined,
    name: undefined,
    noVerify: false,
    noFetch: false,
    record: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--sha":
        result.sha.push(requireValue(argv, ++index, argument));
        break;
      case "--base":
        result.base = requireValue(argv, ++index, argument);
        break;
      case "--branch":
        result.branch = requireValue(argv, ++index, argument);
        break;
      case "--name":
        result.name = requireValue(argv, ++index, argument);
        break;
      case "--no-verify":
        result.noVerify = true;
        break;
      case "--no-fetch":
        result.noFetch = true;
        break;
      case "--record":
        result.record = true;
        break;
      case "--dry-run":
        result.dryRun = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      default:
        fail(`Unknown option: ${argument}`);
    }
  }

  return result;
}

function requireValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    fail(`${option} requires a value.`);
  }
  return value;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function git(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowFailure) return "";
    const stderr = error.stderr?.toString().trim();
    fail(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Import selected upstream fixes onto a dedicated branch.

Usage:
  node scripts/upstream-import.mjs --sha <sha> [options]

Options:
  --sha <sha>       Upstream commit to cherry-pick. Repeatable or comma-separated.
  --base <ref>      Base branch (default: main).
  --branch <name>   Explicit branch name.
  --name <suffix>   Suffix appended to the generated branch name.
  --record          Append rows to UPSTREAM_IMPORTS.md.
  --no-verify       Skip lint/typecheck/build/test (not recommended).
  --no-fetch        Do not fetch upstream first.
  --dry-run         Print the plan without changing the repository.
  --help            Show this message.

The script never merges into ${DEFAULT_BASE} and never pushes.`);
}
