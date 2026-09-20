import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReadBudget, readBoundedText, resolveAllowedRoots } from "../../src/artifacts/read";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "emo-artifact-read-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readBoundedText", () => {
  test("reads a regular UTF-8 file with digest and byte provenance", async () => {
    const root = temporaryRoot();
    const file = path.join(root, "evidence.md");
    writeFileSync(file, "hello");
    const allowedRoots = await resolveAllowedRoots(root, []);
    const result = await readBoundedText({
      candidatePath: file,
      displayPath: "evidence",
      allowedRoots,
      maxBytes: 10,
      budget: createReadBudget(20),
    });
    expect(result.state).toBe("present");
    if (result.state !== "present") return;
    expect(result.text).toBe("hello");
    expect(result.source).toMatchObject({ relativePath: "evidence.md", bytes: 5 });
    expect(result.source.sha256).toHaveLength(64);
  });

  test("rejects traversal outside an allowed root", async () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    const file = path.join(outside, "secret.md");
    writeFileSync(file, "secret");
    const result = await readBoundedText({
      candidatePath: file,
      displayPath: "active_plan",
      allowedRoots: await resolveAllowedRoots(root, []),
      maxBytes: 10,
      budget: createReadBudget(20),
    });
    expect(result).toMatchObject({ state: "rejected", diagnostic: { code: "read.unsafe_path" } });
  });

  test("rejects symlink components and non-regular files", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "target.md");
    writeFileSync(target, "target");
    const link = path.join(root, "link.md");
    symlinkSync(target, link);
    const allowedRoots = await resolveAllowedRoots(root, []);
    const linked = await readBoundedText({
      candidatePath: link,
      displayPath: "active_plan",
      allowedRoots,
      maxBytes: 10,
      budget: createReadBudget(20),
    });
    expect(linked).toMatchObject({ state: "rejected", diagnostic: { code: "read.symlink" } });

    mkdirSync(path.join(root, "directory"));
    const directory = await readBoundedText({
      candidatePath: path.join(root, "directory"),
      displayPath: "active_plan",
      allowedRoots,
      maxBytes: 10,
      budget: createReadBudget(20),
    });
    expect(directory).toMatchObject({ state: "rejected", diagnostic: { code: "read.not_regular" } });
  });

  test("enforces per-file and aggregate byte limits", async () => {
    const root = temporaryRoot();
    const file = path.join(root, "large.md");
    writeFileSync(file, "123456");
    const allowedRoots = await resolveAllowedRoots(root, []);
    const tooLarge = await readBoundedText({
      candidatePath: file,
      displayPath: "artifact",
      allowedRoots,
      maxBytes: 5,
      budget: createReadBudget(20),
    });
    expect(tooLarge).toMatchObject({ state: "rejected", diagnostic: { code: "read.too_large" } });

    const aggregate = await readBoundedText({
      candidatePath: file,
      displayPath: "artifact",
      allowedRoots,
      maxBytes: 10,
      budget: createReadBudget(5),
    });
    expect(aggregate).toMatchObject({ state: "rejected", diagnostic: { code: "read.aggregate_too_large" } });
  });

  test("rejects malformed UTF-8", async () => {
    const root = temporaryRoot();
    const file = path.join(root, "bad.md");
    writeFileSync(file, new Uint8Array([0xc3, 0x28]));
    const result = await readBoundedText({
      candidatePath: file,
      displayPath: "artifact",
      allowedRoots: await resolveAllowedRoots(root, []),
      maxBytes: 10,
      budget: createReadBudget(20),
    });
    expect(result).toMatchObject({ state: "rejected", diagnostic: { code: "read.invalid_utf8" } });
  });
});
