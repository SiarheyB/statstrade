#!/usr/bin/env node
/**
 * Test data generator for estimating storage requirements.
 * Run with: node scripts/generate_test_data.js
 *
 * Simulates collector output for a given period and estimates table sizes.
 */

// Configuration matching the collector defaults
const CONFIG = {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  exchanges: ['binance-futures', 'binance-spot', 'bybit-futures'],
  binSize: {
    BTCUSDT: 25,
    ETHUSDT: 1,
  },
  snapshotMs: 2000,           // 2 seconds per snapshot
  depthPct: 0.02,             // ±2% from mid
  days: 30,                   // Simulation period
};

// Price simulation parameters
const PRICE_PARAMS = {
  BTCUSDT: { basePrice: 50000, volatility: 0.02, avgPriceLevels: 120 },
  ETHUSDT: { basePrice: 3000, volatility: 0.025, avgPriceLevels: 150 },
};

// Exchange weights (some exchanges have more activity)
const EXCHANGE_WEIGHTS = {
  'binance-futures': 1.0,
  'binance-spot': 0.7,
  'bybit-futures': 0.4,
};

function simulate() {
  const msPerDay = 86400000;
  const snapshotsPerDay = msPerDay / CONFIG.snapshotMs;
  const minutesPerDay = 1440;

  let totals = {
    obSnapshotRows: 0,
    obTradeRows: 0,
    obFootprintRows: 0,
    obBigTradeRows: 0,
    obSnapshotRollupRows: 0,
    obRollupBucketRows: 0,
  };

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  STORAGE ESTIMATION SIMULATION');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Symbols: ${CONFIG.symbols.join(', ')}`);
  console.log(`Exchanges: ${CONFIG.exchanges.join(', ')}`);
  console.log(`Simulation period: ${CONFIG.days} days`);
  console.log(`Snapshot interval: ${CONFIG.snapshotMs}ms (${snapshotsPerDay.toFixed(0)}/day)`);
  console.log('');

  for (const symbol of CONFIG.symbols) {
    const params = PRICE_PARAMS[symbol];
    console.log(`\n📊 ${symbol} (base: $${params.basePrice.toLocaleString()})`);

    let symbolTotals = { ...totals };

    for (const exchange of CONFIG.exchanges) {
      const weight = EXCHANGE_WEIGHTS[exchange] || 0.5;
      const priceLevels = Math.round(params.avgPriceLevels * weight);

      // Raw snapshots: snapshot interval * price levels * days
      const obSnapshotRows = Math.round(snapshotsPerDay * priceLevels * CONFIG.days * weight);
      totals.obSnapshotRows += obSnapshotRows;

      // Trade deltas: 1 row per snapshot (buyVol + sellVol aggregated)
      const obTradeRows = Math.round(snapshotsPerDay * CONFIG.days * weight);
      totals.obTradeRows += obTradeRows;

      // Footprint: 1 row per price level per snapshot (only levels with volume)
      // Assume ~30% of price levels have trade volume
      const obFootprintRows = Math.round(obSnapshotRows * 0.3);
      totals.obFootprintRows += obFootprintRows;

      // Big trades: ~0.1% of trades are "big"
      const obBigTradeRows = Math.round(obTradeRows * 0.001);
      totals.obBigTradeRows += obBigTradeRows;

      // Rollup: 1 bucket per minute, each with priceLevels entries
      const obSnapshotRollupRows = Math.round(minutesPerDay * priceLevels * CONFIG.days * weight);
      totals.obSnapshotRollupRows += obSnapshotRollupRows;

      // Rollup bucket: 1 per minute
      const obRollupBucketRows = Math.round(minutesPerDay * CONFIG.days * weight);
      totals.obRollupBucketRows += obRollupBucketRows;

      console.log(`  ${exchange.padEnd(18)} | snapshots: ${obSnapshotRows.toLocaleString().padStart(12)} | trades: ${obTradeRows.toLocaleString().padStart(10)} | fp: ${obFootprintRows.toLocaleString().padStart(10)} | big: ${obBigTradeRows.toLocaleString().padStart(8)} | rollup: ${obSnapshotRollupRows.toLocaleString().padStart(10)} | buckets: ${obRollupBucketRows.toLocaleString().padStart(8)}`);
    }
  }

  // Calculate sizes (bytes per row based on schema analysis)
  const ROW_SIZES = {
    obSnapshot: 85,        // id(8) + symbol(10) + exchange(15) + t(8) + price(8) + bidVol(8) + askVol(8) + index overhead
    obTrade: 65,           // id(8) + symbol(10) + exchange(15) + t(8) + buyVol(8) + sellVol(8)
    obFootprint: 70,       // similar to trade but with price
    obBigTrade: 65,        // similar
    obSnapshotRollup: 75,  // symbol(10) + exchange(15) + bucket(8) + price(8) + volSum(8) + bidSum(8) + askSum(8) + PK
    obRollupBucket: 50,    // symbol(10) + exchange(15) + bucket(8) + snaps(4) + midSum(8)
  };

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ESTIMATED ROW COUNTS & STORAGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const estimates = [
    { table: 'ObSnapshot (raw)', rows: totals.obSnapshotRows, rowSize: ROW_SIZES.obSnapshot },
    { table: 'ObTrade', rows: totals.obTradeRows, rowSize: ROW_SIZES.obTrade },
    { table: 'ObFootprint', rows: totals.obFootprintRows, rowSize: ROW_SIZES.obFootprint },
    { table: 'ObBigTrade', rows: totals.obBigTradeRows, rowSize: ROW_SIZES.obBigTrade },
    { table: 'ObSnapshotRollup', rows: totals.obSnapshotRollupRows, rowSize: ROW_SIZES.obSnapshotRollup },
    { table: 'ObRollupBucket', rows: totals.obRollupBucketRows, rowSize: ROW_SIZES.obRollupBucket },
  ];

  let totalBytes = 0;
  let totalRows = 0;

  for (const est of estimates) {
    const bytes = est.rows * est.rowSize;
    const gb = bytes / (1024 ** 3);
    totalBytes += bytes;
    totalRows += est.rows;
    console.log(`  ${est.table.padEnd(22)} | ${est.rows.toString().padStart(15)} rows | ${(bytes / 1024 / 1024).toFixed(1).padStart(8)} MB | ${gb.toFixed(2).padStart(6)} GB`);
  }

  console.log(`  ${'─'.repeat(70)}`);
  console.log(`  ${'TOTAL'.padEnd(22)} | ${totalRows.toString().padStart(15)} rows | ${(totalBytes / 1024 / 1024).toFixed(1).padStart(8)} MB | ${(totalBytes / 1024 / 1024 / 1024).toFixed(2).padStart(6)} GB`);

  // Now calculate with retention periods
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  STORAGE WITH RETENTION POLICIES');
  console.log('═══════════════════════════════════════════════════════════\n');

  const RAW_RETENTION_DAYS = 30;
  const ROLLUP_RETENTION_DAYS = 365;
  const TRADE_RETENTION_DAYS = 30;

  // Raw data (ObSnapshot) - 30 days
  const rawSnapshotBytes = (totals.obSnapshotRows / CONFIG.days) * RAW_RETENTION_DAYS * ROW_SIZES.obSnapshot;

  // Trade data (ObTrade, ObFootprint, ObBigTrade) - 30 days
  const tradeBytes = ((totals.obTradeRows / CONFIG.days) * TRADE_RETENTION_DAYS * ROW_SIZES.obTrade) +
                     ((totals.obFootprintRows / CONFIG.days) * TRADE_RETENTION_DAYS * ROW_SIZES.obFootprint) +
                     ((totals.obBigTradeRows / CONFIG.days) * TRADE_RETENTION_DAYS * ROW_SIZES.obBigTrade);

  // Rollup data - 365 days
  const rollupBytes = ((totals.obSnapshotRollupRows / CONFIG.days) * ROLLUP_RETENTION_DAYS * ROW_SIZES.obSnapshotRollup) +
                      ((totals.obRollupBucketRows / CONFIG.days) * ROLLUP_RETENTION_DAYS * ROW_SIZES.obRollupBucket);

  const retainedTotal = rawSnapshotBytes + tradeBytes + rollupBytes;

  console.log(`  Raw snapshots (${RAW_RETENTION_DAYS}d):     ${(rawSnapshotBytes / 1024 ** 3).toFixed(2).padStart(8)} GB`);
  console.log(`  Trade data (${TRADE_RETENTION_DAYS}d):           ${(tradeBytes / 1024 ** 3).toFixed(2).padStart(8)} GB`);
  console.log(`  Rollup data (${ROLLUP_RETENTION_DAYS}d):         ${(rollupBytes / 1024 ** 3).toFixed(2).padStart(8)} GB`);
  console.log(`  ${'─'.repeat(45)}`);
  console.log(`  TOTAL RETAINED:              ${(retainedTotal / 1024 ** 3).toFixed(2).padStart(8)} GB`);

  // With compression (PostgreSQL TOAST + page compression ~40-60%)
  const compressedEstimate = retainedTotal * 0.45;
  console.log(`\n  With ~55% compression:       ${(compressedEstimate / 1024 ** 3).toFixed(2).padStart(8)} GB`);

  // Yearly projection for rollup
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  YEARLY PROJECTION (Rollup only, 365 days)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const yearlyRollupBytes = ((totals.obSnapshotRollupRows / CONFIG.days) * 365 * ROW_SIZES.obSnapshotRollup) +
                            ((totals.obRollupBucketRows / CONFIG.days) * 365 * ROW_SIZES.obRollupBucket);
  console.log(`  Uncompressed: ${(yearlyRollupBytes / 1024 ** 3).toFixed(2)} GB`);
  console.log(`  Compressed (~55%): ${(yearlyRollupBytes * 0.45 / 1024 ** 3).toFixed(2)} GB`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  • Use SSD for PostgreSQL data directory (random_page_cost=1.1)');
  console.log('  • Enable TOAST compression (default on) for large text/binary');
  console.log('  • Consider pg_compress for rollup tables (zlib, ~50% savings)');
  console.log('  • Monitor disk with scripts/monitor_disk.sh (alert > 80%)');
  console.log('  • Partition ObSnapshotRollup by month for faster pruning');
  console.log('');
}

simulate();