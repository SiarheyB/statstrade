-- Additional indexes for performance optimization on partitioned orderflow tables
-- These indexes target timestamp columns used in range queries and ordering.

-- ObTrade (partitioned by day) - timestamp column is `t`
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obtrade_t ON "ObTrade" ("t");
-- Composite index for symbol + exchange + timestamp (already exists as @@index in schema, but ensure partitioned tables have it)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obtrade_symbol_exchange_t ON "ObTrade" (symbol, exchange, "t");

-- ObSnapshot (partitioned by day) - timestamp column is `t`
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obsnapshot_t ON "ObSnapshot" ("t");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obsnapshot_symbol_exchange_t ON "ObSnapshot" (symbol, exchange, "t");

-- ObFootprint (partitioned by day) - timestamp column is `t`
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obfootprint_t ON "ObFootprint" ("t");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obfootprint_symbol_exchange_t ON "ObFootprint" (symbol, exchange, "t");

-- ObBigTrade (partitioned by day) - timestamp column is `t`
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obbigtrade_t ON "ObBigTrade" ("t");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_obbigtrade_symbol_exchange_t ON "ObBigTrade" (symbol, exchange, "t");

-- Fill table - timestamp column is `timestamp`
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fill_timestamp ON "Fill" ("timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fill_account_timestamp ON "Fill" (accountId, "timestamp");

-- Trade table - entryTime and exitTime are used for range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_entry_time ON "Trade" ("entryTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_exit_time ON "Trade" ("exitTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_account_exit_time ON "Trade" (accountId, "exitTime");

-- ImportedTrade table - exitTime for range queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_importedtrade_exit_time ON "ImportedTrade" ("exitTime");
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_importedtrade_account_exit_time ON "ImportedTrade" (accountId, "exitTime");