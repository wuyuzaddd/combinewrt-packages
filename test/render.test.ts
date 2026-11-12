import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCatalog } from "../src/catalog.js";
import { escapeHtml, formatBytes, renderSite } from "../src/render.js";
import { parseManifestJson } from "../src/schema.js";
import type { Catalog } from "../src/types.js";

const fixturePath = fileURLToPath(new URL("../fixtures/manifest.fixture.json", import.meta.url));

function fixtureCatalog(): Catalog {
  const manifest = parseManifestJson(readFileSync(fixturePath, "utf8"));
  return buildCatalog(manifest, []);
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1] as string);
}

describe("renderSite", () => {
  it("renders the index, install page, catalog and one page per package", () => {
    const files = renderSite(fixtureCatalog());
    expect(files.has("index.html")).toBe(true);
    expect(files.has("install.html")).toBe(true);
    expect(files.has("404.html")).toBe(true);
    expect(files.has("catalog.json")).toBe(true);
    expect(files.has("packages/luci-app-store.html")).toBe(true);
    expect(files.has("packages/taskd.html")).toBe(true);
    expect(files.has(".nojekyll")).toBe(true);
  });

  it("lists every package with a download link and filter controls", () => {
    const html = renderSite(fixtureCatalog()).get("index.html") as string;
    for (const name of [
      "luci-app-fwlive",
      "luci-app-store",
      "luci-app-substore",
      "luci-lib-taskd",
      "luci-lib-xterm",
      "taskd",
    ]) {
      expect(html).toContain(name);
    }
    expect(html).toContain('id="q"');
    expect(html).toContain('id="license"');
    expect(html).toContain('id="source"');
    expect(html).toContain("x86_64/luci-app-store-0.2.1-r1.apk");
    expect(html).toContain("x86_64/luci-lib-xterm-4.18.0-r1.apk");
    expect(html).toContain("https://wuyuzaddd.github.io/combinewrt-packages/x86_64/packages.adb");
  });

  it("renders an install page that points at the index, not a directory", () => {
    const html = renderSite(fixtureCatalog()).get("install.html") as string;
    expect(html).toContain("/x86_64/packages.adb");
    expect(html).toContain("/keys/combinewrt-feed.pub.pem");
    expect(html).toContain("apk update");
    expect(html).toContain("--allow-untrusted");
    expect(html).toContain("404");
  });

  it("renders package detail with metadata, versions, dependencies and source", () => {
    const html = renderSite(fixtureCatalog()).get("packages/luci-app-fwlive.html") as string;
    expect(html).toContain("0.1.55-r74");
    expect(html).toContain("2222222222222222222222222222222222222222222222222222222222222222");
    expect(html).toContain("github.com/kiddin9/op-packages/tree/18b7d51c1a06427fa6e8c64b161869de7daded7e/luci-app-fwlive");
    expect(html).toContain("luci-base");
    expect(html).toContain("logd");
    expect(html).toContain('href="../x86_64/luci-app-fwlive-0.1.55-r74.apk"');
    expect(html).toContain("15.6 KiB");
  });

  it("keeps every generated link relative so the project pages subpath works", () => {
    for (const html of renderSite(fixtureCatalog()).values()) {
      if (!html.startsWith("<!doctype") && !html.startsWith("<!DOCTYPE")) continue;
      for (const href of hrefs(html)) {
        if (/^(https?:|mailto:|#)/.test(href)) continue;
        expect(href.startsWith("/"), `${href} must be relative`).toBe(false);
      }
    }
  });

  it("escapes untrusted manifest text", () => {
    const catalog = fixtureCatalog();
    const target = catalog.packages[0];
    if (!target) throw new Error("fixture catalog is empty");
    target.description = '<script>alert("x")</script>';
    const html = renderSite(catalog).get("index.html") as string;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert");
  });

  it("writes catalog.json as the same catalog object", () => {
    const catalog = fixtureCatalog();
    const text = renderSite(catalog).get("catalog.json") as string;
    expect(JSON.parse(text)).toEqual(catalog);
  });

  it("uses relative package links on the index", () => {
    const html = renderSite(fixtureCatalog()).get("index.html") as string;
    expect(html).toContain('href="packages/luci-app-store.html"');
    expect(html).toContain('href="install.html"');
  });

  it("renders a 404 page that links back home", () => {
    const html = renderSite(fixtureCatalog()).get("404.html") as string;
    expect(html).toContain("404");
    expect(html).toContain('href="index.html"');
  });
});

describe("helpers", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(1620000)).toBe("1.5 MiB");
  });

  it("escapes html metacharacters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
