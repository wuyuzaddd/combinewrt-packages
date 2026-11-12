import { isHidden, isOkEntry } from "./schema.js";
import type { Catalog, CatalogPackage, CatalogVersion, HideEntry, Manifest } from "./types.js";
import { sortVersionsDescending } from "./version.js";

export const DEFAULT_RETENTION_DAYS = 14;

export interface CatalogOptions {
  /** Reference time for the retention window; defaults to the manifest timestamp. */
  now?: Date;
  retentionDays?: number;
  feedUrl?: string;
}

export const DEFAULT_FEED_URL = "https://wuyuzaddd.github.io/combinewrt-packages/x86_64/packages.adb";

export function buildCatalog(manifest: Manifest, hides: HideEntry[], options: CatalogOptions = {}): Catalog {
  const now = options.now ?? new Date(manifest.generatedAt);
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const feedUrl = options.feedUrl ?? DEFAULT_FEED_URL;

  if (Number.isNaN(now.getTime())) {
    throw new Error("buildCatalog: options.now is not a valid date");
  }
  if (retentionDays < 0) {
    throw new Error("buildCatalog: retentionDays must not be negative");
  }

  const seen = new Set<string>();
  const groups = new Map<string, CatalogVersion[]>();

  for (const entry of manifest.entries) {
    if (!isOkEntry(entry)) continue;
    const key = `${entry.name}@${entry.version}@${entry.arch}`;
    if (seen.has(key)) {
      throw new Error(`buildCatalog: duplicate entry ${entry.name} ${entry.version} (${entry.arch})`);
    }
    seen.add(key);
    if (entry.asset !== `${entry.name}-${entry.version}.apk`) {
      throw new Error(
        `buildCatalog: asset ${entry.asset} does not match ${entry.name}-${entry.version}.apk`,
      );
    }
    if (isHidden(entry, hides)) continue;

    const bucket = groups.get(entry.name) ?? [];
    bucket.push({
      name: entry.name,
      version: entry.version,
      arch: entry.arch,
      description: entry.description,
      depends: entry.depends,
      license: entry.license,
      installedSize: entry.installedSize,
      fileSize: entry.fileSize,
      sha256: entry.sha256,
      sourceRepo: entry.sourceRepo,
      sourceCommit: entry.sourceCommit,
      sourcePath: entry.sourcePath,
      asset: entry.asset,
      publishedAt: entry.publishedAt ?? manifest.generatedAt,
    });
    groups.set(entry.name, bucket);
  }

  const packages: CatalogPackage[] = [];
  for (const [name, bucket] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const retained = sortVersionsDescending(bucket).filter((version, index) => {
      if (index < 2) return true;
      return withinDays(version.publishedAt, now, retentionDays);
    });
    if (retained.length === 0) continue;

    const latest = retained[0] as CatalogVersion;
    packages.push({
      name,
      description: latest.description,
      license: latest.license,
      sourceRepo: latest.sourceRepo,
      sourceCommit: latest.sourceCommit,
      sourcePath: latest.sourcePath,
      latest,
      previous: retained[1] ?? null,
      versions: retained,
    });
  }

  return {
    schemaVersion: manifest.schemaVersion,
    generatedAt: manifest.generatedAt,
    baseVersion: manifest.baseVersion,
    arch: manifest.arch,
    buildRunId: manifest.buildRunId,
    feedUrl,
    packages,
  };
}

function withinDays(timestamp: string, now: Date, days: number): boolean {
  const published = Date.parse(timestamp);
  if (Number.isNaN(published)) return false;
  return now.getTime() - published <= days * 24 * 60 * 60 * 1000;
}
