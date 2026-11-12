import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeSite } from "../src/site.js";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "combinewrt-site-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writeSite", () => {
  it("writes nested files and replaces previous content", async () => {
    const dir = await tempDir();
    const out = join(dir, "site");
    const written = await writeSite(
      new Map([
        ["index.html", "home"],
        ["packages/example.html", "detail"],
        [".nojekyll", ""],
      ]),
      out,
    );

    expect(written).toEqual([".nojekyll", "index.html", "packages/example.html"]);
    expect(await readFile(join(out, "packages/example.html"), "utf8")).toBe("detail");

    await writeSite(new Map([["index.html", "second"]]), out);
    expect(await readFile(join(out, "index.html"), "utf8")).toBe("second");
    await expect(readFile(join(out, "packages/example.html"), "utf8")).rejects.toThrow();
  });

  it("refuses paths that escape the output directory", async () => {
    const dir = await tempDir();
    await expect(writeSite(new Map([["../evil.html", "x"]]), join(dir, "site"))).rejects.toThrow(
      /unsafe path/,
    );
    await expect(writeSite(new Map([["/etc/passwd", "x"]]), join(dir, "site"))).rejects.toThrow(
      /unsafe path/,
    );
  });
});
