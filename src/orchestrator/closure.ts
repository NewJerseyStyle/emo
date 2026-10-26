import { writeDoc } from "../hl-repo";
import type { HlRepoConfig } from "../hl-repo/types";
import type { ClosureInput, Lesson } from "./types";

function bulletList(items: string[]): string {
  if (items.length === 0) return "- none";
  return items.map((item) => `- ${item}`).join("\n");
}

function lessonsBlock(lessons: Lesson[]): string {
  return lessons
    .map(
      (lesson, index) =>
        `### Lesson ${index + 1}\n- What: ${lesson.what}\n- Why: ${lesson.why}\n- Differently: ${lesson.differently}`,
    )
    .join("\n\n");
}

/** Build the frontmatter block for a closure doc (phase, tokens_saved, supersedes). */
function frontmatter(input: ClosureInput): string {
  const supersedes =
    input.supersedes === undefined ? "" : `supersedes: ${input.supersedes}\n`;
  return `---\nphase: "${input.phase}"\ntokens_saved: ${input.tokensSaved}\n${supersedes}---\n`;
}

/** Build a PMI final-report style closure document (pure). */
export function buildClosureContent(input: ClosureInput): string {
  return `${frontmatter(input)}# Phase ${input.phase} Closure

## Project Summary

${input.summary}

## Performance vs Baseline

- Estimated tokens: ${input.estimatedTokens}
- Actual tokens: ${input.actualTokens}
- Tokens saved: ${input.tokensSaved}

## Deliverables Summary

${bulletList(input.deliverables)}

## Issues & Changes

${bulletList(input.issues)}

## Risk Summary

${bulletList(input.risks)}

## Lessons Learned

${lessonsBlock(input.lessons)}

## Value Realization

${input.value}

## Handover

${input.handover}

## Closure Approval

- Phase: ${input.phase}
- Approved by: (pending)
`;
}

/** Build the closure content and write it to the HL repo (validates + commits). */
export function writeClosure(
  config: HlRepoConfig,
  projectId: string,
  input: ClosureInput,
): void {
  const content = buildClosureContent(input);
  writeDoc(config, projectId, "closure", content, input.phase);
}
