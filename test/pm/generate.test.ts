import { describe, expect, it } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { generateTasks } from "../../src/pm/generate";

type PromptResult = { data?: { parts?: Array<{ type: string; text?: string }> } };

function mockClient(responseText: string): OpencodeClient {
  return {
    session: {
      create: async () => ({ data: { id: "sess-test" } }),
      prompt: async (): Promise<PromptResult> => ({
        data: { parts: [{ type: "text", text: responseText }] },
      }),
    },
  } as unknown as OpencodeClient;
}

function mockClientCapture(capture: { prompt: string }): OpencodeClient {
  return {
    session: {
      create: async () => ({ data: { id: "sess-test" } }),
      prompt: async (args: { body: { parts?: Array<{ type: string; text?: string }> } }): Promise<PromptResult> => {
        const text = args.body.parts?.[0]?.text ?? "";
        capture.prompt = text;
        return {
          data: {
            parts: [
              {
                type: "text",
                text: JSON.stringify({
                  tasks: [{ id: "t1", title: "x", docTokens: 1, codeTokens: 2, complexity: "low", dependencies: [] }],
                }),
              },
            ],
          },
        };
      },
    },
  } as unknown as OpencodeClient;
}

describe("generateTasks", () => {
  it("parses a valid task list from the LLM", async () => {
    const client = mockClient(
      JSON.stringify({
        tasks: [
          { id: "t1", title: "setup", docTokens: 50, codeTokens: 200, complexity: "low", dependencies: [] },
          { id: "t2", title: "build", docTokens: 100, codeTokens: 500, complexity: "medium", dependencies: ["t1"] },
        ],
      }),
    );

    const tasks = await generateTasks(client, "build a dashboard");
    expect(tasks).not.toBeNull();
    expect(tasks!.length).toBe(2);
    expect(tasks![1].dependencies).toEqual(["t1"]);
  });

  it("strips markdown code fences before parsing", async () => {
    const client = mockClient(
      "```json\n{\"tasks\":[{\"id\":\"t1\",\"title\":\"x\",\"docTokens\":1,\"codeTokens\":2,\"complexity\":\"low\",\"dependencies\":[]}]}\n```",
    );

    const tasks = await generateTasks(client, "goal");
    expect(tasks).not.toBeNull();
    expect(tasks![0].id).toBe("t1");
  });

  it("returns null on invalid complexity", async () => {
    const client = mockClient(
      JSON.stringify({
        tasks: [{ id: "t1", title: "x", docTokens: 1, codeTokens: 2, complexity: "extreme", dependencies: [] }],
      }),
    );

    expect(await generateTasks(client, "goal")).toBeNull();
  });

  it("returns null on dangling dependency reference", async () => {
    const client = mockClient(
      JSON.stringify({
        tasks: [{ id: "t1", title: "x", docTokens: 1, codeTokens: 2, complexity: "low", dependencies: ["t9"] }],
      }),
    );

    expect(await generateTasks(client, "goal")).toBeNull();
  });

  it("returns null on duplicate task ids", async () => {
    const client = mockClient(
      JSON.stringify({
        tasks: [
          { id: "t1", title: "a", docTokens: 1, codeTokens: 2, complexity: "low", dependencies: [] },
          { id: "t1", title: "b", docTokens: 1, codeTokens: 2, complexity: "low", dependencies: [] },
        ],
      }),
    );

    expect(await generateTasks(client, "goal")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const client = mockClient("not json at all");
    expect(await generateTasks(client, "goal")).toBeNull();
  });

  it("prepends prior context to the prompt when provided", async () => {
    const capture: { prompt: string } = { prompt: "" };
    const client = mockClientCapture(capture);

    await generateTasks(client, "build a dashboard", "# Closure A");

    expect(capture.prompt).toContain("# Closure A");
    expect(capture.prompt).toContain("build a dashboard");
  });

  it("omits context prefix when context is empty", async () => {
    const capture: { prompt: string } = { prompt: "" };
    const client = mockClientCapture(capture);

    await generateTasks(client, "build a dashboard", "");

    expect(capture.prompt).toBe("build a dashboard");
  });
});
