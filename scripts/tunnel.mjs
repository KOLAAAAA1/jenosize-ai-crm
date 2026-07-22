// Quick Cloudflare Tunnel for local webhook development.
//
// Runs an ephemeral `cloudflared` tunnel (no Cloudflare account or domain
// needed) that exposes the local dev server on a public HTTPS
// `*.trycloudflare.com` URL, so LINE (or any external provider) can reach the
// webhook while you develop.
//
//   pnpm dev        # in one terminal (Next on :3000)
//   pnpm tunnel     # in another — prints the public LINE webhook URL
//
// Paste the printed "LINE webhook" URL into LINE Developers console
// (Messaging API → Webhook URL → Verify). The URL changes every run — quick
// tunnels are ephemeral by design. For a stable URL, use a named tunnel
// (see README → "Local webhook via Cloudflare Tunnel").
import { spawn } from "node:child_process";

const PORT = process.env.TUNNEL_PORT ?? "3000";
const WEBHOOK_PATH = process.env.TUNNEL_WEBHOOK_PATH ?? "/api/line/webhook";
const TARGET = `http://localhost:${PORT}`;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const child = spawn("cloudflared", ["tunnel", "--url", TARGET], {
  stdio: ["ignore", "pipe", "pipe"],
});

let announced = false;

function handle(chunk) {
  const text = chunk.toString();
  process.stderr.write(text); // pass cloudflared's own logs straight through
  const match = text.match(URL_RE);
  if (match && !announced) {
    announced = true;
    const base = match[0];
    const line = "═".repeat(64);
    process.stdout.write(
      `\n${line}\n` +
        `  Cloudflare Tunnel is up → ${TARGET}\n` +
        `  Public base:   ${base}\n` +
        `  LINE webhook:  ${base}${WEBHOOK_PATH}\n` +
        `\n` +
        `  Paste the LINE webhook URL into LINE Developers console:\n` +
        `    Messaging API → Webhook URL → Verify (then enable "Use webhook").\n` +
        `  Ensure LINE_CHANNEL_SECRET in .env matches this channel.\n` +
        `  This URL is ephemeral — it changes each run.\n` +
        `${line}\n\n`,
    );
  }
}

child.stdout.on("data", handle);
child.stderr.on("data", handle);

child.on("error", (err) => {
  if (err.code === "ENOENT") {
    process.stderr.write(
      "\ncloudflared not found. Install it first:\n  brew install cloudflared\n\n",
    );
    process.exit(127);
  }
  process.stderr.write(`\ntunnel error: ${err.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
