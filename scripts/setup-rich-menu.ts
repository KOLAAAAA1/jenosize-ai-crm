import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Provisions the LINE OA rich menus (PLAN §Communication):
//   • GUEST  — the default menu (button 1 = register/connect via LIFF)
//   • MEMBER — swapped onto a user once they connect (button 1 = my info/update)
//
//   pnpm line:richmenu             → preview only: write both PNGs under public/
//   pnpm line:richmenu -- --apply  → publish both to the OA, set GUEST as default,
//                                     and print the MEMBER id for LINE_MEMBER_RICHMENU_ID
//
// After --apply, set LINE_MEMBER_RICHMENU_ID (local .env + Vercel) so the LIFF
// register/connect routes auto-switch a connected user onto the member menu.

const APPLY = process.argv.includes("--apply");
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const LIFF_ID = process.env.LINE_LIFF_ID?.trim();
const LIFF_URI = LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : null;

const WIDTH = 2500;
const HEIGHT = 843;

type Action = { type: "uri"; label: string; uri: string } | { type: "message"; text: string };
type Column = { label: string; accent: string; tint: string; action: Action; icon: (cx: number, a: string) => string };
type Menu = { name: string; chatBarText: string; imagePath: string; columns: Column[] };

const registerColumn: Column = {
  label: "ลงทะเบียน / เชื่อมต่อ",
  accent: "#4f46e5",
  tint: "#eef2ff",
  action: LIFF_URI ? { type: "uri", label: "ลงทะเบียน", uri: LIFF_URI } : { type: "message", text: "ขอลงทะเบียน" },
  icon: (cx, a) =>
    `<circle cx="${cx}" cy="300" r="46" fill="${a}"/>` +
    `<rect x="${cx - 82}" y="360" width="164" height="78" rx="39" fill="${a}"/>` +
    `<rect x="${cx + 40}" y="238" width="20" height="70" rx="10" fill="${a}"/>` +
    `<rect x="${cx + 15}" y="263" width="70" height="20" rx="10" fill="${a}"/>`,
};

const myInfoColumn: Column = {
  label: "ข้อมูลของฉัน / อัปเดต",
  accent: "#4f46e5",
  tint: "#eef2ff",
  action: LIFF_URI ? { type: "uri", label: "ข้อมูลของฉัน", uri: LIFF_URI } : { type: "message", text: "ขออัปเดตข้อมูล" },
  icon: (cx, a) => `<circle cx="${cx}" cy="298" r="52" fill="${a}"/>` + `<rect x="${cx - 92}" y="366" width="184" height="86" rx="43" fill="${a}"/>`,
};

const contactColumn: Column = {
  label: "ติดต่อทีมงาน",
  accent: "#06C755",
  tint: "#ecfdf5",
  action: { type: "message", text: "ขอติดต่อทีมงาน" },
  icon: (cx, a) =>
    `<rect x="${cx - 100}" y="268" width="200" height="132" rx="34" fill="${a}"/>` +
    `<path d="M ${cx - 24} 398 L ${cx - 4} 446 L ${cx + 28} 398 Z" fill="${a}"/>` +
    `<circle cx="${cx - 46}" cy="334" r="13" fill="#fff"/>` +
    `<circle cx="${cx}" cy="334" r="13" fill="#fff"/>` +
    `<circle cx="${cx + 46}" cy="334" r="13" fill="#fff"/>`,
};

const infoColumn: Column = {
  label: "สอบถามข้อมูล",
  accent: "#f59e0b",
  tint: "#fffbeb",
  action: { type: "message", text: "ขอสอบถามข้อมูลเพิ่มเติม" },
  icon: (cx, a) =>
    `<circle cx="${cx}" cy="340" r="92" fill="none" stroke="${a}" stroke-width="18"/>` +
    `<circle cx="${cx}" cy="300" r="13" fill="${a}"/>` +
    `<rect x="${cx - 12}" y="326" width="24" height="74" rx="12" fill="${a}"/>`,
};

const menus: Menu[] = [
  { name: "J. AI CRM guest", chatBarText: "เมนู", imagePath: resolve(process.cwd(), "public/line-rich-menu-guest.png"), columns: [registerColumn, contactColumn, infoColumn] },
  { name: "J. AI CRM member", chatBarText: "เมนู", imagePath: resolve(process.cwd(), "public/line-rich-menu-member.png"), columns: [myInfoColumn, contactColumn, infoColumn] },
];

function renderPng(columns: Column[]): Buffer {
  const colW = WIDTH / columns.length;
  const body = columns
    .map((c, i) => {
      const cx = i * colW + colW / 2;
      const divider = i > 0 ? `<line x1="${i * colW}" y1="120" x2="${i * colW}" y2="${HEIGHT - 80}" stroke="#e5e7eb" stroke-width="3"/>` : "";
      return (
        divider +
        `<circle cx="${cx}" cy="340" r="150" fill="${c.tint}"/>` +
        c.icon(cx, c.accent) +
        `<text x="${cx}" y="640" font-family="'Sarabun','Noto Sans Thai','Thonburi',sans-serif" font-size="72" font-weight="700" fill="#111827" text-anchor="middle">${c.label}</text>`
      );
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>` +
    `<rect width="${WIDTH}" height="10" fill="#4f46e5"/>` +
    `<text x="${WIDTH / 2}" y="86" font-family="sans-serif" font-size="44" font-weight="700" fill="#9ca3af" text-anchor="middle">J. AI CRM</text>` +
    body +
    `</svg>`;
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH }, font: { loadSystemFonts: true } }).render().asPng());
}

async function line(path: string, init: RequestInit, dataHost = false) {
  const res = await fetch(`https://api${dataHost ? "-data" : ""}.line.me${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LINE ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function createMenu(menu: Menu, png: Buffer): Promise<string> {
  const colW = WIDTH / menu.columns.length;
  const created = (await line("/v2/bot/richmenu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size: { width: WIDTH, height: HEIGHT },
      selected: false,
      name: menu.name,
      chatBarText: menu.chatBarText,
      areas: menu.columns.map((c, i) => ({ bounds: { x: Math.round(i * colW), y: 0, width: Math.round(colW), height: HEIGHT }, action: c.action })),
    }),
  })) as { richMenuId: string };
  await line(`/v2/bot/richmenu/${created.richMenuId}/content`, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(png) }, true);
  console.log(`created ${menu.name} → ${created.richMenuId}`);
  return created.richMenuId;
}

async function main() {
  const rendered = menus.map((m) => {
    const png = renderPng(m.columns);
    writeFileSync(m.imagePath, png);
    console.log(`${m.name}: ${m.imagePath} (${WIDTH}×${HEIGHT}, ${(png.length / 1024).toFixed(0)} KB) — buttons: ${m.columns.map((c) => `${c.label} → ${c.action.type}`).join(" · ")}`);
    return { menu: m, png };
  });
  if (!LIFF_URI) console.warn("⚠ LINE_LIFF_ID not set — the LIFF button falls back to a message action.");

  if (!APPLY) {
    console.log("\nPreview only. Review the PNGs under public/, then publish with:  pnpm line:richmenu -- --apply");
    return;
  }
  if (!TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set — cannot publish.");

  // Clean slate so re-runs don't accumulate menus.
  const existing = (await line("/v2/bot/richmenu/list", { method: "GET" })) as { richmenus?: { richMenuId: string }[] };
  for (const m of existing.richmenus ?? []) {
    await line(`/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
    console.log("deleted existing rich menu", m.richMenuId);
  }

  const [guest, member] = await Promise.all(rendered.map((r) => createMenu(r.menu, r.png)));
  await line(`/v2/bot/user/all/richmenu/${guest}`, { method: "POST" }); // guest = default for everyone
  console.log(`\nset GUEST as default ✓  (${guest})`);
  console.log(`➡ set  LINE_MEMBER_RICHMENU_ID=${member}  in your env (local .env + Vercel), then redeploy, so connected users auto-switch.`);
}

main().catch((err) => {
  console.error("setup-rich-menu failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
