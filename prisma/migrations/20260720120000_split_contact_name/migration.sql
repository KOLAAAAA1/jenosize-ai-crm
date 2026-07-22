-- Split Contact.name into firstName + lastName (easier search/filter).
-- Added nullable, backfilled from the existing single name, then set NOT NULL
-- and dropped `name`. Safe on a non-empty table and on the deploy path with real
-- data; the local dev DB is reseeded immediately after this migration.

ALTER TABLE "Contact" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Contact" ADD COLUMN "lastName" TEXT;

UPDATE "Contact"
SET "firstName" = split_part("name", ' ', 1),
    "lastName"  = CASE
      WHEN position(' ' IN "name") > 0
        THEN btrim(substring("name" FROM position(' ' IN "name") + 1))
      ELSE ''
    END
WHERE "firstName" IS NULL;

ALTER TABLE "Contact" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "lastName" SET NOT NULL;
ALTER TABLE "Contact" DROP COLUMN "name";
