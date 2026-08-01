-- CreateTable
CREATE TABLE "admin_signup_requests" (
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

-- CreateIndex
CREATE UNIQUE INDEX "admin_signup_requests_profileId_key" ON "admin_signup_requests"("profileId");

-- CreateIndex
CREATE INDEX "admin_signup_requests_status_idx" ON "admin_signup_requests"("status");

-- CreateIndex
CREATE INDEX "admin_signup_requests_email_idx" ON "admin_signup_requests"("email");

-- AddForeignKey
ALTER TABLE "admin_signup_requests" ADD CONSTRAINT "admin_signup_requests_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_signup_requests" ADD CONSTRAINT "admin_signup_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
