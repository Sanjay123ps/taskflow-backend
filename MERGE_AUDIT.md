# TaskFlow Backend Merge Audit

## Source branches reviewed
1. Admin branch: `taskflow-admin-signup-approval.zip`
2. Staff branch: `Backend-updated_with_otp.tar.gz`

## Merge decision
The Staff backend was used as the functional base because it contains the broader complete backend and the existing Staff signup OTP + password-reset OTP flow.

The Admin branch changes were merged selectively:
- `AdminSignupRequest` Prisma model
- Admin signup OTP request/verify/resend/review flow
- Admin signup routes
- Admin signup DTO
- Admin signup route registration
- Admin signup database migration support

## Critical conflicts found

### 1. OTP database models were incompatible
The Staff branch uses:
- `OtpPurpose`
- `OtpVerification`
- `SIGNUP_VERIFY`
- `PASSWORD_RESET`

The Admin branch replaced this with:
- `EmailOtpPurpose`
- `EmailOtp`
- `ADMIN_SIGNUP_VERIFY`
- `PASSWORD_RESET`

This replacement would break the Staff OTP flow if used directly.

### 2. Admin `auth.service.ts` replaced Staff authentication OTP behavior
The Admin branch's auth service removed the Staff email-verification login gate and the Staff signup/password-reset OTP service integration.

The merged backend keeps the Staff `auth.service.ts` and shared `otp.service.ts`, so:
- Staff signup OTP continues to work.
- Staff forgot-password OTP continues to work.
- Admin forgot-password OTP continues to work for active admins.
- Admin signup OTP uses the same shared OTP infrastructure.

### 3. Admin branch referenced missing files
The Admin branch `auth.service.ts` referenced:
- `src/utils/otp.ts`
- `src/utils/mailer.ts`

Those files were not present in the supplied Admin patch archive, so that branch could not be treated as a complete drop-in backend.

### 4. Admin branch schema removed Staff OTP fields
The Admin schema removed:
- `Profile.emailVerifiedAt`
- `OtpVerification`
- `OtpPurpose`
- Staff OTP-related activity actions

Those were restored in the merged schema.

## Final OTP architecture

### Staff signup
`SIGNUP_VERIFY` -> `OtpVerification` -> verify OTP -> `Profile.emailVerifiedAt` -> Admin approval -> ACTIVE

### Admin signup
`ADMIN_SIGNUP_VERIFY` -> same `OtpVerification` table -> verify OTP -> `AdminSignupRequest.emailVerifiedAt` -> existing Admin approval -> ACTIVE

### Password reset
`PASSWORD_RESET` -> same `OtpVerification` table -> verify OTP -> single-use reset token -> Supabase password update

## Important deployment note
The merged backend includes a new migration:
`prisma/migrations/20260801000000_merge_admin_staff_otp/migration.sql`

Run:
- `npx prisma generate`
- `npx prisma migrate deploy`

Do not run `prisma db push` on production as a replacement for migrations.

## Secrets
The supplied `.env` file was intentionally NOT included in the merged ZIP.

Create the production environment variables from your existing deployment configuration.

## Verification status
This is a code-level merge and audit of the supplied files. A live end-to-end OTP test against your Supabase project and email provider was not possible without your actual deployment environment and secrets.

Before production:
1. Run Prisma migration.
2. Run `npm install`.
3. Run `npm run build`.
4. Test Staff signup -> OTP -> approval -> login.
5. Test Admin signup -> OTP -> Admin approval -> login.
6. Test Staff forgot password.
7. Test Admin forgot password.
8. Test OTP resend, expiry, invalid attempts, and single-use behavior.

## Final result
The merged backend is designed so Admin and Staff OTP flows share one OTP table/service instead of competing implementations.
