import "dotenv/config";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const requireExternal = process.env.SUBMISSION_REQUIRE_EXTERNAL === "true";
const checks = [];

function add(name, ok, detail, severity = "error") {
  checks.push({ name, ok, detail, severity });
}

function file(path) {
  add(`file:${path}`, existsSync(path), existsSync(path) ? "present" : "missing");
}

function script(name) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  add(`script:${name}`, Boolean(pkg.scripts?.[name]), pkg.scripts?.[name] ?? "missing");
}

function content(path, pattern, label) {
  if (!existsSync(path)) {
    add(`${path}:${label}`, false, "file missing");
    return;
  }
  const text = readFileSync(path, "utf8");
  add(`${path}:${label}`, pattern.test(text), pattern.test(text) ? "found" : "missing");
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(entry)) continue;
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function secretScan() {
  const allow = new Set([".env.example", "docs/SUBMISSION_CHECKLIST.md"]);
  const findings = [];
  for (const path of walk(".")) {
    if (path === ".env" || path.endsWith("pnpm-lock.yaml")) continue;
    const normalized = path.replace(/^\.\//, "");
    const text = readFileSync(path, "utf8");
    const patterns = [
      /sk-ant-(?!x{8,})[A-Za-z0-9_-]{20,}/g,
      /Bearer\s+[A-Za-z0-9._-]{30,}/g,
      /LINE_CHANNEL_ACCESS_TOKEN\s*=\s*["']?(?!x{8,})[A-Za-z0-9+/._=-]{30,}/g,
      /LINE_CHANNEL_SECRET\s*=\s*["']?(?!x{8,})[A-Za-z0-9+/._=-]{20,}/g,
    ];
    for (const pattern of patterns) {
      if (pattern.test(text) && !allow.has(normalized)) findings.push(normalized);
    }
  }
  add("secret scan", findings.length === 0, findings.length ? `possible secret in ${[...new Set(findings)].join(", ")}` : "no tracked secret-looking values found");
}

function envAudit() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const directUrl = process.env.DIRECT_URL ?? "";
  const appUrl = process.env.APP_URL ?? "";

  const localDb = /localhost|127\.0\.0\.1/.test(databaseUrl) || /localhost|127\.0\.0\.1/.test(directUrl);
  const localApp = /^http:\/\/(localhost|127\.0\.0\.1)/.test(appUrl);
  const deployReady = !localDb && !localApp && /^https:\/\//.test(appUrl);

  add("external deploy env", deployReady, deployReady ? "remote env shape" : "not deploy-ready in current env", requireExternal ? "error" : "warn");
}

file("README.md");
file("docs/PLAN.md");
file("docs/AI_USAGE_LOG.md");
file("docs/SUBMISSION_CHECKLIST.md");
file("docs/WALKTHROUGH_SCRIPT.md");
file("docs/architecture.html");
file("skills/crm-copilot/SKILL.md");
file(".env.example");
file("prisma/schema.prisma");
file("prisma/migrations/20260719143534_init/migration.sql");
file("prisma/migrations/20260720002356_add_contact_consent/migration.sql");

script("test");
script("build");
script("predeploy:check");
script("smoke:deploy");
script("line:events");
script("line:backfill");

content("docs/PLAN.md", /10 files \/ 63 tests passed/, "latest test count");
content("docs/AI_USAGE_LOG.md", /10 files \/ 63 tests passed/, "latest test count");
content("docs/SUBMISSION_CHECKLIST.md", /10 files \/ 63 tests passed/, "latest test count");
content("docs/SUBMISSION_CHECKLIST.md", /Vercel CLI: not installed/, "deploy audit");
content("README.md", /pnpm smoke:deploy/, "smoke docs");
content("README.md", /pnpm line:backfill/, "line backfill docs");

secretScan();
envAudit();

const failures = checks.filter((c) => !c.ok && c.severity === "error");
const warnings = checks.filter((c) => !c.ok && c.severity === "warn");

for (const c of checks) {
  const label = c.ok ? "PASS" : c.severity === "warn" ? "WARN" : "FAIL";
  console.log(`${label} ${c.name} - ${c.detail}`);
}

if (warnings.length) console.log(`Warnings: ${warnings.length}`);
if (failures.length) {
  console.error(`Submission audit failed: ${failures.length} blocking issue(s).`);
  process.exit(1);
}

console.log("Submission audit passed.");
