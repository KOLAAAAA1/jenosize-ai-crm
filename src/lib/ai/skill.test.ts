import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractSections, COPILOT_SKILL_SECTIONS, CHAT_REPLY_SKILL_SECTIONS } from "./skill";
import { copilotResultSchema } from "./schema";

const SKILL_MD = readFileSync(path.join(process.cwd(), "skills", "crm-copilot", "SKILL.md"), "utf8");

describe("extractSections (pure)", () => {
  const md = [
    "# Title",
    "intro",
    "## Wanted",
    "rule one",
    "### Nested",
    "nested rule",
    "## Skipped",
    "must not appear",
    "### Also skipped",
    "nor this",
    "## Second wanted",
    "rule two",
  ].join("\n");

  it("captures a section down to the next heading of the same or higher level", () => {
    const { text } = extractSections(md, ["Wanted"]);
    expect(text).toContain("rule one");
    expect(text).toContain("nested rule"); // sub-sections come along
    expect(text).not.toContain("must not appear");
  });

  it("captures several sections and drops everything between them", () => {
    const { text } = extractSections(md, ["Wanted", "Second wanted"]);
    expect(text).toContain("rule one");
    expect(text).toContain("rule two");
    expect(text).not.toContain("must not appear");
    expect(text).not.toContain("nor this");
  });

  it("can take a sub-section without its parent (how the chat path drops Approval boundary)", () => {
    const { text } = extractSections(md, ["Nested"]);
    expect(text).toContain("nested rule");
    expect(text).not.toContain("rule one");
  });

  it("reports headings it could not find, so a renamed section is not silently dropped", () => {
    const { missing } = extractSections(md, ["Wanted", "Renamed away"]);
    expect(missing).toEqual(["Renamed away"]);
  });

  it("ignores '#' lines inside fenced code blocks", () => {
    const fenced = ["## Wanted", "```bash", "## not a heading", "```", "still inside"].join("\n");
    const { text } = extractSections(fenced, ["Wanted"]);
    expect(text).toContain("still inside");
  });
});

// Guards the prompt against SKILL.md drift: if someone renames a heading, the rules
// under it would quietly stop reaching the model.
describe("SKILL.md ↔ prompt wiring", () => {
  it("finds every section the copilot prompt injects", () => {
    expect(extractSections(SKILL_MD, COPILOT_SKILL_SECTIONS).missing).toEqual([]);
  });

  it("finds every section the chat auto-reply prompt injects", () => {
    expect(extractSections(SKILL_MD, CHAT_REPLY_SKILL_SECTIONS).missing).toEqual([]);
  });

  it("keeps the eval cases and the richer output contract OUT of the copilot prompt", () => {
    const { text } = extractSections(SKILL_MD, COPILOT_SKILL_SECTIONS);
    // Eval-case outputs would be echoed back as if they were this lead's analysis.
    expect(text).not.toContain("### Case 1");
    expect(text).not.toContain("## Evaluation cases");
    // SKILL.md's own JSON contract is richer than copilotResultSchema; injecting the
    // block would make the model return a shape that fails validation on every call.
    // (Prose that merely *mentions* a field, as §"Output rules" does, is fine.)
    expect(text).not.toContain('"suggested_writes": [');
    expect(text).not.toContain('"lead_summary"');
  });

  it("gives the auto-send path SKILL.md's auto-reply rules, not the approval boundary that forbids it", () => {
    const { text } = extractSections(SKILL_MD, CHAT_REPLY_SKILL_SECTIONS);
    expect(text).toContain("Auto-reply mode");
    expect(text).not.toContain("Never collapse these steps");
  });
});

// The failure mode the prompt's precedence note exists to prevent: a model that
// follows SKILL.md's fuller output contract instead of the app's JSON shape hint.
describe("copilotResultSchema vs the SKILL.md output contract", () => {
  const valid = {
    status: "success",
    summary: { overview: "o", keyFacts: [], openQuestions: [] },
    qualification: { score: 70, confidence: "medium", reasons: [], recommendedStage: "no_change" },
    nextAction: null,
    lineReply: null,
    warnings: [],
  };

  it("tolerates EXTRA skill fields (they are stripped, not rejected)", () => {
    const parsed = copilotResultSchema.safeParse({ ...valid, evidence: [{ ref: "a" }], suggested_writes: [{ field: "score" }] });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "suggested_writes" in parsed.data).toBe(false);
  });

  it("REJECTS the skill's renamed/nested shape — which is why the shape hint must win", () => {
    const skillShaped = { status: "success", lead_summary: { overview: "o" }, qualification: valid.qualification, warnings: [] };
    expect(copilotResultSchema.safeParse(skillShaped).success).toBe(false);
  });
});
