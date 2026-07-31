-- Rename `activity_logs` to `ActivityLog` so the audit table matches the PascalCase
-- singular convention every other table already uses (User, Lead, Activity, …).
--
-- Hand-written on purpose: Prisma cannot infer a rename and would emit DROP + CREATE,
-- which would discard the audit rows already written in production. `RENAME TO` only
-- renames the table, so the primary key, indexes, and foreign key are renamed
-- explicitly too — otherwise they keep their old names and show up as permanent drift.

ALTER TABLE "activity_logs" RENAME TO "ActivityLog";

ALTER INDEX "activity_logs_userId_idx" RENAME TO "ActivityLog_userId_idx";
ALTER INDEX "activity_logs_createdAt_idx" RENAME TO "ActivityLog_createdAt_idx";
ALTER INDEX "activity_logs_path_idx" RENAME TO "ActivityLog_path_idx";

ALTER TABLE "ActivityLog" RENAME CONSTRAINT "activity_logs_pkey" TO "ActivityLog_pkey";
ALTER TABLE "ActivityLog" RENAME CONSTRAINT "activity_logs_userId_fkey" TO "ActivityLog_userId_fkey";
