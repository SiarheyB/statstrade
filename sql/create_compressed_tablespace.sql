-- Compressed tablespace for large historical tables
-- NOTE: The directory must point to a filesystem with compression enabled (e.g., btrfs with compress=zfs, zfs, or lvm with dm-cache).
-- Example mount options for btrfs: defaults,compress=zlib
-- For XFS: does not support native compression; use LUKS? Actually XFS doesn't support compression.
-- Recommended: Use BTRFS or ZFS on the host and mount the directory accordingly.

-- Adjust the path as needed for your deployment.
-- In docker-compose, you can mount a host directory:
--   volumes:
--     - /mnt/ssd/pg_tablespace_zlib:/var/lib/postgresql/tablespace_zlib

CREATE TABLESPACE ts_zlib LOCATION '/var/lib/postgresql/tablespace_zlib';

-- Move large historical tables to the compressed tablespace
-- Note: Moving existing tables requires locking; better to set default for new partitions.
-- For existing tables, you can ALTER TABLE ... SET TABLESPACE ts_zlib; during low traffic.

-- Example for partitioned tables (if you want to move existing partitions):
-- ALTER TABLE "ObSnapshot" SET TABLESPACE ts_zlib;
-- However, for partitioned tables, you need to alter each partition or set default.

-- Set default tablespace for future partitions of large tables
ALTER TABLE "ObSnapshot" SET TABLESPACE ts_zlib;
ALTER TABLE "ObFootprint" SET TABLESPACE ts_zlib;

-- Optional: Also move index to same tablespace for better compression
ALTER INDEX "ObSnapshot_symbol_exchange_t_index" SET TABLESPACE ts_zlib;
ALTER INDEX "ObFootprint_symbol_exchange_t_index" SET TABLESPACE ts_zlib;

-- For completeness, you may also move less critical but large tables:
ALTER TABLE "ObTrade" SET TABLESPACE ts_zlib;
ALTER INDEX "ObTrade_symbol_exchange_t_index" SET TABLESPACE ts_zlib;