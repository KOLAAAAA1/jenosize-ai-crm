-- CreateEnum
CREATE TYPE "PendingIntent" AS ENUM ('AWAITING_INQUIRY');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "pendingIntent" "PendingIntent";
