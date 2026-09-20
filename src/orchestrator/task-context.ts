import type { OpencodeClient, Message, Part } from "@opencode-ai/sdk";

/** System prompt that instructs the LLM to extract task context from conversation history. */
const TASK_CONTEXT_SYSTEM_PROMPT = `You are a task context extractor. Analyze the provided conversation history and output a concise task summary in strict JSON.

Extract:
- goal: The user's primary objective or task (1-2 sentences)
- progress: What has been accomplished so far (bullet list, max 5 items)
- current_state: Where things stand right now (1-2 sentences)
- next_steps: What should be done next (bullet list, max 5 items)
- key_files: Any files or code locations that are central to the task (bullet list, max 5 items)
- risks: Any known blockers, risks, or open questions (bullet list, max 3 items)

Output ONLY valid JSON, no markdown fences, no extra text.

{
  "goal": "...",
  "progress": ["...", "..."],
  "current_state": "...",
  "next_steps": ["...", "..."],
  "key_files": ["...", "..."],
  "risks": ["...", "..."]
}`;

/** Extract concatenated text from message parts. */
function extractText(parts: Part[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/** Strip markdown code fences from LLM output. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** Format session messages into a compact text for the LLM. */
function formatMessages(messages: Array<{ info: Message; parts: Part[] }>): string {
  return messages
    .map(({ info, parts }) => {
      const role = (info as { role?: string }).role === "user" ? "User" : "Assistant";
      const text = extractText(parts);
      return `[${role}]: ${text}`;
    })
    .join("\n\n");
}

/** Build the full prompt for task context extraction. */
function buildExtractionPrompt(messages: Array<{ info: Message; parts: Part[] }>): string {
  const history = formatMessages(messages);
  return `Here is the conversation history before compaction:\n\n${history}\n\nExtract the task context in the required JSON format.`;
}

/** Parse the task context JSON from LLM output. Returns null on failure. */
function parseTaskContext(raw: string): {
  goal: string;
  progress: string[];
  current_state: string;
  next_steps: string[];
  key_files: string[];
  risks: string[];
} | null {
  try {
    const parsed = JSON.parse(stripFences(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.goal !== "string") return null;
    if (!Array.isArray(parsed.progress) || !Array.isArray(parsed.next_steps)) return null;
    return {
      goal: parsed.goal,
      progress: parsed.progress.filter((x: unknown) => typeof x === "string") as string[],
      current_state: typeof parsed.current_state === "string" ? parsed.current_state : "",
      next_steps: parsed.next_steps.filter((x: unknown) => typeof x === "string") as string[],
      key_files: (parsed.key_files ?? []).filter((x: unknown) => typeof x === "string") as string[],
      risks: (parsed.risks ?? []).filter((x: unknown) => typeof x === "string") as string[],
    };
  } catch {
    return null;
  }
}

/**
 * Extract task context from recent session messages using a subagent.
 *
 * This is the core mechanism that preserves task understanding across compaction
 * boundaries. When the model's context is compressed, the task intent and progress
 * are extracted and stored so they can be restored on the next message — avoiding
 * the cold-start token spike that occurs when the provider cache expires after
 * the user has consumed ~50% of context.
 *
 * @param client - The OpenCode client
 * @param sessionID - Session to extract context from
 * @param messageLimit - Number of recent messages to analyze (default: 30)
 * @returns Task context object, or null on failure
 */
export async function extractTaskContext(
  client: OpencodeClient,
  sessionID: string,
  messageLimit: number = 30,
): Promise<{
  goal: string;
  progress: string[];
  current_state: string;
  next_steps: string[];
  key_files: string[];
  risks: string[];
} | null> {
  let messages: Array<{ info: Message; parts: Part[] }> = [];
  try {
    const msgRes = await client.session.messages({
      path: { id: sessionID },
    });
    messages = msgRes.data ?? [];
  } catch (err) {
    console.warn(
      `[task-context] failed to read session messages: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  const normalizedLimit = Number.isFinite(messageLimit)
    ? Math.max(0, Math.floor(messageLimit))
    : 30;
  const recentMessages = normalizedLimit === 0 ? [] : messages.slice(-normalizedLimit);
  if (recentMessages.length === 0) return null;

  const prompt = buildExtractionPrompt(recentMessages);

  try {
    const created = await client.session.create({
      body: { title: "task-context-extract" },
    });
    const sid = created.data?.id;
    if (!sid) return null;

    const res = await client.session.prompt({
      body: {
        system: TASK_CONTEXT_SYSTEM_PROMPT,
        parts: [{ type: "text", text: prompt }],
      },
      path: { id: sid },
    });
    const parts = res.data?.parts;
    const responseText = extractText(parts);
    if (!responseText) return null;

    return parseTaskContext(responseText);
  } catch (err) {
    console.warn(
      `[task-context] extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Format extracted task context into a compact summary string suitable for
 * injecting into the model's system prompt.
 */
export function formatTaskSummary(ctx: {
  goal: string;
  progress: string[];
  current_state: string;
  next_steps: string[];
  key_files: string[];
  risks: string[];
}): string {
  const lines: string[] = [];
  lines.push(`**Session Task Context (restored after compaction):**`);
  lines.push(`**Goal:** ${ctx.goal}`);

  if (ctx.progress.length > 0) {
    lines.push(`**Progress:**`);
    ctx.progress.forEach((p) => lines.push(`  - ${p}`));
  }

  if (ctx.current_state) {
    lines.push(`**Current State:** ${ctx.current_state}`);
  }

  if (ctx.next_steps.length > 0) {
    lines.push(`**Next Steps:**`);
    ctx.next_steps.forEach((s) => lines.push(`  - ${s}`));
  }

  if (ctx.key_files.length > 0) {
    lines.push(`**Key Files:** ${ctx.key_files.join(", ")}`);
  }

  if (ctx.risks.length > 0) {
    lines.push(`**Risks/Blockers:**`);
    ctx.risks.forEach((r) => lines.push(`  - ${r}`));
  }

  return lines.join("\n");
}