-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('ACTIVE', 'BUSY', 'OFFLINE');

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "presenceStatus" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "profiles" ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "profiles_presenceStatus_idx" ON "profiles"("presenceStatus");
