import type { PlanEvidence } from "../bridge-types";

const SIMPLE_CHECKBOX = /^[-*][ \t]*\[[ \t]*([xX]?)[ \t]*\][ \t]+(.+)$/;
const TODO_HEADING = /^##[ \t]+TODOs(?:[ \t]+#+)?[ \t]*$/i;
const FINAL_HEADING = /^##[ \t]+Final Verification Wave(?:[ \t]+#+)?[ \t]*$/i;
const SECTION_BOUNDARY = /^#{1,2}(?:[ \t]+|$)/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const TODO_CHECKBOX = /^- \[([ xX])\] ([1-9]\d*\. .+)$/;
const FINAL_CHECKBOX = /^- \[([ xX])\] (F[1-9]\d*\. .+)$/i;

type Section = "todo" | "final" | "other";

interface MarkdownFence {
  marker: "`" | "~";
  length: number;
}

function openingFence(line: string): MarkdownFence | null {
  const match = line.match(FENCE);
  const run = match?.[1];
  const info = match?.[2];
  const marker = run?.charAt(0);
  if (
    run === undefined
    || info === undefined
    || (marker !== "`" && marker !== "~")
    || (marker === "`" && info.includes("`"))
  ) return null;
  return { marker, length: run.length };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const run = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
  return run?.charAt(0) === fence.marker && run.length >= fence.length;
}

function sectionFor(line: string): Section {
  if (TODO_HEADING.test(line)) return "todo";
  if (FINAL_HEADING.test(line)) return "final";
  return "other";
}

function hasStructuredSection(lines: readonly string[]): boolean {
  let fence: MarkdownFence | null = null;
  for (const line of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = openingFence(line);
    if (opening !== null) {
      fence = opening;
      continue;
    }
    if (sectionFor(line) !== "other") return true;
  }
  return false;
}

function parseSimple(lines: readonly string[], markdown: string): PlanEvidence {
  let total = 0;
  let completed = 0;
  let fence: MarkdownFence | null = null;
  for (const line of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = openingFence(line);
    if (opening !== null) {
      fence = opening;
      continue;
    }
    const marker = line.match(SIMPLE_CHECKBOX)?.[1];
    if (marker === undefined) continue;
    total += 1;
    if (marker.toLowerCase() === "x") completed += 1;
  }
  return { markdown, total, completed };
}

function parseStructured(lines: readonly string[], markdown: string): PlanEvidence {
  let total = 0;
  let completed = 0;
  let section: Section = "other";
  let fence: MarkdownFence | null = null;
  for (const line of lines) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = openingFence(line);
    if (opening !== null) {
      fence = opening;
      continue;
    }
    if (SECTION_BOUNDARY.test(line)) {
      section = sectionFor(line);
      continue;
    }
    if (section === "other") continue;
    const pattern = section === "todo" ? TODO_CHECKBOX : FINAL_CHECKBOX;
    const marker = line.match(pattern)?.[1];
    if (marker === undefined) continue;
    total += 1;
    if (marker.toLowerCase() === "x") completed += 1;
  }
  return { markdown, total, completed };
}

/** Mirrors OMO's structured checklist grammar and legacy simple fallback. */
export function parsePlanChecklist(markdown: string): PlanEvidence {
  const lines = markdown.split(/\r?\n/);
  return hasStructuredSection(lines)
    ? parseStructured(lines, markdown)
    : parseSimple(lines, markdown);
}
