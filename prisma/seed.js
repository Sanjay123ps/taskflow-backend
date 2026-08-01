"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    // The employee ID counter is a single row keyed at id=1; nextEmployeeId()
    // also creates it lazily on first use, but seeding it here makes a fresh
    // database's state explicit and avoids a first-request race in a
    // multi-instance deployment.
    await prisma.$executeRaw `INSERT INTO employee_id_counter (id, "lastSeq") VALUES (1, 0) ON CONFLICT (id) DO NOTHING`;
    // eslint-disable-next-line no-console
    console.log('Seed complete. Employee ID counter initialized.');
    // eslint-disable-next-line no-console
    console.log('To create the first Admin account, call POST /api/v1/auth/setup-initial-admin with INITIAL_ADMIN_SETUP_TOKEN.');
}
main()
    .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map