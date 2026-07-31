// Makes `skills/crm-copilot/SKILL.md` the runtime source of behaviour, not just a
// document about it: the sections that describe *how the model must behave* are
// read from the file and injected into the system prompt of every provider call
// (OpenRouter and Anthropic alike). Change the contract, change the prompt.
//
// Two deliberate limits:
//
//  1. NOT the whole file. SKILL.md is ~800 lines and much of it is written for the
//     humans building the app (MVP field mapping, processing workflow, the 10
//     evaluation cases, definition of done). Injecting the eval cases in particular
//     invites the model to echo their canned outputs, so only the rule sections go
//     in — see COPILOT_SKILL_SECTIONS.
//  2. NOT the output contract. SKILL.md §"Output contract" describes a richer shape
//     than `copilotResultSchema` (which is documented there as a flattened subset).
//     If the model followed it, every response would fail schema validation and
//     degrade to the deterministic fallback — i.e. "the AI stopped working". So the
//     caller's own JSON shape hint wins, and the prompt says so explicitly.
//     Only §"Output rules" (grounding/voice discipline) is injected.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "@/lib/logger";

// Resolved from the project root at run time. On Vercel the file is only present
// in the function bundle because `outputFileTracingIncludes` in next.config.ts
// traces it in — Next cannot infer a runtime fs read on its own.
const SKILL_FILE = path.join(process.cwd(), "skills", "crm-copilot", "SKILL.md");

// Heading titles (any level) whose bodies are injected, in prompt order.
export const COPILOT_SKILL_SECTIONS = [
  "Purpose",
  "Output rules",
  "Qualification model",
  "Lead summary rules",
  "Next-best-action rules",
  "LINE reply drafting rules",
  "Allowed actions",
  "Guardrails",
  "Failure behavior",
] as const;

// The LINE auto-reply path is a different capability with a different boundary: it
// sends without human approval, so §"Approval boundary" (which forbids exactly
// that) is replaced by §"Auto-reply mode". Picking the H3s directly instead of the
// parent H2 is what keeps the contradictory section out of this prompt.
export const CHAT_REPLY_SKILL_SECTIONS = [
  "Draft requirements",
  "Auto-reply mode",
  "Guardrails",
] as const;

export type SkillExcerpt = { text: string; missing: string[] };

// Pure: markdown + wanted heading titles → the concatenated section bodies, plus
// the titles that were NOT found (a renamed heading in SKILL.md would otherwise
// drop its rules from the prompt silently — the caller logs `missing`).
//
// A section runs from its heading to the next heading of the same or higher level.
// Fenced code blocks are skipped so a `#` comment inside one is never a heading.
export function extractSections(markdown: string, wanted: readonly string[]): SkillExcerpt {
  const wantedLower = wanted.map((w) => w.toLowerCase());
  const found = new Set<string>();
  const out: string[] = [];
  let depth = 0; // heading level of the section being captured; 0 = capturing nothing
  let inFence = false;

  for (const line of markdown.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;

    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const index = wantedLower.indexOf(title.toLowerCase());
      if (index >= 0) {
        found.add(wantedLower[index]);
        depth = level;
        out.push(line);
        continue;
      }
      // A heading at or above the captured level ends that section.
      if (depth > 0 && level <= depth) depth = 0;
    }

    if (depth > 0) out.push(line);
  }

  return {
    text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    missing: wanted.filter((w) => !found.has(w.toLowerCase())),
  };
}

// Cached for the lifetime of the process (the file is immutable in a deployment).
// A read failure is a logged warning, never a throw: the copilot must still run
// with its built-in rules if the file is missing from the bundle.
let cachedFile: Promise<string | null> | null = null;

function readSkillFile(): Promise<string | null> {
  cachedFile ??= readFile(SKILL_FILE, "utf8").catch((err: unknown) => {
    logger.warn("skill.read_failed", {
      file: SKILL_FILE,
      error: err instanceof Error ? err.message : "unknown error",
    });
    return null;
  });
  return cachedFile;
}

// The prompt-ready excerpt for a call site, or null when SKILL.md is unavailable.
export async function skillExcerpt(sections: readonly string[]): Promise<string | null> {
  const markdown = await readSkillFile();
  if (!markdown) return null;

  const { text, missing } = extractSections(markdown, sections);
  if (missing.length > 0) logger.warn("skill.sections_missing", { missing: missing.join(", ") });
  return text || null;
}

// Test seam only: drops the cached read so a test can point at different content.
export function resetSkillCache(): void {
  cachedFile = null;
}
