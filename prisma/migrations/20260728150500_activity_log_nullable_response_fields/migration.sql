-- Logging moved from the per-route `withApiLog()` wrapper to a single Next proxy
-- (src/proxy.ts), so every route under /api/** is captured automatically instead of
-- each one having to remember the wrapper.
--
-- The tradeoff: Next's proxy runs *before* the request completes and has no `next()`
-- continuation, so the handler's response is never visible to it. `statusCode` and
-- `durationMs` therefore cannot be observed and must accept NULL. Rows written by
-- the old wrapper keep the values they already have — this is DROP NOT NULL only,
-- no data is touched.

ALTER TABLE "ActivityLog" ALTER COLUMN "statusCode" DROP NOT NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "durationMs" DROP NOT NULL;
