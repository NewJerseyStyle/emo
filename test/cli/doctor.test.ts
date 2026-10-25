import { describe, expect, test } from "bun:test";
import { doctor, formatChecks } from "../../src/cli/doctor";

describe("doctor", () => {
  test("passes with modern git and omo present", () => {
    const checks = doctor("omo", (cmd) => (cmd === "git" ? "git version 2.43.0" : "5.1.34"));
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  test("fails on old git with a hint", () => {
    const checks = doctor("omo", (cmd) => (cmd === "git" ? "git version 2.30.1" : "5.1.34"));
    expect(checks[0]?.ok).toBe(false);
    expect(formatChecks(checks).join("\n")).toContain("2.42");
  });

  test("reports missing omo without throwing", () => {
    const checks = doctor("omo", (cmd) => {
      if (cmd === "git") return "git version 2.50.0";
      throw new Error("ENOENT");
    });
    expect(checks.find((c) => c.name === "omo")?.ok).toBe(false);
  });

  test("flags an omo version other than the tested one", () => {
    const checks = doctor("omo", (cmd) => (cmd === "git" ? "git version 2.50.0" : "6.0.0"));
    expect(checks.find((c) => c.name === "omo")?.detail).toContain("5.1.34");
  });
});
