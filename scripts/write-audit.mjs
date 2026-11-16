#!/usr/bin/env node
/**
 * Write the public audit record of one publish:
 *
 *   publish.json  the live channel (what the site reads to auto-adopt a pin)
 *   staging.json  the staging channel (never adopted automatically)
 *
 * The record carries the source commit, the signed index digest, the signing
 * key fingerprint and the version-frozen path, so a published index is
 * traceable to one build run and one upstream revision (ADR 0008).
 *
 * Usage: node scripts/write-audit.mjs --site site --manifest artifact/manifest.json \
 *          --hide hide.json [--channel live] [--base-version 25.12.2] \
 *          [--target x86_64] [--source-commit <hex>] [--frozen-path /supplement/...] \
 *          [--promoted-from-staging false] [--out publish.json]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = {
    site: "",
    manifest: "",
    hide: "",
    channel: "live",
    target: "x86_64",
    baseVersion: "",
    sourceCommit: "",
    frozenPath: "",
    promotedFromStaging: "false",
    out: "",
    key: "",
    catalog: "",
  };
  const map = {
    "--site": "site",
    "--manifest": "manifest",
    "--hide": "hide",
    "--channel": "channel",
    "--target": "target",
    "--base-version": "baseVersion",
    "--source-commit": "sourceCommit",
    "--frozen-path": "frozenPath",
    "--promoted-from-staging": "promotedFromStaging",
    "--out": "out",
    "--key": "key",
    "--catalog": "catalog",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const field = map[flag];
    if (!field) throw new Error(`unknown option ${flag}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    args[field] = value;
    i += 1;
  }
  if (!args.site || !args.manifest || !args.hide) {
    throw new Error("usage: write-audit.mjs --site <dir> --manifest <json> --hide <json>");
  }
  if (args.channel !== "live" && args.channel !== "staging") {
    throw new Error(`--channel must be live or staging (got '${args.channel}')`);
  }
  args.out = args.out || (args.channel === "staging" ? "staging.json" : "publish.json");
  args.key = args.key || join(args.site, "keys", "combinewrt-feed.pub.pem");
  args.catalog = args.catalog || join(args.site, "catalog.json");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
const hide = JSON.parse(readFileSync(args.hide, "utf8"));
const catalog = JSON.parse(readFileSync(args.catalog, "utf8"));

const indexPath =
  args.channel === "staging" && args.frozenPath
    ? join(args.site, ...args.frozenPath.split("/").filter(Boolean), "packages.adb")
    : join(args.site, "x86_64", "packages.adb");
const indexBytes = readFileSync(indexPath);
const keyBytes = existsSync(args.key) ? readFileSync(args.key) : Buffer.alloc(0);

const buildRunId = String(manifest.buildRunId);
const audit = {
  schemaVersion: 2,
  channel: args.channel,
  buildRunId,
  buildRunNumber: Number(manifest.buildRunId),
  baseVersion: args.baseVersion || manifest.baseVersion,
  target: args.target,
  sourceCommit: args.sourceCommit || manifest.sourceCommit || "",
  arch: manifest.arch,
  generatedAt: manifest.generatedAt,
  publishedAt: new Date().toISOString(),
  frozenPath: args.frozenPath,
  keyFingerprint: keyBytes.length > 0 ? createHash("sha256").update(keyBytes).digest("hex") : "",
  promotedFromStaging: args.promotedFromStaging === "true",
  index: {
    file: args.channel === "staging" && args.frozenPath ? `${args.frozenPath.replace(/^\//, "")}/packages.adb` : "x86_64/packages.adb",
    sha256: createHash("sha256").update(indexBytes).digest("hex"),
    fileSize: statSync(indexPath).size,
  },
  packages: catalog.packages.flatMap((pkg) =>
    pkg.versions.map((version) => ({
      name: pkg.name,
      version: version.version,
      arch: version.arch,
      sha256: version.sha256,
      fileSize: version.fileSize,
      sourceRepo: pkg.sourceRepo,
      sourceCommit: pkg.sourceCommit,
      sourcePath: pkg.sourcePath,
    })),
  ),
  hidden: hide.hidden ?? [],
};

writeFileSync(join(args.site, args.out), `${JSON.stringify(audit, null, 2)}\n`);
console.log(
  `${args.out}: channel ${audit.channel}, build ${audit.buildRunId}, ${audit.packages.length} versions, index ${audit.index.sha256.slice(0, 12)}, key ${audit.keyFingerprint.slice(0, 12)}`,
);
