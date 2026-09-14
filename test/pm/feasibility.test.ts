import { describe, expect, it } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { generateFeasibility } from "../../src/pm/feasibility";
import type { Task } from "../../src/pm/types";

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

function sampleTasks(): Task[] {
  return [
    { id: "t1", title: "setup", docTokens: 50, codeTokens: 200, complexity: "low", dependencies: [] },
    { id: "t2", title: "build", docTokens: 100, codeTokens: 500, complexity: "medium", dependencies: ["t1"] },
  ];
}

describe("generateFeasibility", () => {
  it("parses a valid feasibility report", async () => {
    const client = mockClient(
      JSON.stringify({
        assessment: "proceed",
        risks: ["external API may be rate-limited"],
        uncertainties: ["auth provider choice"],
        recommendation: "Proceed with the plan.",
      }),
    );

    const report = await generateFeasibility(client, "build a dashboard", sampleTasks());
    expect(report).not.toBeNull();
    expect(report!.assessment).toBe("proceed");
    expect(report!.risks).toEqual(["external API may be rate-limited"]);
  });

  it("strips markdown code fences before parsing", async () => {
    const client = mockClient(
      "```json\n{\"assessment\":\"needs-poc\",\"risks\":[],\"uncertainties\":[\"x\"],\"recommendation\":\"Run a POC\"}\n```",
    );

    const report = await generateFeasibility(client, "goal", sampleTasks());
    expect(report).not.toBeNull();
    expect(report!.assessment).toBe("needs-poc");
  });

  it("returns null on invalid assessment", async () => {
    const client = mockClient(
      JSON.stringify({
        assessment: "maybe",
        risks: [],
        uncertainties: [],
        recommendation: "x",
      }),
    );

    expect(await generateFeasibility(client, "goal", sampleTasks())).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    const client = mockClient("not json");
    expect(await generateFeasibility(client, "goal", sampleTasks())).toBeNull();
  });
});
