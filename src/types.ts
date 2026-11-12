export const SUPPORTED_SCHEMA_VERSION = 1;

export interface ManifestEntryOk {
  status: "ok";
  name: string;
  version: string;
  arch: string;
  description: string;
  depends: string[];
  license: string;
  installedSize: number;
  fileSize: number;
  sha256: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  asset: string;
  publishedAt?: string;
}

export interface ManifestEntryFailed {
  status: "failed";
  name: string;
  error?: string;
}

export type ManifestEntry = ManifestEntryOk | ManifestEntryFailed;

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  baseVersion: string;
  arch: string;
  buildRunId: number;
  entries: ManifestEntry[];
}

export interface HideEntry {
  name: string;
  version?: string;
  arch?: string;
  reason: string;
  hiddenAt: string;
}

export interface HideFile {
  hidden: HideEntry[];
}

export interface CatalogVersion {
  name: string;
  version: string;
  arch: string;
  description: string;
  depends: string[];
  license: string;
  installedSize: number;
  fileSize: number;
  sha256: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  asset: string;
  publishedAt: string;
}

export interface CatalogPackage {
  name: string;
  description: string;
  license: string;
  sourceRepo: string;
  sourceCommit: string;
  sourcePath: string;
  latest: CatalogVersion;
  previous: CatalogVersion | null;
  versions: CatalogVersion[];
}

export interface Catalog {
  schemaVersion: number;
  generatedAt: string;
  baseVersion: string;
  arch: string;
  buildRunId: number;
  feedUrl: string;
  packages: CatalogPackage[];
}
