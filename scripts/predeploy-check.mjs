import "dotenv/config";

const allowLocal = process.env.PREDEPLOY_ALLOW_LOCAL === "true";

const checks = [];

function add(name, ok, detail, severity = "error") {
  checks.push({ name, ok, detail, severity });
}

function value(name) {
  return process.env[name]?.trim() ?? "";
}

function isPlaceholder(v) {
  return !v || /x{8,}|replace-with|YOUR_|NEON_|USER:PASSWORD|YOUR_DEPLOYED_HOST|YOUR_VERCEL_HOST/i.test(v);
}

function parseUrl(name) {
  const v = value(name);
  if (!v) return null;
  try {
    return new URL(v);
  } catch {
    return null;
  }
}

function isLocalUrl(url) {
  if (!url) return false;
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
}

function checkRequired(name, options = {}) {
  const v = value(name);
  add(name, Boolean(v), v ? "present" : "missing");
  if (!v) return;
  add(`${name} placeholder`, !isPlaceholder(v), isPlaceholder(v) ? "placeholder value" : "not a placeholder");
  if (options.minLength) {
    add(`${name} length`, v.length >= options.minLength, `length ${v.length}; expected >= ${options.minLength}`);
  }
}

function checkPostgresUrl(name, { shouldBePooled = false } = {}) {
  const url = parseUrl(name);
  add(`${name} parse`, Boolean(url), url ? "valid URL" : "invalid URL");
  if (!url) return;
  add(`${name} protocol`, url.protocol === "postgresql:" || url.protocol === "postgres:", url.protocol);
  if (!allowLocal) {
    add(`${name} remote`, !isLocalUrl(url), isLocalUrl(url) ? "points to local database" : `host ${url.host}`);
  }
  if (shouldBePooled && !allowLocal) {
    const pooledHint = /pooler|pgbouncer=true/i.test(url.host + url.search);
    add(`${name} pooled`, pooledHint, pooledHint ? "pooled endpoint hint present" : "expected pooled Neon/runtime URL hint");
  }
}

function checkAppUrl() {
  const url = parseUrl("APP_URL");
  add("APP_URL parse", Boolean(url), url ? "valid URL" : "invalid URL");
  if (!url) return;
  add("APP_URL https", allowLocal || url.protocol === "https:", allowLocal ? "local allowed" : url.protocol);
  if (!allowLocal) {
    add("APP_URL remote", !isLocalUrl(url), isLocalUrl(url) ? "points to localhost" : url.host);
  }
}

checkRequired("DATABASE_URL");
checkRequired("DIRECT_URL");
checkRequired("AUTH_SECRET", { minLength: 32 });
checkRequired("APP_URL");
// AI engine: either provider key satisfies this (OpenRouter preferred). With
// neither, the copilot still runs but only returns its deterministic fallback.
{
  const aiKey = value("OPENROUTER_API_KEY") || value("ANTHROPIC_API_KEY");
  const which = value("OPENROUTER_API_KEY") ? "OpenRouter" : value("ANTHROPIC_API_KEY") ? "Anthropic" : "";
  add(
    "AI provider key",
    Boolean(aiKey && !isPlaceholder(aiKey)),
    aiKey ? (isPlaceholder(aiKey) ? "placeholder value" : which) : "missing OPENROUTER_API_KEY / ANTHROPIC_API_KEY",
  );
}

checkPostgresUrl("DATABASE_URL", { shouldBePooled: true });
checkPostgresUrl("DIRECT_URL");
checkAppUrl();

const lineEnabled = value("LINE_ENABLED");
add("LINE_ENABLED", lineEnabled === "true", lineEnabled ? `value ${lineEnabled}` : "missing; set true for real LINE deploy", "warn");

if (lineEnabled === "true") {
  checkRequired("LINE_CHANNEL_SECRET");
  checkRequired("LINE_CHANNEL_ACCESS_TOKEN");
} else {
  add("LINE real adapter", allowLocal, "LINE_ENABLED is not true; real outbound sends disabled", "warn");
}

const failures = checks.filter((c) => !c.ok && c.severity === "error");
const warnings = checks.filter((c) => !c.ok && c.severity === "warn");

for (const c of checks) {
  const label = c.ok ? "PASS" : c.severity === "warn" ? "WARN" : "FAIL";
  console.log(`${label} ${c.name} - ${c.detail}`);
}

if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
}

if (failures.length > 0) {
  console.error(`Predeploy check failed: ${failures.length} blocking issue(s).`);
  process.exit(1);
}

console.log("Predeploy check passed.");
