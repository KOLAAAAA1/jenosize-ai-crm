import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 reads CLI/migration config from this file (not from the schema or
// package.json). Migrations use the DIRECT connection (no pooler); the app
// runtime connects via the pg driver adapter using DATABASE_URL (see src/lib/db.ts).
//
// Defaults to local Docker Postgres so migrations/seed work with no .env.
// For Neon, DIRECT_URL is the direct (non-pooled) endpoint migrations must use.
const LOCAL_DOCKER_URL = "postgresql://crm:crm@localhost:5432/crm?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? LOCAL_DOCKER_URL,
  },
});
