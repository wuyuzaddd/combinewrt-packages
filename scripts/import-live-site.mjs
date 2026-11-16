#!/usr/bin/env node
/**
 * Seed an empty site tree from the currently deployed Pages site.
 *
 * The published tree lives on the `gh-pages` branch. The very first publish
 * after this change has no such branch yet, and staging must never delete the
 * live feed, so bootstrap the state from the public URL once and let the rest
 * of the pipeline work on a complete tree.
 *
 * Usage: node scripts/import-live-site.mjs --state site \
 *          --base-url https://wuyuzaddd.github.io/combinewrt-packages
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  return argv[index + 1];
}

export async function importLiveSite({ state, baseUrl, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/$/, "");
  const files = ["catalog.json", "index.html", "hide.json", "publish.json", "keys/combinewrt-feed.pub.pem", "x86_64/packages.adb"];
  const fetched = [];

  const catalogResponse = await fetchImpl(`${root}/catalog.json`, { headers: { "Cache-Control": "no-cache" } });
  if (catalogResponse.ok) {
    const catalog = await catalogResponse.json();
    for (const pkg of catalog.packages ?? []) {
      for (const version of pkg.versions ?? []) {
        if (typeof version.asset === "string") files.push(`x86_64/${version.asset}`);
      }
    }
  }

  for (const file of files) {
    const response = await fetchImpl(`${root}/${file}`, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    const target = join(state, ...file.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    fetched.push(file);
  }
  return fetched;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const argv = process.argv.slice(2);
    const state = option(argv, "state", "site");
    const baseUrl = option(argv, "base-url", "https://wuyuzaddd.github.io/combinewrt-packages");
    const fetched = await importLiveSite({ state, baseUrl });
    console.log(`imported ${fetched.length} live file(s) into ${state}`);
    for (const file of fetched) console.log(`  ${file}`);
  } catch (error) {
    process.stderr.write(`import-live-site: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
