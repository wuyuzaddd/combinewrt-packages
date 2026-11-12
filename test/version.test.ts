import { describe, expect, it } from "vitest";

import { compareVersions, sortVersionsDescending } from "../src/version.js";

describe("compareVersions", () => {
  it("orders package releases numerically, not lexically", () => {
    expect(compareVersions("1.0-r2", "1.0-r10")).toBeLessThan(0);
    expect(compareVersions("2.7.3-r25", "2.7.3-r9")).toBeGreaterThan(0);
  });

  it("treats a missing release as -r0", () => {
    expect(compareVersions("1.0", "1.0-r1")).toBeLessThan(0);
    expect(compareVersions("1.0-r0", "1.0")).toBe(0);
  });

  it("sorts tilde pre-releases before the release", () => {
    expect(compareVersions("1.0~beta1", "1.0")).toBeLessThan(0);
    expect(compareVersions("1.0~beta2", "1.0~beta10")).toBeLessThan(0);
    expect(compareVersions("1.0~beta", "1.0~alpha")).toBeGreaterThan(0);
  });

  it("compares dot-separated components numerically", () => {
    expect(compareVersions("4.18.0", "4.17.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    expect(compareVersions("1.10", "1.9")).toBeGreaterThan(0);
  });

  it("sorts a version list newest first", () => {
    const sorted = sortVersionsDescending([
      { version: "4.16.0-r1" },
      { version: "4.18.0-r1" },
      { version: "4.17.0-r1" },
      { version: "4.18.0-r2" },
    ]);
    expect(sorted.map((item) => item.version)).toEqual([
      "4.18.0-r2",
      "4.18.0-r1",
      "4.17.0-r1",
      "4.16.0-r1",
    ]);
  });
});
