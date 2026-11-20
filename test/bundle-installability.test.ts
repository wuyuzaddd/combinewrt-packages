import { describe, expect, it } from "vitest";
import { failedPackage, failureMarker } from "../src/bundle-installability.js";

describe("bundle installability failure naming", () => {
  it("formats the exact bundle/package/target marker the ticket asks for", () => {
    expect(failureMarker("proxy-openclash-tun", "kmod-tun", "x86/64")).toBe(
      "bundle=proxy-openclash-tun package=kmod-tun target=x86/64",
    );
  });

  it("names the package apk reported as unresolvable", () => {
    const stderr = [
      "ERROR: unable to select packages:",
      "  kmod-tun (no such package):",
      "    required by: world[kmod-tun]",
    ].join("\n");
    expect(failedPackage(stderr, "", "luci-app-openclash")).toBe("kmod-tun");
  });

  it("falls back to the first bundle package for a generic resolver error", () => {
    expect(failedPackage("ERROR: unable to select packages:", "", "luci-app-openclash")).toBe(
      "luci-app-openclash",
    );
  });
});
