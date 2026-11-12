#!/usr/bin/env node
/**
 * Verify that the signed apk index matches the generated catalog and that
 * every apk on disk still has the sha256 recorded in the manifest/catalog.
 *
 * Usage: node scripts/verify-feed.mjs --catalog site/catalog.json \
 *          --index site/x86_64/packages.adb --apk-tool /path/to/apk.static
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

function parseArgs(argv) {
  const args = { catalog: "", index: "", apkTool: "apk" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!value) throw new Error(`missing value for ${flag}`);
    if (flag === "--catalog") args.catalog = value;
    else if (flag === "--index") args.index = value;
    else if (flag === "--apk-tool") args.apkTool = value;
    else throw new Error(`unknown option ${flag}`);
    i += 1;
  }
  if (!args.catalog || !args.index) {
    throw new Error("usage: verify-feed.mjs --catalog <catalog.json> --index <packages.adb> [--apk-tool apk]");
  }
  return args;
}

function fail(message) {
  console.error(`verify-feed: ${message}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const catalog = JSON.parse(readFileSync(args.catalog, "utf8"));
const rawIndex = execFileSync(args.apkTool, ["adbdump", "--format", "json", args.index], {
  encoding: "utf8",
});
const index = JSON.parse(rawIndex);

if (!Array.isArray(index.packages)) fail("index has no packages array");
if (!Array.isArray(catalog.packages)) fail("catalog has no packages array");

const expected = new Map();
for (const pkg of catalog.packages) {
  for (const version of pkg.versions) {
    expected.set(`${pkg.name}@${version.version}`, {
      fileSize: version.fileSize,
      sha256: version.sha256,
      asset: version.asset,
    });
  }
}

const actual = new Map();
for (const pkg of index.packages) {
  const key = `${pkg.name}@${pkg.version}`;
  if (actual.has(key)) fail(`duplicate package in index: ${key}`);
  actual.set(key, pkg);
}

for (const key of expected.keys()) {
  if (!actual.has(key)) fail(`catalog entry missing from signed index: ${key}`);
}
for (const key of actual.keys()) {
  if (!expected.has(key)) fail(`signed index contains entry missing from catalog: ${key}`);
}

for (const [key, want] of expected) {
  const got = actual.get(key);
  if (got["file-size"] !== want.fileSize) {
    fail(`${key}: index file-size ${got["file-size"]} != catalog ${want.fileSize}`);
  }
  const file = join(dirname(args.index), want.asset);
  const size = statSync(file).size;
  if (size !== want.fileSize) fail(`${key}: ${want.asset} is ${size} bytes, catalog says ${want.fileSize}`);
  const digest = sha256(file);
  if (digest !== want.sha256) fail(`${key}: ${want.asset} sha256 ${digest} != ${want.sha256}`);
}

console.log(`verify-feed: ok — ${expected.size} package versions in catalog, index and on disk`);
