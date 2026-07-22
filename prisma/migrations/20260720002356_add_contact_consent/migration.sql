-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN';
