import { describe, expect, it } from "bun:test";
import { buildArgs, isTransient, openOmo, retryDelaySeconds } from "../../src/driver/omo";
import type { ChildLike, SpawnFn } from "../../src/driver/omo";

type Script = (message: string, emit: (ev: object) => void) => void;

/** A fake omo: each prompt line runs the next script step, which emits JSONL events. */
function fakeOmo(steps: Script[]): { spawn: SpawnFn; prompts: string[]; killed: () => boolean } {
  const prompts: string[] = [];
  let killed = false;
  const spawn: SpawnFn = () => {
    let onData: (c: string) => void = () => {};
    const child: ChildLike = {
      stdin: {
        write(chunk: string) {
          const cmd = JSON.parse(chunk) as { message: string };
          prompts.push(cmd.message);
          const step = steps[prompts.length - 1];
          queueMicrotask(() => step?.(cmd.message, (ev) => onData(`${JSON.stringify(ev)}\n`)));
        },
      },
      stdout: { on: (_e, cb) => void (onData = cb as (c: string) => void) },
      stderr: null,
      on: () => {},
      kill: () => void (killed = true),
    };
    return child;
  };
  return { spawn, prompts, killed: () => killed };
}

const settle = (emit: (ev: object) => void, opts: { text?: string; error?: string; tools?: number } = {}) => {
  emit({ type: "agent_start" });
  for (let i = 0; i < (opts.tools ?? 0); i++) emit({ type: "tool_execution_start" });
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      content: opts.text === undefined ? [] : [{ type: "text", text: opts.text }],
      ...(opts.error !== undefined ? { errorMessage: opts.error } : {}),
    },
  });
  emit({ type: "agent_end" });
  emit({ type: "agent_settled" });
};

describe("helpers", () => {
  it("parses provider retry delays", () => {
    expect(retryDelaySeconds("429: Please try again in 3.8775s. Need more")).toBeCloseTo(3.8775);
    expect(retryDelaySeconds("try again in 1m2.5s")).toBeCloseTo(62.5);
    expect(retryDelaySeconds("something else")).toBeNull();
  });

  it("classifies transient errors", () => {
    expect(isTransient("429: Rate limit reached")).toBe(true);
    expect(isTransient("Connection error.")).toBe(true);
    expect(isTransient("400: Unexpected message role")).toBe(false);
  });

  it("builds rpc args", () => {
    expect(
      buildArgs({ cwd: ".", model: "groq/x", skills: ["a", "b"], appendSystemPrompt: "hi", extraArgs: ["--offline"] }),
    ).toEqual(["--mode", "rpc", "--no-session", "--model", "groq/x", "--skill", "a", "--skill", "b", "--append-system-prompt", "hi", "--offline"]);
  });
});

describe("openOmo", () => {
  it("resolves on agent_settled with text and tool count", async () => {
    const fake = fakeOmo([(_m, emit) => settle(emit, { text: "done", tools: 2 })]);
    const omo = openOmo({ cwd: ".", spawn: fake.spawn });
    expect(await omo.prompt("go")).toEqual({ ok: true, error: null, text: "done", toolCalls: 2, retries: 0 });
  });

  it("waits and continues after a rate limit, accumulating tool calls", async () => {
    const slept: number[] = [];
    const fake = fakeOmo([
      (_m, emit) => settle(emit, { error: "429: Rate limit. Please try again in 4.5s.", tools: 1 }),
      (_m, emit) => settle(emit, { text: "finished", tools: 2 }),
    ]);
    const omo = openOmo({ cwd: ".", spawn: fake.spawn, sleep: async (ms) => void slept.push(ms) });
    const result = await omo.prompt("go");
    expect(result).toMatchObject({ ok: true, text: "finished", toolCalls: 3, retries: 1 });
    expect(slept).toEqual([6500]);
    expect(fake.prompts[1]).toBe("Continue the task where you left off.");
  });

  it("does not retry non-transient errors", async () => {
    const fake = fakeOmo([(_m, emit) => settle(emit, { error: "400: Unexpected message role" })]);
    const omo = openOmo({ cwd: ".", spawn: fake.spawn, sleep: async () => {} });
    const result = await omo.prompt("go");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("400");
    expect(fake.prompts.length).toBe(1);
  });

  it("gives up after maxRetries", async () => {
    const fail: Script = (_m, emit) => settle(emit, { error: "429: try again in 1s" });
    const fake = fakeOmo([fail, fail, fail]);
    const omo = openOmo({ cwd: ".", spawn: fake.spawn, sleep: async () => {}, maxRetries: 2 });
    const result = await omo.prompt("go");
    expect(result).toMatchObject({ ok: false, retries: 2 });
    expect(fake.prompts.length).toBe(3);
  });

  it("rejects when omo refuses the command", async () => {
    const fake = fakeOmo([(_m, emit) => emit({ type: "response", success: false, error: "Agent is already processing" })]);
    const omo = openOmo({ cwd: ".", spawn: fake.spawn });
    await expect(omo.prompt("go")).rejects.toThrow("already processing");
  });

  it("kills the child on close", () => {
    const fake = fakeOmo([]);
    openOmo({ cwd: ".", spawn: fake.spawn }).close();
    expect(fake.killed()).toBe(true);
  });
});
