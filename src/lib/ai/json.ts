// Shared by every OpenAI-compatible call site (copilot, chat auto-reply): some
// models wrap JSON in prose or ``` fences despite JSON mode, so recover the
// object rather than failing the whole run.
export function extractJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("model response was not valid JSON");
  }
}
