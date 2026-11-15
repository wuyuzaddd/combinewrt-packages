#!/usr/bin/env node
/**
 * Lay out a generated feed in the version-frozen site tree.
 *
 * The published site is the source of truth for what was ever served:
 *
 *   /x86_64/...                                  V1 flat channel (unchanged, still live)
 *   /supplement/<base>/<target>/...              live pointer for that base version
 *   /supplement/<base>/<target>/<commit>/...     frozen copy of one published index
 *   /staging/<base>/<target>/<commit>/...        staged copy that was never promoted
 *
 * Live publishes update the pointer and the flat channel; staging publishes only
 * add a staging directory, so the live index and its packages stay byte-identical
 * until a human re-dispatches the publish with publish_mode=live.
 *
 * Usage: node scripts/publish-site.mjs --generated gen --state site \
 *          --channel live --base-version 25.12.2 --target x86_64 \
 *          --source-commit <40 hex> --keep 20 [--kind supplement|extension]
 *
 * Prints `frozen_path=<path>` and `promoted_from_staging=<true|false>` for the
 * workflow to pass on to the audit record.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  return argv[index + 1];
}

export function parseOptions(argv) {
  const options = {
    generated: option(argv, "generated"),
    state: option(argv, "state"),
    channel: option(argv, "channel", "live"),
    baseVersion: option(argv, "base-version"),
    target: option(argv, "target", "x86_64"),
    sourceCommit: option(argv, "source-commit"),
    keep: Number(option(argv, "keep", "20")),
    kind: option(argv, "kind", "supplement"),
  };
  if (options.kind !== "supplement" && options.kind !== "extension") {
    throw new Error(`--kind must be supplement or extension (got '${options.kind}')`);
  }
  if (options.channel !== "live" && options.channel !== "staging") {
    throw new Error(`--channel must be live or staging (got '${options.channel}')`);
  }
  if (!COMMIT_PATTERN.test(options.sourceCommit ?? "")) {
    throw new Error(`--source-commit must be a 40 character lowercase git commit (got '${options.sourceCommit}')`);
  }
  if (!/^[0-9A-Za-z._-]+$/.test(options.baseVersion ?? "")) {
    throw new Error(`--base-version is not a safe path segment (got '${options.baseVersion}')`);
  }
  if (!/^[0-9A-Za-z._-]+$/.test(options.target)) {
    throw new Error(`--target is not a safe path segment (got '${options.target}')`);
  }
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error("--keep must be a positive integer");
  }
  for (const required of ["generated", "state"]) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  return options;
}

function copyDir(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    if (statSync(source).isDirectory()) copyDir(source, join(to, entry));
    else cpSync(source, join(to, entry));
  }
}

function copyFileIfPresent(from, to) {
  if (existsSync(from)) cpSync(from, to);
}

/**
 * Copy a generated tree over an existing directory, keeping subdirectories that
 * are not part of the generated feed.
 *
 * The live pointer (`/supplement/<base>/<target>`) is also the parent of the
 * frozen `<commit>/` directories, so replacing it wholesale would delete the
 * version-frozen copies the pointer is defined to keep. Only regular files are
 * replaced (and, with `prune`, removed when the new feed no longer ships them).
 */
function mergeContents(from, to, prune) {
  mkdirSync(to, { recursive: true });
  const entries = new Set(readdirSync(from));
  for (const entry of entries) {
    const source = join(from, entry);
    const target = join(to, entry);
    if (statSync(source).isDirectory()) mergeContents(source, target, prune);
    else cpSync(source, target);
  }
  if (!prune) return;
  for (const entry of readdirSync(to)) {
    if (entries.has(entry)) continue;
    const target = join(to, entry);
    if (statSync(target).isFile()) rmSync(target, { force: true });
  }
}

function frozenRoot(options) {
  if (options.kind === "extension") {
    // The extension feed has its own frozen tree and pin; a staging publish
    // must never collide with a staged supplement index either.
    return options.channel === "live" ? "extension" : "staging/extension";
  }
  return options.channel === "live" ? "supplement" : "staging";
}

/** Publish one generated feed into the site tree; returns the recorded paths. */
export function publishSite(options) {
  const generated = join(options.generated, "x86_64");
  if (!existsSync(join(generated, "packages.adb"))) {
    throw new Error(`${generated}/packages.adb is missing; sign the index before publishing`);
  }

  const root = frozenRoot(options);
  const frozenPath = posix.join("/", root, options.baseVersion, options.target, options.sourceCommit);

  let promotedFromStaging = false;
  let livePath = null;
  if (options.channel === "live") {
    const stagingDir = join(options.state, "staging", options.baseVersion, options.target, options.sourceCommit);
    promotedFromStaging = existsSync(stagingDir);

    livePath = posix.join("/", options.kind, options.baseVersion, options.target);
    mergeContents(generated, join(options.state, ...livePath.split("/").filter(Boolean)), true);

    if (options.kind === "supplement") {
      // V1 clients still read the flat channel; keep it byte-identical to the
      // live pointer so both URLs serve the same signed index. The extension
      // feed never touches it.
      mergeContents(generated, join(options.state, "x86_64"), true);

      copyFileIfPresent(join(options.generated, "catalog.json"), join(options.state, "catalog.json"));
      copyFileIfPresent(join(options.generated, "index.html"), join(options.state, "index.html"));
      copyFileIfPresent(join(options.generated, "hide.json"), join(options.state, "hide.json"));
      copyFileIfPresent(
        join(process.cwd(), "keys", "combinewrt-feed.pub.pem"),
        join(options.state, "keys", "combinewrt-feed.pub.pem"),
      );
    }
  }

  // Write the frozen copy last: copyDir replaces its destination directory and
  // the live pointer directory is the parent of the frozen path.
  copyDir(generated, join(options.state, ...frozenPath.split("/").filter(Boolean)));
  if (options.channel === "live") {
    pruneFrozen(join(options.state, options.kind, options.baseVersion, options.target), options.keep, new Set([]));
  }

  return { frozenPath, livePath, promotedFromStaging };
}

/** Keep the newest `keep` frozen commits; the live pointer and pointers in site pins are never pruned implicitly. */
function pruneFrozen(dir, keep, preserve) {
  if (!existsSync(dir)) return [];
  const dirs = readdirSync(dir)
    .filter((entry) => statSync(join(dir, entry)).isDirectory() && !preserve.has(entry))
    .map((entry) => ({ entry, mtime: statSync(join(dir, entry)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
  const removed = [];
  for (const stale of dirs.slice(keep)) {
    rmSync(join(dir, stale.entry), { recursive: true, force: true });
    removed.push(stale.entry);
  }
  return removed;
}

export function main(argv) {
  const options = parseOptions(argv);
  const result = publishSite(options);
  console.log(`kind: ${options.kind}`);
  console.log(`channel: ${options.channel}`);
  console.log(`frozen_path=${result.frozenPath}`);
  if (result.livePath) console.log(`live_path=${result.livePath}`);
  console.log(`promoted_from_staging=${result.promotedFromStaging}`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`publish-site: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
