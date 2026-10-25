import { spawn as nodeSpawn } from "node:child_process";

/** Minimal child-process surface the driver needs; tests inject a fake. */
export interface ChildLike {
  stdin: { write(chunk: string): unknown };
  stdout: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown };
  stderr?: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown } | null;
  on(event: "exit", cb: () => void): unknown;
  kill(): unknown;
}

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildLike;

export interface OmoOptions {
  cwd: string;
  /** Path of the omo binary. Default: `omo`. */
  bin?: string;
  /** e.g. `groq/qwen/qwen3.8-27b`. */
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  /** Directories of skills to load explicitly (`--skill`). */
  skills?: string[];
  /** Text appended to the system prompt. */
  appendSystemPrompt?: string;
  /** Extra raw CLI flags (e.g. `--no-extensions`). */
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /** How many times a rate-limited / transient failure is retried per prompt. Default 8. */
  maxRetries?: number;
  /** Give up on a single run after this long. Default 10 minutes. */
  runTimeoutMs?: number;
  /** Observe raw events (already parsed). */
  onEvent?: (event: Record<string, unknown>) => void;
  spawn?: SpawnFn;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunResult {
  ok: boolean;
  error: string | null;
  /** Concatenated assistant text of the last attempt. */
  text: string;
  toolCalls: number;
  retries: number;
}

export interface OmoSession {
  prompt(message: string): Promise<RunResult>;
  close(): void;
}

/** CLI flags for an RPC session. Pure, so it can be tested. */
export function buildArgs(opts: OmoOptions): string[] {
  const args = ["--mode", "rpc", "--no-session"];
  if (opts.model !== undefined) args.push("--model", opts.model);
  if (opts.thinking !== undefined) args.push("--thinking", opts.thinking);
  for (const skill of opts.skills ?? []) args.push("--skill", skill);
  if (opts.appendSystemPrompt !== undefined) args.push("--append-system-prompt", opts.appendSystemPrompt);
  args.push(...(opts.extraArgs ?? []));
  return args;
}

const TRANSIENT_RE = /\b429\b|rate limit|connection error|overloaded|timeout|503|502/i;

/** Seconds the provider asked us to wait ("try again in 3.87s" / "in 1m2.5s"), or null. */
export function retryDelaySeconds(error: string): number | null {
  const m = /try again in (?:(\d+)m)?\s*([\d.]+)s/i.exec(error);
  if (m === null) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

export function isTransient(error: string): boolean {
  return TRANSIENT_RE.test(error);
}

interface Pending {
  resolve(result: RunResult): void;
  reject(err: Error): void;
  toolCalls: number;
  text: string;
  error: string | null;
}

export function openOmo(opts: OmoOptions): OmoSession {
  const spawnFn: SpawnFn =
    opts.spawn ??
    ((cmd, args, o) => nodeSpawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"] }) as ChildLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 8;
  const runTimeoutMs = opts.runTimeoutMs ?? 10 * 60_000;

  const child = spawnFn(opts.bin ?? "omo", buildArgs(opts), {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
  child.stderr?.on("data", () => {});

  let pending: Pending | null = null;
  let exited = false;
  let buffer = "";

  const handle = (ev: Record<string, unknown>): void => {
    opts.onEvent?.(ev);
    const run = pending;
    if (run === null) return;
    switch (ev.type) {
      case "agent_start":
        run.error = null;
        run.text = "";
        break;
      case "tool_execution_start":
        run.toolCalls++;
        break;
      case "message_end": {
        const msg = ev.message as { role?: string; content?: unknown; errorMessage?: unknown } | undefined;
        if (msg?.role === "assistant") {
          if (Array.isArray(msg.content)) {
            run.text += (msg.content as { type?: string; text?: string }[])
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("");
          }
          if (typeof msg.errorMessage === "string") run.error = msg.errorMessage;
        }
        break;
      }
      case "response":
        if (ev.success === false) {
          pending = null;
          run.reject(new Error(`omo rejected command: ${String(ev.error ?? "unknown")}`));
        }
        break;
      case "agent_settled":
        pending = null;
        run.resolve({ ok: run.error === null, error: run.error, text: run.text.trim(), toolCalls: run.toolCalls, retries: 0 });
        break;
    }
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      try {
        handle(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // non-JSON line (startup noise): ignore
      }
    }
  });

  child.on("exit", () => {
    exited = true;
    const run = pending;
    pending = null;
    run?.reject(new Error("omo exited before the run settled"));
  });

  let counter = 0;
  const once = (message: string): Promise<RunResult> =>
    new Promise<RunResult>((resolve, reject) => {
      if (exited) return reject(new Error("omo is not running"));
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error(`omo run timed out after ${runTimeoutMs}ms`));
      }, runTimeoutMs);
      pending = {
        resolve: (r) => (clearTimeout(timer), resolve(r)),
        reject: (e) => (clearTimeout(timer), reject(e)),
        toolCalls: 0,
        text: "",
        error: null,
      };
      child.stdin.write(`${JSON.stringify({ id: `p${++counter}`, type: "prompt", message })}\n`);
    });

  const prompt = async (message: string): Promise<RunResult> => {
    let toolCalls = 0;
    let retries = 0;
    let next = message;
    for (;;) {
      const result = await once(next);
      toolCalls += result.toolCalls;
      if (result.ok || result.error === null || !isTransient(result.error) || retries >= maxRetries) {
        return { ...result, toolCalls, retries };
      }
      retries++;
      const waitSeconds = (retryDelaySeconds(result.error) ?? 5) + 2;
      await sleep(Math.ceil(waitSeconds * 1000));
      next = "Continue the task where you left off.";
    }
  };

  return {
    prompt,
    close: () => {
      exited = true;
      child.kill();
    },
  };
}
