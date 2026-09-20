import { describe, expect, it } from "bun:test";
import type { OpencodeClient, Message, Part } from "@opencode-ai/sdk";
import { extractTaskContext } from "../../src/orchestrator/task-context";

function sessionMessage(id: string, text: string): { info: Message; parts: Part[] } {
  return {
    info: { id, role: "user", sessionID: "main" } as unknown as Message,
    parts: [{ type: "text", text }] as unknown as Part[],
  };
}

describe("extractTaskContext", () => {
  it("passes only the requested number of recent messages to the extractor", async () => {
    let capturedPrompt = "";
    const messages = [
      sessionMessage("m1", "old-secret-context"),
      sessionMessage("m2", "middle-context"),
      sessionMessage("m3", "newest-context"),
    ];
    const client = {
      session: {
        messages: async () => ({ data: messages }),
        create: async () => ({ data: { id: "extractor" } }),
        prompt: async (args: { body: { parts: Array<{ text: string }> } }) => {
          capturedPrompt = args.body.parts[0]?.text ?? "";
          return {
            data: {
              parts: [{
                type: "text",
                text: JSON.stringify({
                  goal: "goal",
                  progress: [],
                  current_state: "active",
                  next_steps: [],
                  key_files: [],
                  risks: [],
                }),
              }],
            },
          };
        },
      },
    } as unknown as OpencodeClient;

    const ctx = await extractTaskContext(client, "main", 2);

    expect(ctx?.goal).toBe("goal");
    expect(capturedPrompt).not.toContain("old-secret-context");
    expect(capturedPrompt).toContain("middle-context");
    expect(capturedPrompt).toContain("newest-context");
  });

  it("does not create an extractor session when the message limit is zero", async () => {
    let created = false;
    const client = {
      session: {
        messages: async () => ({ data: [sessionMessage("m1", "context")] }),
        create: async () => {
          created = true;
          return { data: { id: "extractor" } };
        },
      },
    } as unknown as OpencodeClient;

    expect(await extractTaskContext(client, "main", 0)).toBeNull();
    expect(created).toBe(false);
  });
});
