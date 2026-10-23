#!/usr/bin/env node
/**
 * Lists upstream fixes that are not patch-equivalent to anything on this fork.
 *
 * This repository is an independent fork: it never merges upstream branches.
 * The scan is read-only; importing is a separate, manual step.
 *
 * Usage:
 *   node scripts/upstream-intake.mjs
 *   node scripts/upstream-intake.mjs --all
 *   node scripts/upstream-intake.mjs --markdown
 *   node scripts/upstream-intake.mjs --json
 *   node scripts/upstream-intake.mjs --skip <sha> --reason "not applicable"
 *   node scripts/upstream-intake.mjs --list-skipped
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const UPSTREAM_REPOSITORY = "tianma-if/edgeever";
const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPOSITORY}.git`;
const DEFAULT_STATE_FILE = ".upstream-intake.json";
const DEFAULT_TYPES = new Set(["fix", "perf", "revert", "security", "hotfix"]);
const SECURITY_HINT = /\b(?:security|cve-\d{4}-\d+|vulnerab\w*|hotfix)\b/i;

const HIGH_RISK_PATHS = [
  /^migrations\//,
  /^apps\/api\/src\/(?:auth|sync|storage|secret|backup|workspace-provisioning|resource-upload|share-password)/,
  /^apps\/web\/src\/lib\/(?:sync-queue|repository|local-mirror|local-db|local-database-recovery|api|desktop-repository)\./,
  /^packages\/shared\/src\/(?:sync|schemas|desktop-rpc)\./,
  /^apps\/desktop\/src\/main\/(?:update|rpc|session|renderer|account-scope)\./,
  /^apps\/mobile\/src\/lib\/mobile-release\./,
  /^scripts\/(?:release|self-hosted|cloudflare|build-cloudflare-worker|plan-native-release|upstream)/,
  /^\.github\/workflows\//,
  /^package\.json$/,
  /^bun\.lock$/,
];

const MEDIUM_RISK_PATHS = [
  /^apps\/api\/src\//,
  /^apps\/web\/src\//,
  /^apps\/desktop\//,
  /^apps\/mobile\//,
  /^apps\/ios\//,
  /^apps\/extension\//,
  /^packages\/(?:shared|client|plugin-api|public-network)\/src\//,
];

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const root = git(["rev-parse", "--show-toplevel"]).trim();
process.chdir(root);

ensureUpstreamRemote();
if (!options.noFetch) {
  fetchUpstream();
}

if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
  fail("This is a shallow clone. Fetch full history before scanning (git fetch --unshallow).");
}

const statePath = resolve(root, options.state ?? DEFAULT_STATE_FILE);
const state = readState(statePath);

if (options.skip.length > 0) {
  for (const value of options.skip) {
    const sha = resolveSha(value);
    state.skipped[sha] = {
      reason: options.reason ?? "",
      date: today(),
    };
  }
  writeState(statePath, state);
  console.log(`Marked ${options.skip.length} commit(s) as skipped in ${statePath}.`);
}

if (options.unskip.length > 0) {
  for (const value of options.unskip) {
    const sha = resolveSha(value);
    delete state.skipped[sha];
  }
  writeState(statePath, state);
  console.log(`Removed ${options.unskip.length} commit(s) from the skip list.`);
}

if (options.listSkipped) {
  const entries = Object.entries(state.skipped).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    console.log("No skipped upstream commits.");
  } else {
    console.log("| SHA | Date | Reason |");
    console.log("| --- | --- | --- |");
    for (const [sha, entry] of entries) {
      console.log(`| \`${sha.slice(0, 12)}\` | ${entry.date || ""} | ${entry.reason || ""} |`);
    }
  }
  process.exit(0);
}

const baseRef = options.base ?? "main";
const targetRef = options.since ?? "upstream/main";
const candidates = collectCandidates({ baseRef, targetRef, state, includeAll: options.all });
const skippedCount = Object.keys(state.skipped).length;

if (options.json) {
  process.stdout.write(`${JSON.stringify({
    generatedAt: new Date().toISOString(),
    upstreamRepository: UPSTREAM_REPOSITORY,
    baseRef,
    targetRef,
    skippedCount,
    candidates,
  }, null, 2)}\n`);
} else if (options.markdown) {
  printMarkdown({ candidates, baseRef, targetRef, skippedCount });
} else {
  printText({ candidates, skippedCount });
}

if (candidates.length === 0 && options.exitCodeIfEmpty) {
  process.exit(3);
}

function parseOptions(argv) {
  const result = {
    all: false,
    json: false,
    markdown: false,
    noFetch: false,
    help: false,
    listSkipped: false,
    exitCodeIfEmpty: false,
    base: undefined,
    since: undefined,
    state: undefined,
    reason: undefined,
    skip: [],
    unskip: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--all":
        result.all = true;
        break;
      case "--json":
        result.json = true;
        break;
      case "--markdown":
        result.markdown = true;
        break;
      case "--no-fetch":
        result.noFetch = true;
        break;
      case "--list-skipped":
        result.listSkipped = true;
        break;
      case "--exit-code-if-empty":
        result.exitCodeIfEmpty = true;
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--base":
        result.base = requireValue(argv, ++index, argument);
        break;
      case "--since":
        result.since = requireValue(argv, ++index, argument);
        break;
      case "--state":
        result.state = requireValue(argv, ++index, argument);
        break;
      case "--reason":
        result.reason = requireValue(argv, ++index, argument);
        break;
      case "--skip":
        result.skip.push(requireValue(argv, ++index, argument));
        break;
      case "--unskip":
        result.unskip.push(requireValue(argv, ++index, argument));
        break;
      default:
        fail(`Unknown option: ${argument}`);
    }
  }

  if ((result.json ? 1 : 0) + (result.markdown ? 1 : 0) > 1) {
    fail("Choose either --json or --markdown.");
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

function collectCandidates({ baseRef, targetRef, state, includeAll }) {
  const output = git(["cherry", "-v", baseRef, targetRef], { allowFailure: true });
  const candidates = [];

  for (const line of output.split("\n")) {
    const match = line.match(/^([+-])\s+([0-9a-f]{7,40})\s+(.*)$/);
    if (!match || match[1] !== "+") continue;

    const sha = resolveSha(match[2]);
    const subject = match[3].trim();
    if (!subject || state.skipped[sha]) continue;
    if (isMergeCommit(sha)) continue;

    const type = commitType(subject);
    if (!includeAll && !isDefaultCandidate(type, subject)) continue;

    const files = changedFiles(sha);
    candidates.push({
      sha,
      shortSha: sha.slice(0, 7),
      date: git(["show", "-s", "--format=%cs", sha]).trim(),
      type: type || "other",
      subject,
      files,
      risk: classifyRisk(files),
      url: `https://github.com/${UPSTREAM_REPOSITORY}/commit/${sha}`,
    });
  }

  return candidates;
}

function isDefaultCandidate(type, subject) {
  return DEFAULT_TYPES.has(type) || SECURITY_HINT.test(subject);
}

function commitType(subject) {
  const match = subject.match(/^([a-zA-Z]+)(?:\([^)]*\))?!?:/);
  return match ? match[1].toLowerCase() : "";
}

function isMergeCommit(sha) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).trim().split(/\s+/);
  return parents.length > 2;
}

function changedFiles(sha) {
  return git(["show", "--name-only", "--format=", sha])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyRisk(files) {
  if (files.some((file) => HIGH_RISK_PATHS.some((pattern) => pattern.test(file)))) {
    return "high";
  }
  if (files.some((file) => MEDIUM_RISK_PATHS.some((pattern) => pattern.test(file)))) {
    return "medium";
  }
  return "low";
}

function printText({ candidates, skippedCount }) {
  console.log(`Upstream: ${UPSTREAM_REPOSITORY} (upstream/main)`);
  console.log(`Base: main`);
  console.log(`Candidates: ${candidates.length} not imported, ${skippedCount} skipped`);
  if (candidates.length === 0) {
    console.log("No new upstream fixes.");
    return;
  }
  console.log("");
  for (const candidate of candidates) {
    console.log(`[${candidate.risk}] ${candidate.shortSha} ${candidate.date} ${candidate.subject}`);
    console.log(`  ${candidate.url}`);
    console.log(`  files: ${candidate.files.length}`);
  }
}

function printMarkdown({ candidates, baseRef, targetRef, skippedCount }) {
  console.log("## Upstream intake scan");
  console.log("");
  console.log(`- Upstream: \`${UPSTREAM_REPOSITORY}\``);
  console.log(`- Compared: \`${baseRef}\` → \`${targetRef}\``);
  console.log(`- Generated: ${new Date().toISOString()}`);
  console.log(`- Candidates: **${candidates.length}** not imported, ${skippedCount} skipped`);
  console.log("");

  if (candidates.length === 0) {
    console.log("No new upstream fixes.");
    return;
  }

  console.log("| SHA | Date | Type | Risk | Subject | Files |");
  console.log("| --- | --- | --- | --- | --- | ---: |");
  for (const candidate of candidates) {
    const subject = candidate.subject.replaceAll("|", "\\|");
    console.log(`| [\`${candidate.shortSha}\`](${candidate.url}) | ${candidate.date} | ${candidate.type} | ${candidate.risk} | ${subject} | ${candidate.files.length} |`);
  }
  console.log("");
  console.log("<details>");
  console.log("<summary>Changed files</summary>");
  console.log("");
  for (const candidate of candidates) {
    console.log(`- \`${candidate.shortSha}\`: ${candidate.files.map((file) => `\`${file}\``).join(", ")}`);
  }
  console.log("");
  console.log("</details>");
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
    git(["remote", "add", "upstream", UPSTREAM_URL]);
    return;
  }
  if (!url.includes("tianma-if/edgeever")) {
    console.warn(`Warning: upstream remote points at ${url}, not ${UPSTREAM_URL}.`);
  }
}

function resolveSha(value) {
  const sha = git(["rev-parse", "--verify", `${value}^{commit}`], { allowFailure: true }).trim();
  if (!sha) fail(`Unknown commit: ${value}. Run "bun run upstream:scan" first.`);
  return sha;
}

function readState(path) {
  if (!existsSync(path)) {
    return { upstreamRepository: UPSTREAM_REPOSITORY, skipped: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      upstreamRepository: parsed.upstreamRepository ?? UPSTREAM_REPOSITORY,
      skipped: parsed.skipped && typeof parsed.skipped === "object" ? parsed.skipped : {},
    };
  } catch (error) {
    fail(`Cannot read ${path}: ${error.message}`);
  }
}

function writeState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
  console.log(`List upstream fixes that are not patch-equivalent to this fork.

Usage:
  node scripts/upstream-intake.mjs [options]

Options:
  --all                 Include every commit type, not only fixes/security/perf.
  --json                Machine-readable output.
  --markdown            GitHub-flavored report.
  --base <ref>          Local base branch (default: main).
  --since <ref>         Upstream ref to compare (default: upstream/main).
  --state <path>        Skip-state file (default: .upstream-intake.json).
  --skip <sha>          Mark a commit as intentionally not imported. Repeatable.
  --reason <text>       Reason stored with --skip.
  --unskip <sha>        Remove a commit from the skip list. Repeatable.
  --list-skipped        Print the skip list.
  --no-fetch            Do not fetch upstream before scanning.
  --exit-code-if-empty  Exit with 3 when there are no candidates.
  --help                Show this message.

The scan never modifies branches and never cherry-picks.`);
}
