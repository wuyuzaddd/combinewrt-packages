import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { main, parseArgs, usage } from "../src/cli.js";

const fixturePath = fileURLToPath(new URL("../fixtures/manifest.fixture.json", import.meta.url));
const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "combinewrt-cli-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cli", () => {
  it("describes the fixture, generate and verify commands", () => {
    const text = usage();
    expect(text).toContain("fixture");
    expect(text).toContain("generate");
    expect(text).toContain("verify");
  });

  it("parses options and boolean flags", () => {
    const parsed = parseArgs(["generate", "--manifest", "m.json", "--apks", "apks", "--allow-partial"]);
    expect(parsed.command).toBe("generate");
    expect(parsed.options.get("manifest")).toBe("m.json");
    expect(parsed.flags.has("allow-partial")).toBe(true);
  });

  it("rejects positional arguments", () => {
    expect(() => parseArgs(["fixture", "site"])).toThrow(/unexpected argument/);
  });

  it("renders the fixture site without a manifest argument", async () => {
    const out = join(await tempDir(), "site");
    const code = await main(["fixture", "--out", out, "--manifest", fixturePath]);
    expect(code).toBe(0);
    const index = await readFile(join(out, "index.html"), "utf8");
    expect(index).toContain("luci-app-store");
    const catalog = JSON.parse(await readFile(join(out, "catalog.json"), "utf8")) as {
      packages: unknown[];
    };
    expect(catalog.packages).toHaveLength(6);
  });

  it("generates a site and copies verified apks", async () => {
    const dir = await tempDir();
    const apks = join(dir, "apks");
    const out = join(dir, "site");
    await mkdir(apks, { recursive: true });

    const bytes = Buffer.from("fixture apk bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(apks, "taskd-1.0.3-r1.apk"), bytes);

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseVersion: "25.12.2",
      arch: "x86_64",
      buildRunId: 1,
      entries: [
        {
          status: "ok",
          name: "taskd",
          version: "1.0.3-r1",
          arch: "all",
          description: "Task scheduler daemon",
          depends: ["procd"],
          license: "MIT",
          installedSize: 18000,
          fileSize: bytes.length,
          sha256: digest,
          sourceRepo: "kiddin9/op-packages",
          sourceCommit: "18b7d51c1a06427fa6e8c64b161869de7daded7e",
          sourcePath: "taskd",
          asset: "taskd-1.0.3-r1.apk",
        },
      ],
    };
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const code = await main([
      "generate",
      "--manifest",
      manifestPath,
      "--apks",
      apks,
      "--out",
      out,
    ]);
    expect(code).toBe(0);
    expect(await readFile(join(out, "x86_64", "taskd-1.0.3-r1.apk"), "utf8")).toBe(
      "fixture apk bytes",
    );
    expect(await readFile(join(out, "packages", "taskd.html"), "utf8")).toContain("1.0.3-r1");
  });

  it("refuses to generate when an apk digest does not match the manifest", async () => {
    const dir = await tempDir();
    const apks = join(dir, "apks");
    await mkdir(apks, { recursive: true });
    await writeFile(join(apks, "taskd-1.0.3-r1.apk"), "tampered");

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseVersion: "25.12.2",
      arch: "x86_64",
      buildRunId: 1,
      entries: [
        {
          status: "ok",
          name: "taskd",
          version: "1.0.3-r1",
          arch: "all",
          description: "",
          depends: [],
          license: "MIT",
          installedSize: 1,
          fileSize: 8,
          sha256: "0".repeat(64),
          sourceRepo: "kiddin9/op-packages",
          sourceCommit: "18b7d51c1a06427fa6e8c64b161869de7daded7e",
          sourcePath: "taskd",
          asset: "taskd-1.0.3-r1.apk",
        },
      ],
    };
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(
      main(["generate", "--manifest", manifestPath, "--apks", apks, "--out", join(dir, "site")]),
    ).rejects.toThrow(/sha256 mismatch/);
  });
});
