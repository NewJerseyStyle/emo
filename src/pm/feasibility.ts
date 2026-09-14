import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import type { Task } from "./types";

/** PM feasibility assessment of a planned task set. */
export interface FeasibilityReport {
  /** Overall go/no-go recommendation. */
  assessment: "proceed" | "needs-poc" | "needs-clarification";
  /** Risks that could block or delay the plan. */
  risks: string[];
  /** Open uncertainties that need resolution before execution. */
  uncertainties: string[];
  /** Plain-language recommendation for the PM/ulw-loop. */
  recommendation: string;
}

const VALID_ASSESSMENTS: ReadonlySet<string> = new Set([
  "proceed",
  "needs-poc",
  "needs-clarification",
]);

/**
 * System prompt that instructs the LLM to act as the PM feasibility reviewer.
 * Reviews the goal + planned tasks, flags risks/uncertainties, and outputs a
 * strict JSON feasibility assessment.
 */
const FEASIBILITY_SYSTEM_PROMPT = `你是專案管理層的可行性研究階段：專案經理（PM）。評估目標與任務清單的可行性，以嚴格 JSON 輸出。

輸出欄位：
- assessment: 只能是 "proceed" | "needs-poc" | "needs-clarification"
- risks: 可能阻礙或延遲的風險（字串陣列）
- uncertainties: 執行前需釐清的開放不確定性（字串陣列）
- recommendation: 給 PM/ulw-loop 的建議（1-2 句）

規則：
1. 只根據提供的目標與任務評估，不要臆測。
2. 只輸出 JSON，不要任何其他文字或 markdown 程式碼圍欄。

輸出格式：
{"assessment":"proceed","risks":["..."],"uncertainties":["..."],"recommendation":"..."}`;

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

/** Validate and normalize a parsed feasibility body. Returns null when invalid. */
function parseFeasibility(value: unknown): FeasibilityReport | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.assessment !== "string" || !VALID_ASSESSMENTS.has(obj.assessment)) {
    return null;
  }
  if (!Array.isArray(obj.risks)) return null;
  if (!Array.isArray(obj.uncertainties)) return null;
  if (typeof obj.recommendation !== "string") return null;
  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  return {
    assessment: obj.assessment as FeasibilityReport["assessment"],
    risks: obj.risks.map(str).filter((s) => s !== ""),
    uncertainties: obj.uncertainties.map(str).filter((s) => s !== ""),
    recommendation: str(obj.recommendation),
  };
}

/**
 * Run a PM feasibility study on a goal + task set using a dedicated subagent
 * session. Returns null on any failure so the caller can skip gracefully.
 */
export async function generateFeasibility(
  client: OpencodeClient,
  goalSummary: string,
  tasks: Task[],
): Promise<FeasibilityReport | null> {
  try {
    const created = await client.session.create({
      body: { title: "pm-feasibility" },
    });
    const sessionID = created.data?.id;
    if (!sessionID) return null;

    const taskList = tasks
      .map((t) => `- ${t.id}: ${t.title} (${t.complexity})`)
      .join("\n");
    const prompt = `Goal: ${goalSummary}\n\nPlanned tasks:\n${taskList}\n\nAssess feasibility.`;

    const res = await client.session.prompt({
      body: {
        system: FEASIBILITY_SYSTEM_PROMPT,
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
    return parseFeasibility(parsed);
  } catch {
    return null;
  }
}
