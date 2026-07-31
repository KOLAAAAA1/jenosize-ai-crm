import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the Next dev server to be reached through a Cloudflare quick tunnel
  // (*.trycloudflare.com) for local LINE-webhook testing. Without this, Next 16
  // blocks cross-origin dev resources (HMR websocket, internal /_next assets)
  // from a non-localhost origin, so the login page renders but never hydrates
  // and the form does a native GET submit instead of the fetch login.
  //
  // Dev-only: `allowedDevOrigins` has no effect on production builds. The `*.`
  // wildcard covers the ephemeral tunnel subdomain, which changes each run.
  allowedDevOrigins: ["*.trycloudflare.com"],

  // `src/lib/ai/skill.ts` reads skills/crm-copilot/SKILL.md from disk at run time to
  // build the model's system prompt. Next traces imports, not runtime fs reads, so
  // without this the file is absent from the deployed function bundle and every
  // prompt silently loses the skill contract (a logged warning, prod only). Keyed by
  // route glob; `/*` covers both the copilot route and the LINE webhook, which each
  // call a model.
  outputFileTracingIncludes: {
    "/*": ["skills/crm-copilot/SKILL.md"],
  },
};

export default nextConfig;
