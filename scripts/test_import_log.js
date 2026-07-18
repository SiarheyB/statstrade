const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();

  try {
    // Test if we can write to the ImportLog table
    const log = await prisma.importLog.create({
      data: {
        module: 'import',
        accountId: 'test_account',
        eventType: 'TEST',
        message: 'Test log entry',
        details: { test: true, value: 42 },
        level: 'info',
      },
    });
    console.log('Created test log:', log.id);

    // Test if we can read from the ImportLog table
    const logs = await prisma.importLog.findMany();
    console.log('Total logs in table:', logs.length);
    console.log('First log:', JSON.stringify(logs[0], null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();