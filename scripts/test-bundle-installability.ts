#!/usr/bin/env -S npx tsx
// Real bundle installability test (ticket 12 hardening).
//
// Expands every curated extension bundle to its package list and proves the
// dependency closure with a real `apk add --simulate` against the target base
// version's official indexes plus the project's published feed indexes.
//
// The workflow preflight in the image build stays authoritative for a concrete
// plan; this test is the catalogue-level gate: every bundle must be installable
// on the target it declares, independent of which plan selects it.
//
// Failures are structured exactly as the ticket asks:
//   bundle=<id> package=<name> target=<target>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { failedPackage, failureMarker } from "../src/bundle-installability.js";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  return process.argv[index + 1];
}

const bundlesSource = option("bundles");
const baseVersion = option("base-version", "25.12.2");
const target = option("target", "x86/64");
const feedBase = option("feed-base", "https://wuyuzaddd.github.io/combinewrt-packages");
const dllkidsBase = option("dllkids-feed", "https://down.dllkids.xyz/openwrt-feed/25.12");
const apkTool = resolve(option("apk-tool"));
const workDir = resolve(option("work-dir", "bundle-installability"));
const outPath = option("out", "bundle-installability.json");
const officialBase = option("official-base", "https://downloads.immortalwrt.org");

const ARCH = "x86_64";
const [targetArch, targetSub] = target.split("/");
if (!targetArch || !targetSub) throw new Error(`invalid --target ${target}`);

function log(message) {
  console.log(`bundle-installability: ${message}`);
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

const bundlesText = /^https?:\/\//.test(bundlesSource)
  ? await (await fetch(bundlesSource)).text()
  : readFileSync(resolve(bundlesSource), "utf8");
const bundles = JSON.parse(bundlesText).bundles;
if (!Array.isArray(bundles)) throw new Error("bundles document must contain a bundles array");

mkdirSync(workDir, { recursive: true });
const indexDir = join(workDir, "indexes");
mkdirSync(indexDir, { recursive: true });

async function kmodsDirectory() {
  const url = `${officialBase}/releases/${baseVersion}/targets/${targetArch}/${targetSub}/kmods/`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot list ${url}: HTTP ${response.status}`);
  const html = await response.text();
  const matches = [...html.matchAll(/href="([^"]+\/)"/g)]
    .map((match) => match[1])
    .filter((href) => !href.startsWith("/") && !href.startsWith(".."));
  if (matches.length === 0) throw new Error(`no kernel-module directory under ${url}`);
  return matches[matches.length - 1];
}

const repositories = [];
async function downloadIndex(id, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot fetch ${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = join(indexDir, `${id}.adb`);
  writeFileSync(file, bytes);
  repositories.push({ id, url, file });
  log(`index ${id}: ${bytes.length} bytes from ${url}`);
}

const targetBase = `${officialBase}/releases/${baseVersion}/targets/${targetArch}/${targetSub}`;
const genericBase = `${officialBase}/releases/${baseVersion}/packages/${ARCH}`;
await downloadIndex("official-target", `${targetBase}/packages/packages.adb`);
const kmods = await kmodsDirectory();
await downloadIndex("official-kmods", `${targetBase}/kmods/${kmods}packages.adb`);
await downloadIndex("official-base", `${genericBase}/base/packages.adb`);
await downloadIndex("official-luci", `${genericBase}/luci/packages.adb`);
await downloadIndex("official-packages", `${genericBase}/packages/packages.adb`);
await downloadIndex("supplement", `${feedBase}/supplement/${baseVersion}/${ARCH}/packages.adb`);
await downloadIndex("extension", `${feedBase}/extension/${baseVersion}/${ARCH}/packages.adb`);
await downloadIndex("dllkids", `${dllkidsBase}/${ARCH}/packages.adb`);

function indexPackages(index) {
  const dump = run(apkTool, ["adbdump", "--format", "json", index.file]);
  if (dump.status !== 0) throw new Error(`adbdump failed for ${index.id}: ${dump.stderr.trim()}`);
  const document = JSON.parse(dump.stdout);
  return (document.packages ?? []).map((pkg) => ({ name: pkg.name, version: pkg.version, index: index.id }));
}

const byName = new Map();
for (const index of repositories) {
  for (const pkg of indexPackages(index)) {
    if (!byName.has(pkg.name)) byName.set(pkg.name, []);
    byName.get(pkg.name).push(pkg);
  }
}

const SOURCE_PRIORITY = ["official-target", "official-kmods", "official-base", "official-luci", "official-packages", "dllkids", "supplement", "extension"];
function preferredVersion(name) {
  for (const source of SOURCE_PRIORITY) {
    const candidates = (byName.get(name) ?? []).filter((pkg) => pkg.index === source);
    if (candidates.length > 0) return candidates[candidates.length - 1];
  }
  return null;
}

const root = join(workDir, "root");
mkdirSync(join(root, "lib/apk/db"), { recursive: true });
mkdirSync(join(root, "etc/apk/keys"), { recursive: true });
mkdirSync(join(root, "var/cache/apk"), { recursive: true });
writeFileSync(join(root, "lib/apk/db/installed"), "");
writeFileSync(join(root, "lib/apk/db/triggers"), "");
const emptyTar = spawnSync("tar", ["cf", "-", "--files-from", "/dev/null"]);
if (emptyTar.error) throw emptyTar.error;
const gzip = spawnSync("gzip", ["-n"], { input: emptyTar.stdout });
if (gzip.error) throw gzip.error;
writeFileSync(join(root, "lib/apk/db/scripts.tar.gz"), gzip.stdout);
writeFileSync(join(root, "etc/apk/arch"), `${ARCH}\n`);
writeFileSync(join(root, "etc/apk/world"), "");
writeFileSync(
  join(root, "etc/apk/repositories"),
  `${repositories.map((index) => `file://${index.file}`).join("\n")}\n`,
);

const update = run(apkTool, [
  "--root", root,
  "--allow-untrusted",
  "--repositories-file", join(root, "etc/apk/repositories"),
  "update",
]);
if (update.status !== 0) throw new Error(`apk update failed: ${update.stderr.trim()}`);
log(`apk indexes ready (${repositories.length} repositories)`);

const failures = [];
const results = [];
for (const bundle of bundles) {
  if (bundle.publicAllowed === false) {
    // Private bundles (publicAllowed: false) are deliberately absent from the
    // published feed: their packages carry licences we may not redistribute, so
    // "installable from the public index" is not a property they can have.
    results.push({ bundle: bundle.id, target, status: "skipped", reason: "private bundle (publicAllowed: false)" });
    continue;
  }
  if (!Array.isArray(bundle.targets) || !bundle.targets.includes(target)) {
    results.push({ bundle: bundle.id, target, status: "skipped", reason: "target not declared" });
    continue;
  }
  const packages = [...new Set(bundle.packages ?? [])];
  const world = packages.map((name) => {
    const preferred = preferredVersion(name);
    return preferred ? `${name}=${preferred.version}` : name;
  });
  const simulate = run(apkTool, [
    "--root", root,
    "--allow-untrusted",
    "--repositories-file", join(root, "etc/apk/repositories"),
    "add", "--simulate", ...world,
  ]);
  if (simulate.status === 0) {
    results.push({ bundle: bundle.id, target, status: "ok", packages: world });
    log(`ok bundle=${bundle.id} target=${target} packages=${world.join(",")}`);
    continue;
  }
  const detail = `${simulate.stderr}\n${simulate.stdout}`.trim();
  const packageName = failedPackage(simulate.stderr ?? "", simulate.stdout ?? "", packages[0]);
  const marker = failureMarker(bundle.id, packageName, target);
  failures.push({ bundle: bundle.id, package: packageName, target, reason: detail.split("\n").slice(0, 12).join("\n") });
  results.push({ bundle: bundle.id, target, status: "failed", package: packageName, world });
  console.error(`COMBINEWRT_FAILURE ${marker}`);
  console.error(`::error title=bundle installability::${marker}`);
  console.error(detail);
}

const report = {
  baseVersion,
  target,
  generatedAt: new Date().toISOString(),
  bundles: bundles.length,
  passed: results.filter((item) => item.status === "ok").length,
  failed: failures.length,
  skipped: results.filter((item) => item.status === "skipped").length,
  results,
  failures,
  indexes: repositories.map((index) => ({ id: index.id, url: index.url })),
};
mkdirSync(resolve(outPath, ".."), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
log(`report ${outPath}: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`);
if (failures.length > 0) {
  console.error(`bundle installability failed for ${failures.length} bundle(s)`);
  process.exit(1);
}
