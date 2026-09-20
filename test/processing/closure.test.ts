import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClosureExporter, renderClosure } from "../../src/export/closure";
import { makeSnapshot } from "./fixture";
import { sha256Text } from "../../src/snapshot";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "emo-closure-"));
  roots.push(root);
  return root;
}

describe("deterministic closure export", () => {
  it("renders truthful scoped usage without a savings claim", () => {
    const closure = renderClosure(makeSnapshot());
    expect(renderClosure(makeSnapshot())).toBe(closure);
    expect(closure).toContain("- Tokens used: not measured");
    expect(closure).toContain("- Time used: not measured");
    expect(closure).toContain("### goal-1");
    expect(closure).toContain("- Tokens used: 120");
    expect(closure).toContain("### goal-2");
    expect(closure).toContain("- Tokens used: 80");
    expect(closure).not.toContain("Tokens used: 200");
    expect(closure).not.toContain("tokens_saved");
    expect(closure).toContain("No token-savings measurement is asserted");
  });

  it("publishes complete immutable bytes and treats an identical digest as idempotent", async () => {
    const projectRoot = temporaryRoot();
    const root = path.join(projectRoot, ".emo-output");
    const exporter = createClosureExporter({ root, projectRoot });
    const snapshot = makeSnapshot();
    const first = await exporter.export(snapshot, { idempotencyKey: "first", projectRoot });
    const second = await exporter.export(snapshot, { idempotencyKey: "second", projectRoot });
    expect(second).toEqual(first);
    expect(fs.readFileSync(first.path, "utf8")).toBe(renderClosure(snapshot));
    expect(fs.readdirSync(path.dirname(first.path))).toEqual([path.basename(first.path)]);
  });

  it("leaves no final file when failure occurs before publication", async () => {
    const projectRoot = temporaryRoot();
    const root = path.join(projectRoot, "closures");
    const exporter = createClosureExporter({
      root,
      projectRoot,
      publicationHooks: { beforeLink: () => { throw new Error("injected"); } },
    });
    await expect(exporter.export(makeSnapshot(), { idempotencyKey: "key", projectRoot })).rejects.toThrow("injected");
    const markdown = fs.existsSync(root)
      ? [...fs.readdirSync(root, { recursive: true })].filter((name) => String(name).endsWith(".md"))
      : [];
    expect(markdown).toHaveLength(0);
  });

  it("recovers idempotently from interruption after publication", async () => {
    const projectRoot = temporaryRoot();
    const root = path.join(projectRoot, "closures");
    const snapshot = makeSnapshot();
    let interrupted = false;
    const exporter = createClosureExporter({
      root,
      projectRoot,
      publicationHooks: { afterLink: () => { interrupted = true; throw new Error("injected"); } },
    });
    await expect(exporter.export(snapshot, { idempotencyKey: "key", projectRoot })).rejects.toThrow("injected");
    expect(interrupted).toBeTrue();
    const retry = await createClosureExporter({ root, projectRoot }).export(snapshot, { idempotencyKey: "key", projectRoot });
    expect(fs.readFileSync(retry.path, "utf8")).toBe(renderClosure(snapshot));
  });

  it("rejects a descendant directory symlinked into .omo", async () => {
    const projectRoot = temporaryRoot();
    const protectedRoot = path.join(projectRoot, ".omo");
    const root = path.join(projectRoot, "closures");
    fs.mkdirSync(protectedRoot);
    fs.mkdirSync(root);
    const snapshot = makeSnapshot();
    fs.symlinkSync(protectedRoot, path.join(root, sha256Text(snapshot.projectID)));
    const exporter = createClosureExporter({ root, projectRoot });

    await expect(
      exporter.export(snapshot, { idempotencyKey: "key", projectRoot }),
    ).rejects.toThrow();
    expect(fs.readdirSync(protectedRoot)).toEqual([]);
  });

  it("rejects protected direct, nested, and symlink-aliased roots before creation", () => {
    const projectRoot = temporaryRoot();
    const protectedRoot = path.join(projectRoot, ".omo");
    fs.mkdirSync(protectedRoot);
    expect(() => createClosureExporter({ root: protectedRoot, projectRoot })).toThrow();
    expect(() => createClosureExporter({ root: path.join(protectedRoot, "closures"), projectRoot })).toThrow();
    const alias = path.join(projectRoot, "alias");
    fs.symlinkSync(protectedRoot, alias);
    expect(() => createClosureExporter({ root: path.join(alias, "closures"), projectRoot })).toThrow();
    expect(fs.readdirSync(protectedRoot)).toEqual([]);
  });
});
