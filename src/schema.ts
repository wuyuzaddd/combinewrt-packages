import { z } from "zod";

import type { HideEntry, HideFile, Manifest, ManifestEntry } from "./types.js";

const packageName = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9+._-]*$/, "must be a lowercase apk package name");

const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a lowercase hex sha256 digest");

const isoDate = z
  .string()
  .min(10)
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO-8601 timestamp");

const versionString = z
  .string()
  .min(1)
  .max(120)
  .refine((value) => !value.endsWith("-r"), "must not end with a dangling -r");

const okEntry = z.object({
  status: z.literal("ok"),
  name: packageName,
  version: versionString,
  arch: z.string().min(1),
  description: z.string(),
  depends: z.array(z.string()).default([]),
  license: z.string().default(""),
  installedSize: z.number().int().nonnegative(),
  fileSize: z.number().int().nonnegative(),
  sha256: sha256,
  sourceRepo: z.string().min(1),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  sourcePath: z.string().min(1),
  asset: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*\.apk$/, "must be a plain apk filename"),
  publishedAt: isoDate.optional(),
});

const failedEntry = z.object({
  status: z.literal("failed"),
  name: packageName,
  error: z.string().optional(),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: isoDate,
  baseVersion: z.string().min(1),
  arch: z.string().min(1),
  buildRunId: z.number().int().positive(),
  entries: z.array(z.discriminatedUnion("status", [okEntry, failedEntry])),
});

export const hideEntrySchema = z.object({
  name: packageName,
  version: versionString.optional(),
  arch: z.string().min(1).optional(),
  reason: z.string().min(1),
  hiddenAt: isoDate,
});

export const hideFileSchema = z.object({
  hidden: z.array(hideEntrySchema).default([]),
});

export class ManifestParseError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid manifest:\n${issues.join("\n")}`);
    this.name = "ManifestParseError";
  }
}

export function parseManifest(input: unknown): Manifest {
  const result = manifestSchema.safeParse(input);
  if (!result.success) {
    throw new ManifestParseError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
    );
  }
  return result.data as Manifest;
}

export function parseManifestJson(text: string): Manifest {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new ManifestParseError([`<root>: not valid JSON (${(error as Error).message})`]);
  }
  return parseManifest(input);
}

export function parseHideFile(input: unknown): HideFile {
  const result = hideFileSchema.safeParse(input);
  if (!result.success) {
    throw new Error(
      `invalid hide.json:\n${result.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return result.data as HideFile;
}

export function parseHideFileJson(text: string): HideFile {
  return parseHideFile(JSON.parse(text));
}

export function isOkEntry(entry: ManifestEntry): entry is Extract<ManifestEntry, { status: "ok" }> {
  return entry.status === "ok";
}

export function isHidden(entry: { name: string; version: string; arch: string }, hides: HideEntry[]): boolean {
  return hides.some(
    (hide) =>
      hide.name === entry.name &&
      (hide.version === undefined || hide.version === entry.version) &&
      (hide.arch === undefined || hide.arch === entry.arch),
  );
}
