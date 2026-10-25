import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../../src/kb";
import type { Store } from "../../src/kb";
import { runWorkItem } from "../../src/driver/workitem";
import type { OmoSession, RunResult } from "../../src/driver/omo";

process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "test@example.com";

const dirs: string[] = [];
function makeStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "emo-wi-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: dir });
  return openStore({ repo: dir, author: "ada" });
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort on Windows
    }
  }
});

const OK: RunResult = { ok: true, error: null, text: "done", toolCalls: 1, retries: 0 };
const LESSON = "## What happened\na\n\n## Why\nb\n\n## Do differently\nc\n";

function writeClosure(store: Store, plan: string): void {
  store.addDoc({
    kind: "closure",
    meta: { plan, outcome: "done" },
    body: "## Plan vs actual\nsame\n\n## Lessons\nnone\n",
  });
}

describe("runWorkItem", () => {
  it("accepts a closure the agent wrote on its own, without nudging", async () => {
    const store = makeStore();
    const prompts: string[] = [];
    const omo: OmoSession = {
      prompt: async (m) => {
        prompts.push(m);
        const plan = store.addDoc({ kind: "plan", meta: { goal: "g", status: "confirmed" }, body: "## Tasks\nx\n" });
        store.addDoc({ kind: "lesson", meta: { title: "t" }, body: LESSON });
        writeClosure(store, plan.id);
        return OK;
      },
      close() {},
    };
    const result = await runWorkItem({ omo, store, task: "do it" });
    expect(prompts).toEqual(["do it"]);
    expect(result).toMatchObject({ nudges: 0, problems: [] });
    expect(result.closureId).not.toBeNull();
    expect(result.newLessons.length).toBe(1);
    expect(result.planId).toBe(store.get(result.closureId as string)?.frontmatter.plan as string);
  });

  it("reminds the agent when the closure is missing", async () => {
    const store = makeStore();
    const plan = store.addDoc({ kind: "plan", meta: { goal: "g", status: "confirmed" }, body: "## Tasks\nx\n" });
    let calls = 0;
    const omo: OmoSession = {
      prompt: async () => {
        if (++calls === 2) writeClosure(store, plan.id);
        return OK;
      },
      close() {},
    };
    const result = await runWorkItem({ omo, store, task: "do it" });
    expect(result.nudges).toBe(1);
    expect(result.closureId).not.toBeNull();
  });

  it("reports no closure after the nudges are used up", async () => {
    const store = makeStore();
    let calls = 0;
    const omo: OmoSession = { prompt: async () => (calls++, OK), close() {} };
    const result = await runWorkItem({ omo, store, task: "do it", maxNudges: 2 });
    expect(calls).toBe(3);
    expect(result).toMatchObject({ closureId: null, nudges: 2 });
  });

  it("does not nudge a run that failed", async () => {
    const store = makeStore();
    let calls = 0;
    const omo: OmoSession = {
      prompt: async () => (calls++, { ...OK, ok: false, error: "400: bad" }),
      close() {},
    };
    const result = await runWorkItem({ omo, store, task: "do it" });
    expect(calls).toBe(1);
    expect(result.run.ok).toBe(false);
  });
});
