import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import { isSafePathSegment } from "../hl-repo/paths";
import type { ComplexityLevel, Task } from "./types";

/** The three valid complexity levels, used to validate LLM output. */
const VALID_COMPLEXITY: ReadonlySet<string> = new Set<ComplexityLevel>([
  "low",
  "medium",
  "high",
]);

/**
 * System prompt that instructs the LLM to decompose a goal into concrete,
 * dependency-aware development tasks. Mirrors the PM planning skill
 * (src/pm/skill.md) and outputs strict JSON.
 */
const GENERATE_TASKS_SYSTEM_PROMPT = `你是專案管理層的第二階段：專案經理（PM）。把使用者目標拆解成具體、可執行的開發任務，並以嚴格 JSON 輸出。

每個任務需包含：
- id: 唯一字串識別碼（如 "t1"、"t2"）
- title: 任務標題（簡短）
- docTokens: 預估文件/註解 token 數（數字）
- codeTokens: 預估實作程式碼 token 數（數字）
- complexity: 複雜度，只能是 "low" | "medium" | "high"
- dependencies: 此任務依賴的任務 id 陣列（無依賴則為 []）

規則：
1. 任務應可獨立執行，依賴關係明確（被依賴的任務要先完成）。
2. 不要產生重複 id，不要引用不存在的 id，不要形成循環依賴。
3. 只輸出 JSON，不要任何其他文字或 markdown 程式碼圍欄。

輸出格式：
{"tasks":[{"id":"t1","title":"...","docTokens":100,"codeTokens":500,"complexity":"medium","dependencies":[]}]}`;

/** Extract the concatenated text from a message's parts. */
function extractText(parts: Part[] | undefined): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/** Strip markdown code fences and surrounding whitespace from LLM output. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

/** Validate and normalize a parsed task list. Returns null when invalid. */
function parseTasks(value: unknown): Task[] | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) return null;

  const tasks: Task[] = [];
  const ids = new Set<string>();
  for (const raw of obj.tasks) {
    if (typeof raw !== "object" || raw === null) return null;
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== "string" || !isSafePathSegment(t.id)) return null;
    if (ids.has(t.id)) return null; // duplicate id
    ids.add(t.id);
    if (typeof t.title !== "string" || t.title === "") return null;
    if (typeof t.docTokens !== "number" || t.docTokens < 0) return null;
    if (typeof t.codeTokens !== "number" || t.codeTokens < 0) return null;
    if (typeof t.complexity !== "string" || !VALID_COMPLEXITY.has(t.complexity)) {
      return null;
    }
    if (!Array.isArray(t.dependencies)) return null;
    if (!t.dependencies.every((d) => typeof d === "string" && isSafePathSegment(d))) {
      return null;
    }
    tasks.push({
      id: t.id,
      title: t.title,
      docTokens: t.docTokens,
      codeTokens: t.codeTokens,
      complexity: t.complexity as ComplexityLevel,
      dependencies: t.dependencies as string[],
    });
  }

  // Reject references to unknown ids (dangling dependencies).
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (!ids.has(dep)) return null;
    }
  }

  return tasks;
}

/**
 * Decompose a goal into concrete tasks using a dedicated subagent session.
 * Optional `context` (e.g. prior closures / lessons) is prepended so the PM
 * can carry earlier decisions into new planning. Returns null on any failure
 * (no API, parse error, invalid output) so the caller can fall back gracefully.
 */
export async function generateTasks(
  client: OpencodeClient,
  goalSummary: string,
  context?: string,
): Promise<Task[] | null> {
  try {
    const created = await client.session.create({
      body: { title: "pm-plan" },
    });
    const sessionID = created.data?.id;
    if (!sessionID) return null;

    const prompt =
      context === undefined || context === ""
        ? goalSummary
        : `Prior context (lessons/decisions from earlier phases):\n\n${context}\n\nGoal: ${goalSummary}`;
    const res = await client.session.prompt({
      body: {
        system: GENERATE_TASKS_SYSTEM_PROMPT,
        parts: [{ type: "text", text: prompt }],
      },
      path: { id: sessionID },
    });
    const parts = res.data?.parts;
    if (!Array.isArray(parts)) return null;

    const responseText = extractText(parts);
    if (!responseText) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(responseText));
    } catch {
      return null;
    }
    return parseTasks(parsed);
  } catch {
    return null;
  }
}
