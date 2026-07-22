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
};

export default nextConfig;
