import type { OpencodeClient } from "@opencode-ai/sdk";
import type { Part } from "@opencode-ai/sdk";
import type { ClassifiedInput, IntentClass } from "../ba/types";

/** The 15 valid intent classes, used to validate LLM output. */
const VALID_INTENTS: ReadonlySet<string> = new Set<IntentClass>([
  "NEW_GOAL",
  "NEXT_STEP",
  "CHANGE_REQUEST",
  "FEEDBACK",
  "BUG_DEBUG",
  "QUESTION",
  "COMPLAINT",
  "CONTEXT_DUMP",
  "PREFERENCE",
  "PROCESS_FEEDBACK",
  "STATUS_INQUIRY",
  "CONTINUE",
  "CANCEL_SCOPE",
  "META",
  "NOISE",
]);

/**
 * System prompt that instructs the LLM to act as the BA (Business Analyst).
 * Mirrors src/ba/skill.md: decompose input into atomic intents, route, and
 * output strict JSON.
 */
export const BA_SYSTEM_PROMPT = `你是專案管理層的第一階段：業務分析師（BA）。把使用者輸入拆成最小、可執行的原子意圖，並以嚴格 JSON 輸出。

15 類意圖：
NEW_GOAL 新的目標/專案 | NEXT_STEP 詢問下一步 | CHANGE_REQUEST 變更既有範圍 | FEEDBACK 一般回饋 | BUG_DEBUG 錯誤/除錯 | QUESTION 一般問題 | COMPLAINT 抱怨 | CONTEXT_DUMP 大量情境資訊傾倒 | PREFERENCE 偏好設定 | PROCESS_FEEDBACK 流程回饋 | STATUS_INQUIRY 狀態查詢 | CONTINUE 繼續進行 | CANCEL_SCOPE 取消/縮減範圍 | META 關於系統/工具本身 | NOISE 無關內容

規則：
1. 混合輸入拆解為多個原子意圖，每個獨立分類。
2. 只輸出 JSON，不要任何其他文字或 markdown 程式碼圍欄。
3. confidence 為 0-1 的數字。

輸出格式：
{"intents":[{"type":"NEW_GOAL","summary":"...","confidence":0.9}],"needs_clarification":false,"guidance":"可選引導文字"}`;

/** Extract the concatenated text from a message's parts. */
export function extractUserText(parts: Part[] | undefined): string {
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

/** Validate and normalize a parsed classification object. */
export function parseClassification(value: unknown): ClassifiedInput | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.intents)) return null;

  const intents = obj.intents
    .map((atom) => {
      if (typeof atom !== "object" || atom === null) return null;
      const a = atom as Record<string, unknown>;
      if (typeof a.type !== "string" || !VALID_INTENTS.has(a.type)) return null;
      if (typeof a.summary !== "string") return null;
      const confidence =
        typeof a.confidence === "number" ? a.confidence : 0.5;
      return {
        type: a.type as IntentClass,
        summary: a.summary,
        confidence,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (intents.length === 0) return null;

  const result: ClassifiedInput = {
    intents,
    needsClarification: obj.needs_clarification === true,
  };
  if (typeof obj.guidance === "string") {
    result.guidance = obj.guidance;
  }
  return result;
}

/**
 * Run LLM-based BA classification on a user message using a dedicated
 * subagent session. Returns null on any failure (no API, parse error, etc.)
 * so the caller can fall back gracefully.
 */
export async function classifyWithLLM(
  client: OpencodeClient,
  text: string,
): Promise<ClassifiedInput | null> {
  try {
    const created = await client.session.create({
      body: { title: "ba-classify" },
    });
    const sessionID = created.data?.id;
    if (!sessionID) return null;

    const res = await client.session.prompt({
      body: {
        system: BA_SYSTEM_PROMPT,
        parts: [{ type: "text", text }],
      },
      path: { id: sessionID },
    });
    const parts = res.data?.parts;
    if (!Array.isArray(parts)) return null;

    const responseText = extractUserText(parts);
    if (!responseText) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(responseText));
    } catch {
      return null;
    }
    return parseClassification(parsed);
  } catch {
    return null;
  }
}
