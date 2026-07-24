// Parse a customer's budget expressed as Thai text (or plain digits) into an
// integer THB amount, so a sales officer can type "1 ล้านบาท" instead of typing
// "1000000". Handles the common Thai magnitude words and k/m shorthand; returns
// null when it can't confidently parse (the officer then just types the digits).
//
// Single magnitude only — "1 ล้าน 5 แสน" resolves to 1,000,000 (the first unit),
// which is a deliberate scope limit, not silent rounding of the whole amount.

// Ordered longest/largest first; each entry is [matcher, multiplier].
const UNITS: [RegExp, number][] = [
  [/ล้าน|m$/, 1_000_000],
  [/แสน/, 100_000],
  [/หมื่น/, 10_000],
  [/พัน|k$/, 1_000],
  [/ร้อย/, 100],
];

export function parseThaiBudget(input: string): number | null {
  if (typeof input !== "string") return null;
  // Drop currency words/symbols, thousands separators, and whitespace.
  const s = input.trim().toLowerCase().replace(/บาท|thb|฿|,|\s/g, "");
  if (s === "") return null;

  for (const [re, mult] of UNITS) {
    const m = s.match(re);
    if (m && m.index !== undefined) {
      const numPart = s.slice(0, m.index); // the number before the unit word
      const n = Number(numPart);
      if (numPart === "" || !Number.isFinite(n) || n < 0) return null;
      return Math.round(n * mult);
    }
  }

  const n = Number(s); // plain digits (with optional decimal)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}
