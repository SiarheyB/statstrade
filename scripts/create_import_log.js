const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    // Create table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ImportLog" (
          "id" TEXT NOT NULL,
          "module" TEXT NOT NULL,
          "accountId" TEXT,
          "eventType" TEXT NOT NULL,
          "message" TEXT NOT NULL,
          "details" JSONB,
          "level" TEXT NOT NULL,
          "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

          CONSTRAINT "ImportLog_pkey" PRIMARY KEY ("id")
      )
    `);

    // Create indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_import_logs_timestamp" ON "ImportLog"("timestamp")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_import_logs_module" ON "ImportLog"("module")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_import_logs_account_id" ON "ImportLog"("accountId")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_import_logs_event_type" ON "ImportLog"("eventType")
    `);

    console.log('ImportLog table and indexes created successfully');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();