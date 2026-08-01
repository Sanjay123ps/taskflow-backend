// One-off fix: verify email + activate a staff account stuck in the
// signup flow. Run from the backend project root (where prisma/schema.prisma
// and node_modules live) so it picks up the same DATABASE_URL as the app.
//
//   node fix-account.js
//
// Delete this file afterwards — it's a manual patch, not part of the app.

require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EMAIL = 'dazzlingking1408@gmail.com';

async function main() {
  const profile = await prisma.profile.update({
    where: { email: EMAIL },
    data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
  });
  console.log('Updated:', profile.email, profile.status, profile.emailVerifiedAt);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
