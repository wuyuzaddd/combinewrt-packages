#!/usr/bin/env node
/**
 * Write site/publish.json: a public audit record of what this deployment
 * contains. Runs after the index has been signed and verified.
 *
 * Usage: node scripts/write-audit.mjs --site site --manifest artifact/manifest.json --hide hide.json
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { site: "", manifest: "", hide: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === "--site") args.site = value;
    else if (argv[i] === "--manifest") args.manifest = value;
    else if (argv[i] === "--hide") args.hide = value;
    else throw new Error(`unknown option ${argv[i]}`);
    i += 1;
  }
  if (!args.site || !args.manifest || !args.hide) {
    throw new Error("usage: write-audit.mjs --site <dir> --manifest <json> --hide <json>");
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
const hide = JSON.parse(readFileSync(args.hide, "utf8"));
const catalog = JSON.parse(readFileSync(join(args.site, "catalog.json"), "utf8"));
const indexPath = join(args.site, "x86_64", "packages.adb");
const indexBytes = readFileSync(indexPath);

const audit = {
  schemaVersion: 1,
  buildRunId: manifest.buildRunId,
  baseVersion: manifest.baseVersion,
  arch: manifest.arch,
  generatedAt: manifest.generatedAt,
  publishedAt: new Date().toISOString(),
  index: {
    file: "x86_64/packages.adb",
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

writeFileSync(join(args.site, "publish.json"), `${JSON.stringify(audit, null, 2)}\n`);
console.log(
  `publish.json: build ${audit.buildRunId}, ${audit.packages.length} versions, index ${audit.index.sha256.slice(0, 12)}`,
);
