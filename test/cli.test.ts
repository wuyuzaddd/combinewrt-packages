import { describe, expect, it } from "vitest";

import { usage } from "../src/cli.js";

describe("cli", () => {
  it("describes the fixture, generate and verify commands", () => {
    const text = usage();
    expect(text).toContain("fixture");
    expect(text).toContain("generate");
    expect(text).toContain("verify");
  });
});
