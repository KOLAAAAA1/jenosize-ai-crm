-- AI auto-reply becomes the default answer to an inbound LINE message.
--
-- `Contact.autoReplyEnabled` used to gate a canned greeting that was OFF for
-- everyone unless a sale/admin opted a customer in. It now gates the AI reply that
-- src/lib/line/ai-autoreply.ts generates and sends, and the product default is ON —
-- a rep switches it off to take the conversation over by hand.
--
-- Flipping the DEFAULT only affects rows inserted from here on, so the UPDATE
-- backfills existing contacts. That is deliberate: while the column meant "opt this
-- customer into a canned greeting" nobody had turned it on, so there is no
-- deliberate OFF choice to preserve.

ALTER TABLE "Contact" ALTER COLUMN "autoReplyEnabled" SET DEFAULT true;

UPDATE "Contact" SET "autoReplyEnabled" = true WHERE "autoReplyEnabled" = false;
