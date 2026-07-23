-- AlterEnum
ALTER TYPE "MessageChannel" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "expectedCloseAt" TIMESTAMP(3),
ADD COLUMN     "probability" INTEGER;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "providerThreadId" TEXT,
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "toAddress" TEXT;

-- CreateIndex
CREATE INDEX "Lead_expectedCloseAt_idx" ON "Lead"("expectedCloseAt");
