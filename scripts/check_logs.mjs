import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  try {
    const count = await prisma.importLog.count()
    console.log('Total logs in DB:', count)

    if (count > 0) {
      const logs = await prisma.importLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: 5,
      })
      console.log('Recent logs:')
      for (const l of logs) {
        console.log(`  [${l.level}] ${l.module} / ${l.eventType} :: ${l.message}`)
      }
    } else {
      console.log('No logs yet. Writing a test log...')
      await prisma.importLog.create({
        data: {
          module: 'test',
          accountId: 'test-account',
          eventType: 'TEST_EVENT',
          message: 'test log entry',
          details: { test: true },
          level: 'info',
        },
      })
      console.log('Test log created')
    }
  } catch (e) {
    console.error('ERROR:', e.message)
  } finally {
    await prisma.$disconnect()
  }
}

main()
