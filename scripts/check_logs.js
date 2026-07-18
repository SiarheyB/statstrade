import { prisma } from '../../src/lib/db';

async function testLogs() {
  try {
    console.log('Testing ImportLog table...');

    // Check if table exists and count records
    const count = await prisma.importLog.count();
    console.log(`Total logs in database: ${count}`);

    // Get recent logs
    const logs = await prisma.importLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: 10
    });

    console.log(`Found ${logs.length} recent logs:`);
    logs.forEach((log, index) => {
      console.log(`${index + 1}. [${log.timestamp}] ${log.module} ${log.level}: ${log.message}`);
    });

    // If no logs exist, let's create a test log
    if (count === 0) {
      console.log('No logs found. Creating test log...');
      const testLog = await prisma.importLog.create({
        data: {
          module: 'test',
          accountId: 'test-account',
          eventType: 'TEST_EVENT',
          message: 'This is a test log entry',
          details: { test: true, value: 123 },
          level: 'info',
        },
      });
      console.log(`Created test log: ${testLog.id}`);

      // Verify it was saved
      const newCount = await prisma.importLog.count();
      console.log(`New total count: ${newCount}`);
    }
  } catch (error) {
    console.error('Error testing logs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testLogs();