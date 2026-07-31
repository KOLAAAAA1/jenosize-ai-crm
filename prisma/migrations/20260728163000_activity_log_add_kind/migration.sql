-- Widen the audit trail from API-only to page views as well, so visits to the
-- dashboard, leads, board, tasks, companies and contacts pages are recorded. Those
-- pages are Server Components that query Postgres directly — there is no API request
-- behind them — so the only way to see them is to log the navigation itself.
--
-- `kind` keeps the two separable: "api" for /api/**, "page" for a page view. The
-- DEFAULT backfills every existing row as "api", which is exactly what they are.

ALTER TABLE "ActivityLog" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'api';

CREATE INDEX "ActivityLog_kind_idx" ON "ActivityLog"("kind");
