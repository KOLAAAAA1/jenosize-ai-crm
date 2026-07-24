import type { Stage, Source } from "@prisma/client";
import type { CopilotContext, LeadHistory } from "./context";
import { clampScore, type CopilotResult } from "./schema";
import { formatTHB } from "@/lib/format";

// Deterministic, rule-based fallback used when the model service is unavailable
// (or no API key is configured). Per SKILL.md "Model service unavailable": a
// rule-based score from stage + activity recency + source, a summary templated
// from stored fields, a stage-appropriate next action, and a repeat-customer
// signal when the contact/company has multiple leads — but NO fabricated model
// output: no invented prose, no model-style reasoning, no LINE draft. Every value
// here is mechanically derived from the context so the output is reproducible.
//
// All natural-language output is Thai (the CRM's operating language); enum tokens
// and numbers stay as-is. The real-model path is instructed to answer in Thai too
// (see SYSTEM_PROMPT in copilot.ts), so both modes read the same for the user.

const STAGE_BASE: Record<Stage, number> = {
  NEW: 30,
  QUALIFIED: 55,
  PROPOSAL: 70,
  WON: 95,
  LOST: 10,
};

const SOURCE_BONUS: Record<Source, number> = {
  LINE_OA: 5,
  WEBSITE: 3,
  MANUAL: 0,
};

// Thai display labels for the enum tokens, used only in the prose fields.
const STAGE_TH: Record<Stage, string> = {
  NEW: "ลูกค้าใหม่",
  QUALIFIED: "ผ่านการคัดกรอง",
  PROPOSAL: "ยื่นข้อเสนอ",
  WON: "ปิดการขายสำเร็จ",
  LOST: "เสียโอกาส",
};

const SOURCE_TH: Record<Source, string> = {
  LINE_OA: "LINE OA",
  WEBSITE: "เว็บไซต์",
  MANUAL: "บันทึกเอง",
};

const CONSENT_TH: Record<string, string> = {
  UNKNOWN: "ไม่ทราบ",
  OPTED_IN: "ยินยอม",
  OPTED_OUT: "ปฏิเสธการติดต่อ",
};

function recencyAdjustment(days: number | null): { delta: number; label: string } {
  if (days == null) return { delta: -5, label: "ยังไม่มีบันทึกกิจกรรม" };
  if (days <= 7) return { delta: 10, label: `มีความเคลื่อนไหวใน ${days} วันที่ผ่านมา` };
  if (days <= 30) return { delta: 5, label: `กิจกรรมล่าสุดเมื่อ ${days} วันก่อน` };
  return { delta: -5, label: `เงียบหาย — ไม่มีความเคลื่อนไหวมา ${days} วัน` };
}

type NextAction = { action: string; reason: string; priority: "low" | "medium" | "high" };

// One next-best-action per pipeline stage — the "5 cases" that make the fallback
// suggestion stage-aware instead of recency-only. These describe the sales play,
// never an automated stage move (recommendedStage stays `no_change`).
function stagePlay(ctx: CopilotContext): NextAction {
  const { name } = ctx.contact;
  const company = ctx.company.name;
  switch (ctx.stage) {
    case "NEW":
      return { action: `คัดกรอง ${name} จาก ${company} — ยืนยันงบประมาณ อำนาจตัดสินใจ และกรอบเวลา`, reason: "ลูกค้าใหม่ ควรประเมินความเหมาะสมก่อนลงแรง", priority: "medium" };
    case "QUALIFIED":
      return { action: `จัดทำและส่งข้อเสนอให้ ${name}`, reason: "ลูกค้าผ่านการคัดกรองแล้ว ผลักดันไปสู่การยื่นข้อเสนอ", priority: "high" };
    case "PROPOSAL":
      return { action: `ติดตามข้อเสนอกับ ${name} และยืนยันวันตัดสินใจ`, reason: "ยื่นข้อเสนอไปแล้ว เร่งให้เกิดการตัดสินใจ", priority: "high" };
    case "WON":
      return { action: `เริ่มการส่งมอบ/ออนบอร์ดให้ ${company} และขอบคุณ ${name}`, reason: "ปิดการขายสำเร็จ ดูแลการส่งมอบและรักษาความสัมพันธ์", priority: "medium" };
    case "LOST":
      return { action: `บันทึกเหตุผลที่เสียโอกาส และตั้งเตือนติดตามกลับมาภายหลังกับ ${name}`, reason: "เสียโอกาสครั้งนี้ บันทึกสาเหตุและเปิดช่องกลับมาในอนาคต", priority: "low" };
  }
}

// Cross-lead relationship signal. Returns a key fact for the summary and, when
// the contact/company already has more than one lead, a repeat-customer clause to
// fold into the next action. Returns null when the route didn't compute history.
function relationshipSignal(ctx: CopilotContext): { keyFact: string; repeatClause: string | null } | null {
  const h: LeadHistory | undefined = ctx.history;
  if (!h) return null;

  const company = ctx.company.name;
  const isRepeat = h.contactLeadCount > 1 || h.companyLeadCount > 1;
  if (!isRepeat) {
    return { keyFact: `ความสัมพันธ์: เป็นดีลแรกที่บันทึกไว้ของ ${company}`, repeatClause: null };
  }

  const wonPart = h.companyWonCount > 0 ? ` (ปิดสำเร็จ ${h.companyWonCount})` : "";
  return {
    keyFact: `ลูกค้าเก่า: ${h.companyLeadCount} ดีลกับ ${company}${wonPart} · ${h.contactLeadCount} ดีลกับ ${ctx.contact.name}`,
    repeatClause: `เป็นลูกค้าเก่า (${h.companyLeadCount} ดีลกับ ${company}) — อ้างอิงความสัมพันธ์เดิมและมองหาโอกาสขายเพิ่ม/ต่อยอด`,
  };
}

// Pure: CopilotContext → deterministic CopilotResult. Score inputs are exactly
// the three the spec names (stage, recency, source); `reasons` is their
// breakdown, not model reasoning.
export function deterministicFallback(ctx: CopilotContext): CopilotResult {
  const base = STAGE_BASE[ctx.stage];
  const recency = recencyAdjustment(ctx.daysSinceLastActivity);
  const sourceBonus = SOURCE_BONUS[ctx.source];
  const score = clampScore(base + recency.delta + sourceBonus);

  const reasons = [
    `สเตจ ${STAGE_TH[ctx.stage]} → ฐาน ${base}`,
    `ความเคลื่อนไหว: ${recency.label} (${recency.delta >= 0 ? "+" : ""}${recency.delta})`,
    `ที่มา ${SOURCE_TH[ctx.source]} (+${sourceBonus})`,
  ];

  // Mechanically-derived next action: a stage-appropriate play, escalated when a
  // still-open lead has gone stale and enriched with a repeat-customer nudge —
  // never model-flavored. Opt-out overrides everything: suppress outreach.
  const optedOut = ctx.contact.consentStatus === "OPTED_OUT";
  const openStage = ctx.stage !== "WON" && ctx.stage !== "LOST";
  const stale = ctx.daysSinceLastActivity == null || ctx.daysSinceLastActivity > 30;
  const relationship = relationshipSignal(ctx);

  let nextAction: NextAction;
  if (optedOut) {
    nextAction = {
      action: `ห้ามติดต่อ ${ctx.contact.name} — ลูกค้าปฏิเสธการติดต่อ (OPTED_OUT)`,
      reason: "ลูกค้าปฏิเสธการติดต่อ งดการติดต่อจนกว่าสถานะความยินยอมจะเปลี่ยน",
      priority: "low",
    };
  } else {
    const play = stagePlay(ctx);
    let reason = play.reason;
    let priority = play.priority;
    if (openStage && stale) {
      priority = "high";
      reason += ctx.daysSinceLastActivity == null
        ? " ยังไม่มีบันทึกกิจกรรม — ควรรีบติดตาม"
        : ` ไม่มีความเคลื่อนไหวมา ${ctx.daysSinceLastActivity} วัน — ควรรีบติดตาม`;
    }
    if (relationship?.repeatClause) {
      reason += ` ${relationship.repeatClause}`;
    }
    nextAction = { action: play.action, reason, priority };
  }

  const overview =
    `${ctx.title} — ${ctx.company.name}${ctx.company.industry ? ` (${ctx.company.industry})` : ""}. ` +
    `สเตจ ${STAGE_TH[ctx.stage]} · ที่มา ${SOURCE_TH[ctx.source]} · มูลค่า ${formatTHB(ctx.valueTHB)} · เจ้าของดีล ${ctx.ownerName}. ` +
    `${ctx.daysSinceLastActivity == null ? "ยังไม่มีบันทึกกิจกรรม" : `กิจกรรมล่าสุดเมื่อ ${ctx.daysSinceLastActivity} วันก่อน`}`;

  const keyFacts = [
    `ขนาดบริษัท: ${ctx.company.size ?? "ไม่ระบุ"}`,
    `ผู้ติดต่อ: ${ctx.contact.name}${ctx.contact.title ? `, ${ctx.contact.title}` : ""}`,
    `เชื่อม LINE: ${ctx.contact.hasLine ? "ใช่" : "ไม่"} · ความยินยอม: ${CONSENT_TH[ctx.contact.consentStatus] ?? ctx.contact.consentStatus}`,
    `กิจกรรมที่บันทึก: ${ctx.activities.length} · ข้อความ: ${ctx.messages.length}`,
    ...(relationship ? [relationship.keyFact] : []),
  ];

  return {
    status: "service_unavailable",
    summary: {
      overview,
      keyFacts,
      openQuestions: ctx.score == null ? ["ยังไม่ได้ประเมินคุณภาพของลีดนี้"] : [],
    },
    qualification: {
      score,
      confidence: "low",
      reasons,
      // Fallback never recommends a stage change — a stage move must not rest on
      // a rule-based score (SKILL.md: never Won/Lost on a score alone).
      recommendedStage: "no_change",
    },
    nextAction,
    lineReply: null, // no conversation-grounded draft in fallback mode
    warnings: [
      "ระบบ AI ไม่พร้อมใช้งานชั่วคราว — นี่คือผลลัพธ์แบบกำหนดกฎ (deterministic fallback) ที่สร้างจากข้อมูลใน CRM ไม่ใช่ผลจากโมเดล",
    ],
  };
}
