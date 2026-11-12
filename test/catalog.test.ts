import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCatalog, DEFAULT_FEED_URL } from "../src/catalog.js";
import { ManifestParseError, parseHideFile, parseManifestJson } from "../src/schema.js";
import type { HideEntry, Manifest } from "../src/types.js";

const fixturePath = fileURLToPath(new URL("../fixtures/manifest.fixture.json", import.meta.url));
const fixtureText = readFileSync(fixturePath, "utf8");

function fixture(): Manifest {
  return parseManifestJson(fixtureText);
}

function hide(entry: Partial<HideEntry> & Pick<HideEntry, "name">): HideEntry {
  return { reason: "test", hiddenAt: "2026-11-12T00:00:00Z", ...entry };
}

describe("parseManifestJson", () => {
  it("accepts the fixture and keeps failed entries", () => {
    const manifest = fixture();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.entries).toHaveLength(9);
    expect(manifest.entries.filter((entry) => entry.status === "failed")).toHaveLength(1);
  });

  it("rejects a malformed sha256", () => {
    const manifest = fixture();
    const first = manifest.entries[0];
    if (first?.status !== "ok") throw new Error("fixture shape changed");
    first.sha256 = "not-a-hash";
    expect(() => parseManifestJson(JSON.stringify(manifest))).toThrow(ManifestParseError);
  });

  it("rejects unsupported schema versions", () => {
    const manifest = fixture();
    (manifest as { schemaVersion: number }).schemaVersion = 2;
    expect(() => parseManifestJson(JSON.stringify(manifest))).toThrow(/schemaVersion/);
  });

  it("rejects dangling -r versions", () => {
    const manifest = fixture();
    const first = manifest.entries[0];
    if (first?.status !== "ok") throw new Error("fixture shape changed");
    first.version = "1.2.1-r1-r";
    expect(() => parseManifestJson(JSON.stringify(manifest))).toThrow(ManifestParseError);
  });

  it("rejects non-JSON input with a readable error", () => {
    expect(() => parseManifestJson("{")).toThrow(/not valid JSON/);
  });
});

describe("parseHideFile", () => {
  it("defaults to an empty hide list", () => {
    expect(parseHideFile({})).toEqual({ hidden: [] });
  });

  it("accepts a versionless hide entry", () => {
    const file = parseHideFile({
      hidden: [{ name: "luci-app-store", reason: "broken build", hiddenAt: "2026-11-12T00:00:00Z" }],
    });
    expect(file.hidden[0]?.version).toBeUndefined();
  });
});

describe("buildCatalog", () => {
  it("drops failed builds and keeps the six packages sorted by name", () => {
    const catalog = buildCatalog(fixture(), []);
    expect(catalog.packages.map((entry) => entry.name)).toEqual([
      "luci-app-fwlive",
      "luci-app-store",
      "luci-app-substore",
      "luci-lib-taskd",
      "luci-lib-xterm",
      "taskd",
    ]);
    expect(catalog.packages.some((entry) => entry.name === "luci-app-gately")).toBe(false);
  });

  it("retains the latest and previous version plus anything inside the window", () => {
    const catalog = buildCatalog(fixture(), []);
    const xterm = catalog.packages.find((entry) => entry.name === "luci-lib-xterm");
    expect(xterm?.latest.version).toBe("4.18.0-r1");
    expect(xterm?.previous?.version).toBe("4.17.0-r1");
    expect(xterm?.versions.map((version) => version.version)).toEqual([
      "4.18.0-r1",
      "4.17.0-r1",
    ]);
  });

  it("hides a whole package when no version is named", () => {
    const catalog = buildCatalog(fixture(), [hide({ name: "luci-app-store" })]);
    expect(catalog.packages.some((entry) => entry.name === "luci-app-store")).toBe(false);
  });

  it("hides one version and promotes the next one", () => {
    const catalog = buildCatalog(fixture(), [hide({ name: "luci-lib-xterm", version: "4.18.0-r1" })]);
    const xterm = catalog.packages.find((entry) => entry.name === "luci-lib-xterm");
    expect(xterm?.latest.version).toBe("4.17.0-r1");
    expect(xterm?.versions.some((version) => version.version === "4.18.0-r1")).toBe(false);
  });

  it("matches hides by arch when given", () => {
    const catalog = buildCatalog(fixture(), [hide({ name: "taskd", arch: "x86_64" })]);
    expect(catalog.packages.some((entry) => entry.name === "taskd")).toBe(true);
    const hidden = buildCatalog(fixture(), [hide({ name: "taskd", arch: "all" })]);
    expect(hidden.packages.some((entry) => entry.name === "taskd")).toBe(false);
  });

  it("keeps versions inside the retention window beyond latest and previous", () => {
    const manifest = fixture();
    const first = manifest.entries[0];
    if (first?.status !== "ok") throw new Error("fixture shape changed");
    manifest.entries.push(
      { ...first, version: "4.18.0-r2", asset: "luci-lib-xterm-4.18.0-r2.apk" },
      { ...first, version: "4.19.0-r1", asset: "luci-lib-xterm-4.19.0-r1.apk" },
    );

    const wide = buildCatalog(manifest, [], { retentionDays: 14 });
    const narrow = buildCatalog(manifest, [], {
      retentionDays: 0,
      now: new Date("2026-11-13T05:00:00Z"),
    });
    expect(wide.packages.find((entry) => entry.name === "luci-lib-xterm")?.versions).toHaveLength(3);
    expect(narrow.packages.find((entry) => entry.name === "luci-lib-xterm")?.versions).toHaveLength(2);
  });

  it("rejects duplicate name/version/arch entries", () => {
    const manifest = fixture();
    const first = manifest.entries[0];
    if (first?.status !== "ok") throw new Error("fixture shape changed");
    manifest.entries.push({ ...first });
    expect(() => buildCatalog(manifest, [])).toThrow(/duplicate entry/);
  });

  it("rejects an asset name that does not match name and version", () => {
    const manifest = fixture();
    const first = manifest.entries[0];
    if (first?.status !== "ok") throw new Error("fixture shape changed");
    first.asset = "renamed.apk";
    expect(() => buildCatalog(manifest, [])).toThrow(/does not match/);
  });

  it("carries the stable feed URL", () => {
    const catalog = buildCatalog(fixture(), []);
    expect(catalog.feedUrl).toBe(DEFAULT_FEED_URL);
    expect(catalog.feedUrl.endsWith("/x86_64/packages.adb")).toBe(true);
  });

  it("keeps metadata from the newest version", () => {
    const catalog = buildCatalog(fixture(), []);
    const store = catalog.packages.find((entry) => entry.name === "luci-app-store");
    expect(store?.license).toBe("MIT");
    expect(store?.sourceCommit).toBe("18b7d51c1a06427fa6e8c64b161869de7daded7e");
    expect(store?.latest.sha256).toBe("f".repeat(64));
  });
});
