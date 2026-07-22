import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The pg driver adapter speaks standard Postgres, so the SAME code targets
// local Docker, a native local install, a remote server, or Neon serverless.
// Switching targets is an env change (DATABASE_URL), never a code change.
//
// Default target is local Docker (docker-compose.yml) so `pnpm db:up && pnpm dev`
// works with no .env. In production the URL is required — never silently
// fall back (that would point prod at localhost).
const LOCAL_DOCKER_URL = "postgresql://crm:crm@localhost:5432/crm?schema=public";

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production (set it to your Neon/server connection string).");
  }
  console.warn("[db] DATABASE_URL not set — defaulting to local Docker Postgres. Run `pnpm db:up`.");
  return LOCAL_DOCKER_URL;
}

// Reuse a single PrismaClient across hot-reloads in dev to avoid exhausting
// database connections. In production a fresh module instance is fine.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg({ connectionString: resolveDatabaseUrl() });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
