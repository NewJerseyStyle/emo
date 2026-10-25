import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidId, newId, openStore, parse, serialize, validate, findSecrets } from "../../src/kb";

process.env.GIT_AUTHOR_NAME = "Test";
process.env.GIT_AUTHOR_EMAIL = "test@example.com";
process.env.GIT_COMMITTER_NAME = "Test";
process.env.GIT_COMMITTER_EMAIL = "test@example.com";

const tmpDirs: string[] = [];
const sh = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emo-kb-"));
  tmpDirs.push(dir);
  return dir;
}

/** A project repo with one code commit on `main`. */
function makeRepo(): string {
  const dir = tmp();
  sh(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "app.txt"), "code\n");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "init");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold git files open; temp dir cleanup is best-effort.
    }
  }
});

const LESSON_BODY = `## What happened
Retried the flaky integration test five times.

## Why
It depends on a port that the dev server already holds.

## Do differently
Run it with PORT=0 or stop the dev server first.
`;

describe("frontmatter", () => {
  it("round-trips strings, numbers, booleans, arrays and awkward strings", () => {
    const fm = {
      id: "x-1",
      title: "colons: and \"quotes\"",
      n: 42,
      flag: true,
      numericString: "123",
      tags: ["a b", "c,d", "e"],
      empty: "",
    };
    const parsed = parse(serialize(fm, "body text"));
    expect(parsed?.frontmatter).toEqual(fm);
    expect(parsed?.body).toBe("body text\n");
  });

  it("returns null without a frontmatter block", () => {
    expect(parse("# just markdown")).toBeNull();
  });
});

describe("ids", () => {
  it("builds sortable valid ids and tells writers apart", () => {
    const at = new Date("2026-10-25T08:09:10.123Z");
    const a = newId("lesson", "Ada Lovelace", at, "abcd");
    expect(a).toBe("lesson-20261025T080910-ada-lovelace-abcd");
    expect(isValidId(a)).toBe(true);
    expect(newId("lesson", "Bob", at, "abcd")).not.toBe(a);
    expect(isValidId("lesson-bad")).toBe(false);
  });
});

describe("scrub", () => {
  it("flags credential-like text and passes ordinary prose", () => {
    expect(findSecrets("token ghp_" + "a".repeat(36))).toContain("GitHub token");
    expect(findSecrets("password = hunter2hunter2")).toContain("credential assignment");
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----")).toContain("private key block");
    expect(findSecrets("The password policy requires rotation.")).toEqual([]);
  });
});

describe("schema", () => {
  const base = { id: "i", created: "t", author: "a" };
  it("requires all three lesson sections", () => {
    const fm = { ...base, type: "lesson", title: "t" };
    expect(validate("lesson", fm, LESSON_BODY)).toEqual([]);
    const errs = validate("lesson", fm, "## What happened\nx\n\n## Why\nbecause\n");
    expect(errs.some((e) => e.includes("Do differently"))).toBe(true);
  });

  it("rejects an empty section", () => {
    const fm = { ...base, type: "lesson", title: "t" };
    const errs = validate("lesson", fm, "## What happened\nx\n## Why\n\n## Do differently\ny\n");
    expect(errs.some((e) => e.includes('"## Why"'))).toBe(true);
  });
});

describe("store", () => {
  it("mounts an orphan exp branch without touching the code branch", () => {
    const repo = makeRepo();
    const store = openStore({ repo, author: "ada" });

    expect(fs.existsSync(path.join(store.root, "EMO.md"))).toBe(true);
    expect(sh(repo, "branch", "--show-current")).toBe("main");
    expect(sh(repo, "status", "--porcelain")).toBe("");
    expect(sh(repo, "log", "--oneline", "main")).not.toContain("emo");
    expect(sh(store.root, "rev-list", "--count", "--max-parents=0", "HEAD")).toBe("1");
  });

  it("adds a lesson as one committed file and reads it back", () => {
    const store = openStore({ repo: makeRepo(), author: "ada" });
    const doc = store.addDoc({ kind: "lesson", meta: { title: "Port clash" }, body: LESSON_BODY });

    expect(doc.path.startsWith("inbox/lesson-")).toBe(true);
    expect(store.get(doc.id)?.frontmatter.title).toBe("Port clash");
    expect(store.list("lesson").map((d) => d.id)).toEqual([doc.id]);
    expect(sh(store.root, "status", "--porcelain")).toBe("");
    expect(sh(store.root, "log", "-1", "--format=%s")).toBe(`lesson: ${doc.id}`);
  });

  it("refuses invalid documents, secrets, reserved keys and dangling links", () => {
    const store = openStore({ repo: makeRepo(), author: "ada" });
    expect(() =>
      store.addDoc({ kind: "lesson", meta: { title: "t" }, body: "## What happened\nx\n" }),
    ).toThrow("invalid lesson");
    expect(() =>
      store.addDoc({
        kind: "lesson",
        meta: { title: "t" },
        body: LESSON_BODY + "\nkey: sk-" + "a".repeat(30),
      }),
    ).toThrow("credential-like");
    expect(() =>
      store.addDoc({ kind: "lesson", meta: { title: "t", id: "x" }, body: LESSON_BODY }),
    ).toThrow("set by the store");
    expect(() =>
      store.addDoc({
        kind: "closure",
        meta: { plan: "plan-20260101T000000-ada-0000", outcome: "done" },
        body: "## Plan vs actual\nsame\n\n## Lessons\nnone\n",
      }),
    ).toThrow("does not exist");
    expect(store.list("lesson")).toEqual([]);
    expect(sh(store.root, "status", "--porcelain")).toBe("");
  });

  it("links a closure to its plan", () => {
    const store = openStore({ repo: makeRepo(), author: "ada" });
    const plan = store.addDoc({
      kind: "plan",
      meta: { goal: "ship login", status: "confirmed" },
      body: "## Tasks\n- add form\n",
    });
    const closure = store.addDoc({
      kind: "closure",
      meta: { plan: plan.id, outcome: "done", tokens_estimated: 50000, tokens_actual: 82000 },
      body: "## Plan vs actual\nOver by 64%.\n\n## Lessons\nSee inbox.\n",
    });
    expect(store.get(closure.id)?.frontmatter.plan).toBe(plan.id);
  });

  it("two teammates add concurrently and sync without conflicts", { timeout: 60_000 }, () => {
    const remote = tmp();
    sh(remote, "init", "-q", "--bare", "-b", "main");
    const a = tmp();
    const b = tmp();
    sh(a, "clone", "-q", remote, ".");
    fs.writeFileSync(path.join(a, "app.txt"), "code\n");
    sh(a, "add", "-A");
    sh(a, "commit", "-q", "-m", "init");
    sh(a, "push", "-q", "origin", "main");
    sh(b, "clone", "-q", remote, ".");

    const sa = openStore({ repo: a, author: "ada" });
    const sb = openStore({ repo: b, author: "bob" });
    // Both created their own orphan `exp` before either pushed: the identical
    // EMO.md root commit is absorbed by the rebase, so this must not conflict.
    const la = sa.addDoc({ kind: "lesson", meta: { title: "A" }, body: LESSON_BODY });
    const lb = sb.addDoc({ kind: "lesson", meta: { title: "B" }, body: LESSON_BODY });

    sa.sync();
    sb.sync();
    sa.sync();

    const ids = (s: typeof sa) => s.list("lesson").map((d) => d.id).sort();
    expect(ids(sa)).toEqual([la.id, lb.id].sort());
    expect(ids(sb)).toEqual(ids(sa));
    expect(sh(sa.root, "rev-list", "--count", "--max-parents=0", "HEAD")).toBe("1");
  });
});
