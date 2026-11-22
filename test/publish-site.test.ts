import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repoRoot = new URL("..", import.meta.url).pathname;
const COMMIT_A = "1".repeat(40);
const COMMIT_B = "2".repeat(40);
const COMMIT_C = "3".repeat(40);

const directories: string[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
  while (servers.length > 0) await servers.pop()!.close();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "combinewrt-publish-site-"));
  directories.push(dir);
  return dir;
}

/** Build a throwaway generated tree that looks like `npm run generate` output. */
function generated(root: string, marker: string): string {
  const dir = join(root, "gen");
  mkdirSync(join(dir, "x86_64"), { recursive: true });
  writeFileSync(join(dir, "x86_64", "packages.adb"), `index-${marker}`);
  writeFileSync(join(dir, "x86_64", "taskd-1.0-r1.apk"), `apk-${marker}`);
  writeFileSync(join(dir, "catalog.json"), JSON.stringify({ marker }));
  writeFileSync(join(dir, "index.html"), `<html>${marker}</html>`);
  writeFileSync(join(dir, "install.html"), `<html>install-${marker}</html>`);
  writeFileSync(join(dir, "404.html"), `<html>404-${marker}</html>`);
  writeFileSync(join(dir, ".nojekyll"), "");
  mkdirSync(join(dir, "packages"), { recursive: true });
  writeFileSync(join(dir, "packages", "taskd.html"), `<html>page-${marker}</html>`);
  writeFileSync(join(dir, "hide.json"), "[]");
  return dir;
}

async function publish(
  args: string[],
): Promise<{ stdout: string; status: number; stderr: string }> {
  try {
    const result = await run("node", ["scripts/publish-site.mjs", ...args], { cwd: repoRoot });
    return { stdout: result.stdout, status: 0, stderr: result.stderr };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", status: failure.code ?? 1, stderr: failure.stderr ?? "" };
  }
}

function layouts(state: string, base: string, commit: string) {
  return {
    supplemental: join(state, "supplement", base, "x86_64", commit),
    livePointer: join(state, "supplement", base, "x86_64"),
    flat: join(state, "x86_64"),
    staging: join(state, "staging", base, "x86_64", commit),
  };
}

describe("publish-site", () => {
  it("publishes a live index into the frozen path, the live pointer and the flat channel", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });
    const result = await publish([
      "--generated", generated(root, "a"),
      "--state", state,
      "--channel", "live",
      "--base-version", "25.12.2",
      "--target", "x86_64",
      "--source-commit", COMMIT_A,
      "--keep", "3",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`frozen_path=/supplement/25.12.2/x86_64/${COMMIT_A}`);
    expect(result.stdout).toContain("promoted_from_staging=false");
    const paths = layouts(state, "25.12.2", COMMIT_A);
    expect(readFileSync(join(paths.supplemental, "packages.adb"), "utf8")).toBe("index-a");
    expect(readFileSync(join(paths.livePointer, "packages.adb"), "utf8")).toBe("index-a");
    expect(readFileSync(join(paths.flat, "packages.adb"), "utf8")).toBe("index-a");
    expect(readFileSync(join(state, "catalog.json"), "utf8")).toBe('{"marker":"a"}');
    expect(existsSync(join(state, "keys", "combinewrt-feed.pub.pem"))).toBe(true);
    expect(existsSync(join(state, "hide.json"))).toBe(true);
    // The index links to the install guide and to one page per package; both
    // used to 404 because only index.html was copied into the site root.
    expect(readFileSync(join(state, "install.html"), "utf8")).toBe("<html>install-a</html>");
    expect(readFileSync(join(state, "404.html"), "utf8")).toBe("<html>404-a</html>");
    expect(readFileSync(join(state, "packages", "taskd.html"), "utf8")).toBe("<html>page-a</html>");
    expect(existsSync(join(state, ".nojekyll"))).toBe(true);
  });

  it("stages an index without touching the live pointer or the flat channel", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });
    await publish([
      "--generated", generated(root, "a"),
      "--state", state,
      "--channel", "live",
      "--base-version", "25.12.2",
      "--source-commit", COMMIT_A,
      "--keep", "3",
    ]);
    const before = layouts(state, "25.12.2", COMMIT_A);
    const liveIndex = readFileSync(join(before.livePointer, "packages.adb"), "utf8");

    const result = await publish([
      "--generated", generated(root, "b"),
      "--state", state,
      "--channel", "staging",
      "--base-version", "25.12.2",
      "--source-commit", COMMIT_B,
      "--keep", "3",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`frozen_path=/staging/25.12.2/x86_64/${COMMIT_B}`);
    expect(result.stdout).not.toContain("live_path=");
    const staged = layouts(state, "25.12.2", COMMIT_B);
    expect(readFileSync(join(staged.staging, "packages.adb"), "utf8")).toBe("index-b");
    expect(readFileSync(join(before.livePointer, "packages.adb"), "utf8")).toBe(liveIndex);
    expect(readFileSync(join(before.flat, "packages.adb"), "utf8")).toBe("index-a");
    expect(readFileSync(join(state, "catalog.json"), "utf8")).toBe('{"marker":"a"}');
  });

  it("promotes a staged commit when the same build is published live", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });
    await publish([
      "--generated", generated(root, "b"),
      "--state", state,
      "--channel", "staging",
      "--base-version", "25.12.2",
      "--source-commit", COMMIT_B,
    ]);
    const result = await publish([
      "--generated", generated(root, "b"),
      "--state", state,
      "--channel", "live",
      "--base-version", "25.12.2",
      "--source-commit", COMMIT_B,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("promoted_from_staging=true");
    const paths = layouts(state, "25.12.2", COMMIT_B);
    expect(readFileSync(join(paths.supplemental, "packages.adb"), "utf8")).toBe("index-b");
    guardStaged(paths.staging);
  });

  it("keeps only the newest frozen commits", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });
    for (const [commit, marker] of [
      [COMMIT_A, "a"],
      [COMMIT_B, "b"],
      [COMMIT_C, "c"],
    ] as const) {
      await publish([
        "--generated", generated(root, marker),
        "--state", state,
        "--channel", "live",
        "--base-version", "25.12.2",
        "--source-commit", commit,
        "--keep", "2",
      ]);
    }
    const frozen = join(state, "supplement", "25.12.2", "x86_64");
    expect(existsSync(join(frozen, COMMIT_A))).toBe(false);
    expect(existsSync(join(frozen, COMMIT_B))).toBe(true);
    expect(existsSync(join(frozen, COMMIT_C))).toBe(true);
    expect(readFileSync(join(frozen, "packages.adb"), "utf8")).toBe("index-c");
  });

  it("rejects an invalid channel, commit or base version", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });
    const gen = generated(root, "a");

    const badCommit = await publish([
      "--generated", gen, "--state", state, "--channel", "live",
      "--base-version", "25.12.2", "--source-commit", "deadbeef",
    ]);
    expect(badCommit.status).toBe(1);
    expect(badCommit.stderr).toContain("40 character lowercase git commit");

    const badChannel = await publish([
      "--generated", gen, "--state", state, "--channel", "prod",
      "--base-version", "25.12.2", "--source-commit", COMMIT_A,
    ]);
    expect(badChannel.status).toBe(1);
    expect(badChannel.stderr).toContain("--channel must be live or staging");

    const badBase = await publish([
      "--generated", gen, "--state", state, "--channel", "live",
      "--base-version", "../etc", "--source-commit", COMMIT_A,
    ]);
    expect(badBase.status).toBe(1);
    expect(badBase.stderr).toContain("safe path segment");

    const unsigned = await publish([
      "--generated", join(root, "empty"), "--state", state, "--channel", "live",
      "--base-version", "25.12.2", "--source-commit", COMMIT_A,
    ]);
    expect(unsigned.status).toBe(1);
    expect(unsigned.stderr).toContain("packages.adb is missing");
  });
});

function guardStaged(stagingDir: string): void {
  expect(existsSync(stagingDir)).toBe(true);
  expect(readFileSync(join(stagingDir, "packages.adb"), "utf8")).toBe("index-b");
}

describe("publish-site extension kind", () => {
  it("publishes the extension feed into its own frozen tree without touching the supplement channel", async () => {
    const root = tempDir();
    const state = join(root, "site");
    mkdirSync(state, { recursive: true });

    const supplement = await publish([
      "--generated", generated(root, "supplement"),
      "--state", state,
      "--channel", "live",
      "--base-version", "25.12.2",
      "--target", "x86_64",
      "--source-commit", COMMIT_A,
      "--keep", "3",
    ]);
    expect(supplement.status).toBe(0);

    const extension = await publish([
      "--generated", generated(root, "extension"),
      "--state", state,
      "--channel", "live",
      "--base-version", "25.12.2",
      "--target", "x86_64",
      "--source-commit", COMMIT_B,
      "--keep", "3",
      "--kind", "extension",
    ]);

    expect(extension.status).toBe(0);
    expect(extension.stdout).toContain("kind: extension");
    expect(extension.stdout).toContain(`frozen_path=/extension/25.12.2/x86_64/${COMMIT_B}`);
    expect(extension.stdout).toContain("live_path=/extension/25.12.2/x86_64");

    const extensionFrozen = join(state, "extension", "25.12.2", "x86_64", COMMIT_B, "packages.adb");
    const extensionLive = join(state, "extension", "25.12.2", "x86_64", "packages.adb");
    expect(readFileSync(extensionFrozen, "utf8")).toBe("index-extension");
    expect(readFileSync(extensionLive, "utf8")).toBe("index-extension");

    // The supplement pointer, its frozen index, the V1 flat channel and the
    // top-level catalog record are byte-identical to the supplement publish.
    expect(readFileSync(join(state, "supplement", "25.12.2", "x86_64", COMMIT_A, "packages.adb"), "utf8")).toBe(
      "index-supplement",
    );
    expect(readFileSync(join(state, "supplement", "25.12.2", "x86_64", "packages.adb"), "utf8")).toBe(
      "index-supplement",
    );
    expect(readFileSync(join(state, "x86_64", "packages.adb"), "utf8")).toBe("index-supplement");
    expect(existsSync(join(state, "extension", "catalog.json"))).toBe(false);
  });
});

describe("import-live-site", () => {
  it("seeds an empty site tree from the deployed feed", async () => {
    const live = tempDir();
    mkdirSync(join(live, "x86_64"), { recursive: true });
    mkdirSync(join(live, "keys"), { recursive: true });
    writeFileSync(join(live, "catalog.json"), JSON.stringify({ packages: [{ name: "taskd", versions: [{ asset: "taskd-1.0-r1.apk" }] }] }));
    writeFileSync(join(live, "keys", "combinewrt-feed.pub.pem"), "pub");
    writeFileSync(join(live, "x86_64", "packages.adb"), "index");
    writeFileSync(join(live, "x86_64", "taskd-1.0-r1.apk"), "apk");

    const server = createServer((request, response) => {
      const file = join(live, ...(request.url ?? "/").split("?")[0]!.split("/").filter(Boolean));
      let body: Buffer;
      try {
        body = readFileSync(file);
      } catch {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");

    const state = join(tempDir(), "site");
    const result = await run("node", ["scripts/import-live-site.mjs", "--state", state, "--base-url", `http://127.0.0.1:${address.port}`], { cwd: repoRoot });

    expect(result.stdout).toContain("imported 4 live file(s)");
    expect(readFileSync(join(state, "x86_64", "packages.adb"), "utf8")).toBe("index");
    expect(readFileSync(join(state, "x86_64", "taskd-1.0-r1.apk"), "utf8")).toBe("apk");
    expect(readFileSync(join(state, "keys", "combinewrt-feed.pub.pem"), "utf8")).toBe("pub");
  });
});
