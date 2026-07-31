import "dotenv/config";

// Deterministic secret for session unit tests (never used in real runtimes).
process.env.AUTH_SECRET ||= "test-secret-do-not-use-in-prod";

// `.env` holds REAL credentials (a LINE channel token, provider API keys), and
// dotenv above loads them. Since the LINE webhook route now generates and sends an
// AI auto-reply on an inbound message, a route-level test would otherwise call the
// model for real and push a real LINE message to whatever user id the fixture
// invented. Neutralise both here, for the whole suite:
//
//   LINE_ENABLED=false  → adapter.ts returns its mock result instead of calling LINE.
//   no provider keys    → the AI paths take their deterministic fallback.
//
// Tests that need a specific model behaviour inject `callModel` / `generate`
// directly (the seam every AI module exposes), so nothing here weakens coverage.
process.env.LINE_ENABLED = "false";
delete process.env.OPENROUTER_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
