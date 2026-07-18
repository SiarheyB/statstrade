const { logger } = require('./src/lib/logger');

async function testLogger() {
  try {
    console.log('Testing logger with legacy signature (import route style)...');

    // Test the exact same calls as in the import route
    await logger.info("import", null, "=== IMPORT START ===", { url: "/api/accounts/test/import" });
    console.log('✓ Logged IMPORT_START');

    await logger.info("import", "user123", "AUTH", { userId: "user123" });
    console.log('✓ Logged AUTH');

    await logger.info("import", "account456", "account lookup", { found: true, source: "mt5" });
    console.log('✓ Logged account lookup');

    await logger.warn("import", null, "UNAUTHORIZED", { reason: "No valid auth token" });
    console.log('✓ Logged UNAUTHORIZED warning');

    await logger.error("import", "account456", "formData parse failed", {});
    console.log('✓ Logged formData parse error');

    await logger.info("import", "account456", "file received", {
      hasFile: true,
      size: 1024000,
      dryRun: false,
      originalName: "statement.csv"
    });
    console.log('✓ Logged file received');

    console.log('All logger tests passed!');
  } catch (e) {
    console.error('Logger test failed:', e.message);
  }
}

testLogger();