// Live end-to-end check: real omo + a real model. Needs a provider key in .env (git-ignored).
//   bun run scripts/e2e-live.ts ["task text"]
// Env: E2E_MODEL (default groq/qwen/qwen3.8-27b), OMO_BIN (default omo), E2E_KEEP=1 to keep the temp project.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openOmo } from "../src/driver/omo";
import { runWorkItem } from "../src/driver/workitem";
import { openStore } from "../src/kb";

const root = path.resolve(import.meta.dir, "..");

// Load .env without printing it.
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m !== null && process.env[m[1] as string] === undefined) process.env[m[1] as string] = m[2] as string;
  }
}

const model = process.env.E2E_MODEL ?? "groq/qwen/qwen3.8-27b";
const task =
  process.argv[2] ??
  "New goal: add a file notes.md with one line describing this demo project. " +
    "First use the read tool to read the emo-ba skill file listed in your available skills and follow it, " +
    "running the emo CLI with the powershell tool. Do not ask me questions; assume the goal is clear and confirmed. " +
    "Then create the file, then follow the emo-closure skill.";

// Project under test: a throwaway git repo with `emo` on PATH.
const project = fs.mkdtempSync(path.join(os.tmpdir(), "emo-live-"));
const bin = fs.mkdtempSync(path.join(os.tmpdir(), "emo-bin-"));
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "emo-agent-"));
const cli = path.join(root, "src", "cli.ts").replace(/\\/g, "/");
if (process.platform === "win32") {
  fs.writeFileSync(path.join(bin, "emo.cmd"), `@echo off\r\nbun run ${cli} %*\r\n`);
} else {
  fs.writeFileSync(path.join(bin, "emo"), `#!/bin/sh\nexec bun run ${cli} "$@"\n`, { mode: 0o755 });
}
// Some providers (e.g. Groq's qwen) reject the "developer" role omo uses for reasoning models.
fs.writeFileSync(
  path.join(agentDir, "models.json"),
  JSON.stringify({ providers: { groq: { baseUrl: "https://api.groq.com/openai/v1", compat: { supportsDeveloperRole: false } } } }),
);

const git = (...args: string[]) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("-c", "user.name=ada", "-c", "user.email=ada@example.com", "commit", "-q", "--allow-empty", "-m", "init");

const gitIdentity = { GIT_AUTHOR_NAME: "ada", GIT_COMMITTER_NAME: "ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_EMAIL: "ada@example.com" };
Object.assign(process.env, gitIdentity);
const store = openStore({ repo: project, author: "ada" });

console.log(`project: ${project}\nmodel:   ${model}`);
const omo = openOmo({
  cwd: project,
  bin: process.env.OMO_BIN ?? "omo",
  model,
  maxRetries: Number(process.env.E2E_RETRIES ?? 30),
  thinking: (process.env.E2E_THINKING as "off" | "low" | undefined) ?? "low",
  skills: ["emo-ba", "emo-pm", "emo-closure"].map((s) => path.join(root, "skills", s)),
  appendSystemPrompt:
    "You are a coding agent. Use the powershell tool to run commands. The `emo` CLI is on PATH. " +
    "Never claim work is done unless a tool call confirmed it.",
  extraArgs: ["--offline", "--no-extensions", "--no-context-files", "--no-prompt-templates", "--tools", "powershell,read,write"],
  env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, OMO_CODING_AGENT_DIR: agentDir, ...gitIdentity },
  onEvent: (ev) => {
    if (ev.type === "tool_execution_start") console.log("  tool:", JSON.stringify(ev.args ?? ev).slice(0, 160));
  },
});

try {
  const started = Date.now();
  const result = await runWorkItem({ omo, store, task, maxNudges: 2 });
  console.log(`\nfinished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log("run:", { ok: result.run.ok, error: result.run.error?.slice(0, 420) ?? null, toolCalls: result.run.toolCalls, retries: result.run.retries });
  console.log("closure:", result.closureId, "| plan:", result.planId, "| lessons:", result.newLessons.length, "| nudges:", result.nudges);
  console.log("store problems:", result.problems.length === 0 ? "none" : JSON.stringify(result.problems));
  console.log("project files:", fs.readdirSync(project).filter((f) => f !== ".git" && f !== ".emo").join(", ") || "(none)");
  console.log("assistant said:", result.run.text.slice(0, 300));
  process.exitCode = result.closureId !== null && result.run.ok ? 0 : 1;
} finally {
  omo.close();
  if (process.env.E2E_KEEP !== "1") {
    for (const dir of [project, bin, agentDir]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
