import type { OpencodeClient, Part } from "@opencode-ai/sdk";
import { ensureRepo, writeDoc } from "../hl-repo";
import type { HlRepoConfig } from "../hl-repo/types";
import { buildPlan } from "../pm/plan";
import type { Task } from "../pm/types";
import { writeClosure } from "./closure";
import type { ClosureInput, Lesson } from "./types";

/** Context about an active project, tracked by the runtime. */
export interface ProjectContext {
  projectId: string;
  goal: string;
  /** Estimated total tokens from the plan (used for closure accounting). */
  totalTokens: number;
}

/** Turn a goal summary into a filesystem-safe, human-readable project id. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "project";
}

/**
 * Write the spec + project-plan docs for a new goal to the HL repo.
 * Generates the plan via buildPlan (validates + topo-sorts + estimates).
 */
export function writeProjectPlan(
  config: HlRepoConfig,
  projectId: string,
  goal: string,
  tasks: Task[],
): number {
  ensureRepo(config);
  const plan = buildPlan(tasks);

  const spec = `---
title: "${projectId}"
status: "active"
---
# ${projectId}

## Goal

${goal}

## Requirements

- Derived from the goal above; refined during execution.
`;
  writeDoc(config, projectId, "spec", spec);

  const planBody = plan.tasks
    .map(
      (t) =>
        `- [ ] ${t.id}: ${t.title} (~${t.estimate.estimatedTokens} tokens, ${t.complexity})`,
    )
    .join("\n");
  const planContent = `---
title: "${projectId}"
status: "active"
---
# ${projectId} Plan

## Tasks

${planBody}

## Total Estimated Tokens

${plan.totalTokens}
`;
  writeDoc(config, projectId, "project-plan", planContent);
  return plan.totalTokens;
}

/** Write a change-request doc to the HL repo (audit trail). */
export function writeChangeRequest(
  config: HlRepoConfig,
  projectId: string,
  summary: string,
): void {
  ensureRepo(config);
  const name = slugify(summary).slice(0, 40) || "change";
  const date = new Date().toISOString().slice(0, 10);
  const content = `---
status: "open"
date: "${date}"
---
# Change Request

${summary}
`;
  writeDoc(config, projectId, "change-request", content, name);
}

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

/** Format session messages into a compact transcript for the LLM. */
function formatTranscript(messages: Array<{ info: { role?: string }; parts: Part[] }>): string {
  return messages
    .map(({ info, parts }) => {
      const role = info.role === "user" ? "User" : "Assistant";
      const text = extractText(parts);
      return `[${role}]: ${text}`;
    })
    .join("\n\n");
}

/** System prompt that instructs the LLM to produce a phase closure report. */
const CLOSURE_SYSTEM_PROMPT = `你是專案管理層的收尾階段：專案經理（PM）。根據對話紀錄產出專案收尾報告（PMI final report 風格），以嚴格 JSON 輸出。

輸出欄位：
- summary: 專案總結（1-3 句）
- deliverables: 已交付成果清單（字串陣列）
- issues: 遇到的問題/變更（字串陣列）
- risks: 風險/阻礙（字串陣列）
- lessons: 經驗教訓陣列，每項含 what / why / differently
- value: 價值實現說明（1-2 句）
- handover: 交接/後續事項（1-2 句）

規則：
1. 只根據對話紀錄內容產出，不要臆測。
2. 只輸出 JSON，不要任何其他文字或 markdown 程式碼圍欄。

輸出格式：
{"summary":"...","deliverables":["..."],"issues":["..."],"risks":["..."],"lessons":[{"what":"...","why":"...","differently":"..."}],"value":"...","handover":"..."}`;

/** Validate and normalize a parsed closure body. Returns null when invalid. */
function parseClosureBody(value: unknown): Omit<ClosureInput, "phase" | "tokensSaved" | "estimatedTokens" | "actualTokens"> | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.summary !== "string") return null;
  if (!Array.isArray(obj.deliverables)) return null;
  if (!Array.isArray(obj.issues)) return null;
  if (!Array.isArray(obj.risks)) return null;
  if (!Array.isArray(obj.lessons)) return null;
  if (typeof obj.value !== "string") return null;
  if (typeof obj.handover !== "string") return null;

  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  const strArr = (a: unknown[]): string[] => a.map(str).filter((s) => s !== "");

  const lessons: Lesson[] = obj.lessons
    .map((l) => {
      if (typeof l !== "object" || l === null) return null;
      const le = l as Record<string, unknown>;
      return {
        what: str(le.what),
        why: str(le.why),
        differently: str(le.differently),
      };
    })
    .filter((l): l is Lesson => l !== null && l.what !== "");

  return {
    summary: str(obj.summary),
    deliverables: strArr(obj.deliverables),
    issues: strArr(obj.issues),
    risks: strArr(obj.risks),
    lessons,
    value: str(obj.value),
    handover: str(obj.handover),
  };
}

/**
 * Generate a phase closure report from the session transcript using a
 * dedicated subagent. Quantitative fields (tokens) are filled from the
 * project context; qualitative fields come from the LLM. Returns null on
 * any failure so the caller can skip closure gracefully.
 */
export async function generateClosureInput(
  client: OpencodeClient,
  sessionId: string,
  project: ProjectContext,
): Promise<ClosureInput | null> {
  let messages: Array<{ info: { role?: string }; parts: Part[] }> = [];
  try {
    const msgRes = await client.session.messages({ path: { id: sessionId } });
    messages = msgRes.data ?? [];
  } catch {
    return null;
  }
  if (messages.length === 0) return null;

  const transcript = formatTranscript(messages);
  const prompt = `Goal: ${project.goal}\n\nConversation transcript:\n\n${transcript}\n\nProduce the closure report in the required JSON format.`;

  try {
    const created = await client.session.create({
      body: { title: "pm-closure" },
    });
    const sid = created.data?.id;
    if (!sid) return null;

    const res = await client.session.prompt({
      body: {
        system: CLOSURE_SYSTEM_PROMPT,
        parts: [{ type: "text", text: prompt }],
      },
      path: { id: sid },
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
    const body = parseClosureBody(parsed);
    if (body === null) return null;

    const phase = new Date().toISOString().slice(0, 10);
    return {
      phase,
      tokensSaved: project.totalTokens,
      summary: body.summary,
      estimatedTokens: project.totalTokens,
      actualTokens: 0,
      deliverables: body.deliverables,
      issues: body.issues,
      risks: body.risks,
      lessons: body.lessons,
      value: body.value,
      handover: body.handover,
    };
  } catch {
    return null;
  }
}

/** Generate a closure report from the session and write it to the HL repo. */
export async function writeClosureFromSession(
  client: OpencodeClient,
  config: HlRepoConfig,
  sessionId: string,
  project: ProjectContext,
): Promise<boolean> {
  const input = await generateClosureInput(client, sessionId, project);
  if (input === null) return false;
  ensureRepo(config);
  writeClosure(config, project.projectId, input);
  return true;
}
