import "dotenv/config";

// Deterministic secret for session unit tests (never used in real runtimes).
process.env.AUTH_SECRET ||= "test-secret-do-not-use-in-prod";
