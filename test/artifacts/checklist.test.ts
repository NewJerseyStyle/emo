import { describe, expect, test } from "bun:test";
import { parsePlanChecklist } from "../../src/artifacts/checklist";

describe("parsePlanChecklist", () => {
  test("counts only canonical structured tasks outside fences", () => {
    const markdown = [
      "- [x] preamble ignored",
      "## TODOs",
      "- [x] 1. Build",
      "  - [ ] nested ignored",
      "```md",
      "- [ ] 2. fenced ignored",
      "```",
      "## Acceptance Criteria",
      "- [ ] ignored",
      "## Final Verification Wave",
      "- [X] F1. Verify",
      "- [ ] 2. wrong label ignored",
    ].join("\n");
    expect(parsePlanChecklist(markdown)).toMatchObject({ total: 2, completed: 2 });
  });

  test("falls back to column-zero simple checkboxes", () => {
    const markdown = ["# Plan", "* [x] done", "- [ ] open", "  - [x] nested"].join("\n");
    expect(parsePlanChecklist(markdown)).toMatchObject({ total: 2, completed: 1 });
  });

  test("structured headings with no canonical rows do not fall back", () => {
    const markdown = ["## TODOs", "- [x] prose", "## Final Verification Wave", "- [x] verify"].join("\n");
    expect(parsePlanChecklist(markdown)).toMatchObject({ total: 0, completed: 0 });
  });
});
