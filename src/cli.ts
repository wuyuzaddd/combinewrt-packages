import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildCatalog, DEFAULT_FEED_URL } from "./catalog.js";
import { DEFAULT_BASE_URL, renderSite } from "./render.js";
import { parseHideFileJson, parseManifestJson } from "./schema.js";
import { writeSite } from "./site.js";
import type { Catalog, HideEntry } from "./types.js";

export const USAGE = `combinewrt-packages

Usage:
  npm run fixture -- --out site [--manifest fixtures/manifest.fixture.json] [--hide hide.json]
  npm run generate -- --manifest manifest.json --apks apks --out site [--hide hide.json]
  npm run verify -- --catalog site/catalog.json

The generator is a pure TypeScript pipeline: manifest -> catalog -> static site.
`;

export function usage(): string {
  return USAGE;
}

interface ParsedArgs {
  command: string;
  options: Map<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] as string;
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "") throw new Error("empty option name");
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      flags.add(name);
      continue;
    }
    options.set(name, value);
    index += 1;
  }

  return { command, options, flags };
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }

  switch (parsed.command) {
    case "fixture":
      return runFixture(parsed);
    case "generate":
      return runGenerate(parsed);
    case "verify":
      return runVerify(parsed);
    case "help":
    case "--help":
    case "":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`unknown command: ${parsed.command}\n\n${USAGE}`);
      return 1;
  }
}

async function runFixture(parsed: ParsedArgs): Promise<number> {
  const manifestPath = parsed.options.get("manifest") ?? "fixtures/manifest.fixture.json";
  const outDir = parsed.options.get("out") ?? "site";
  const manifest = parseManifestJson(await readFile(manifestPath, "utf8"));
  const hides = await readHides(parsed.options.get("hide"));
  const catalog = buildCatalog(manifest, hides, {
    now: new Date(manifest.generatedAt),
    feedUrl: DEFAULT_FEED_URL,
  });

  const files = renderSite(catalog, { baseUrl: DEFAULT_BASE_URL });
  const written = await writeSite(files, outDir);
  process.stdout.write(
    `fixture site: ${catalog.packages.length} packages, ${written.length} files -> ${outDir}\n`,
  );
  return 0;
}

async function runGenerate(parsed: ParsedArgs): Promise<number> {
  const manifestPath = required(parsed, "manifest");
  const apksDir = required(parsed, "apks");
  const outDir = parsed.options.get("out") ?? "site";
  const baseUrl = parsed.options.get("base-url") ?? DEFAULT_BASE_URL;
  const feedUrl = parsed.options.get("feed-url") ?? `${baseUrl}/x86_64/packages.adb`;
  const retentionDays = Number(parsed.options.get("retention-days") ?? "14");

  const manifest = parseManifestJson(await readFile(manifestPath, "utf8"));
  const hides = await readHides(parsed.options.get("hide"));
  const catalog = buildCatalog(manifest, hides, {
    now: new Date(),
    retentionDays,
    feedUrl,
  });

  const files = renderSite(catalog, { baseUrl, feedUrl });
  await writeSite(files, outDir);

  await mkdir(join(outDir, "x86_64"), { recursive: true });
  let copied = 0;
  for (const entry of catalog.packages) {
    for (const version of entry.versions) {
      const source = join(apksDir, version.asset);
      const digest = await sha256File(source);
      if (digest !== version.sha256) {
        throw new Error(`${version.asset}: sha256 mismatch (${digest} != ${version.sha256})`);
      }
      const size = (await stat(source)).size;
      if (size !== version.fileSize) {
        throw new Error(`${version.asset}: size mismatch (${size} != ${version.fileSize})`);
      }
      await copyFile(source, join(outDir, "x86_64", version.asset));
      copied += 1;
    }
  }

  process.stdout.write(
    `generated site: ${catalog.packages.length} packages, ${copied} apks -> ${outDir}\n`,
  );
  return 0;
}

async function runVerify(parsed: ParsedArgs): Promise<number> {
  const catalogPath = required(parsed, "catalog");
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as Catalog;
  const siteDir = resolve(join(catalogPath, ".."));
  let checked = 0;

  for (const entry of catalog.packages) {
    for (const version of entry.versions) {
      const file = join(siteDir, "x86_64", version.asset);
      const digest = await sha256File(file);
      if (digest !== version.sha256) {
        process.stderr.write(`verify failed: ${version.asset} sha256 mismatch\n`);
        return 1;
      }
      checked += 1;
    }
  }

  process.stdout.write(`verified ${catalog.packages.length} packages, ${checked} apks\n`);
  return 0;
}

function required(parsed: ParsedArgs, name: string): string {
  const value = parsed.options.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function readHides(path: string | undefined): Promise<HideEntry[]> {
  if (!path) return [];
  return parseHideFileJson(await readFile(path, "utf8")).hidden;
}

async function sha256File(path: string): Promise<string> {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
