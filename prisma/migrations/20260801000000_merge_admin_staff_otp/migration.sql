-- Merge migration: keep the Staff OTP system and add the Admin signup OTP purpose.
-- Safe for databases where the Admin signup table was already created by the
-- Admin portal branch.

ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'ADMIN_SIGNUP_VERIFY';

CREATE TABLE IF NOT EXISTS "admin_signup_requests" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_signup_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_signup_requests_profileId_key"
  ON "admin_signup_requests"("profileId");

CREATE INDEX IF NOT EXISTS "admin_signup_requests_status_idx"
  ON "admin_signup_requests"("status");

CREATE INDEX IF NOT EXISTS "admin_signup_requests_email_idx"
  ON "admin_signup_requests"("email");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_signup_requests_profileId_fkey'
  ) THEN
    ALTER TABLE "admin_signup_requests"
      ADD CONSTRAINT "admin_signup_requests_profileId_fkey"
      FOREIGN KEY ("profileId") REFERENCES "profiles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_signup_requests_reviewedById_fkey'
  ) THEN
    ALTER TABLE "admin_signup_requests"
      ADD CONSTRAINT "admin_signup_requests_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "profiles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
