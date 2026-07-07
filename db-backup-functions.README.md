# TradingStats Database Backup Script Documentation

Last updated: 2026-07-08

## Overview
The `db-backup-functions.sh` script provides comprehensive functions for database backup and restore operations for the TradingStats application. It supports multiple export strategies and import methods with deduplication, all designed to work within a Docker environment.

## Key Features
- **Multiple Export Options**:
  - `export_full`: Complete database dump (schema + data)
  - `export_data_only`: Data-only export for deduplication workflows
  - `export_analytics`: Analytics tables export only
  - `create_basic_dump`: DDL + INSERT dump for documentation purposes

- **Different Import Methods**:
  - `import_with_dedup`: Smart import with conflict resolution (ON CONFLICT DO NOTHING)
  - `import_clean`: Full database replacement (TRUNCATE → IMPORT)

- **Robust Error Handling**:
  - Detailed logging to `db-backup-functions.log`
  - English error messages to avoid rendering issues
  - Container readiness checks before operations

- **Intelligent Resource Management**:
  - Temporary database creation for exports
  - Proper cleanup of temporary resources
  - Dedicated encoding handling for consistent SQL output

## Usage Instructions

### Prerequisites
1. Execute `source .env` to load environment variables
2. Ensure PostgreSQL credentials are configured in `.env`
3. Maintain running Docker containers (particularly the `db` service)

### Command Details

#### Export Commands
- **`export_full [output_path]`**
  - Archives full database (execution: `db-backup-functions.sh export_full`)
  - Output: Timestamped SQL file in `tmp/` directory

- **`export_data_only [output_path]`**
  - Exports only data INSERT statements for deduplication workflows
  - Creates temporary database during export process
  - Output: Timestamped SQL file in `tmp/` directory

- **`export_analytics [output_path]`**
  - Exports analytics tables only (`ObSnapshotRollup`, `ObRollupBucket`, etc.)
  - Optimized for space efficiency
  - Output: Timestamped SQL file in `tmp/` directory

- **`create_basic_dump [output_path]`**
  - Combines schema (DDL) and data (INSERT) for comprehensive backup
  - Useful for migration documentation
  - Output: Timestamped SQL file in `tmp/` directory

#### Import Commands
- **`import_with_dedup input_file.sql`**
  - Imports data with conflict resolution
  - Automatically cleans relevant analytics tables
  - Executes with ON CONFLICT DO NOTHING logic
  - Cleanup of temporary resources guaranteed

- **`import_clean input_file.sql`**
  - Complete database replacement workflow
  - Drops existing database and recreates from scratch
  - Ideal for full data migration scenarios

- **`show_help`**
  - Displays comprehensive help reference

### Key Usage Examples
```bash
# Create full backup
./db-backup-functions.sh export_full

# Import data with deduplication
./db-backup-functions.sh import_with_dedup data_dump.sql

# Perform full database migration
./db-backup-functions.sh import_clean full_dump.sql
```

## Technical Notes
- **Environment Management**: The script automatically parses `DATABASE_URL` to extract connection parameters
- **Encoding Safety**: Uses `env LC_ALL=C` to ensure consistent output regardless of system locale
- **Resource Cleanup**: All temporary databases and files are properly cleaned up
- **Conflict Resolution**: Import operations use sophisticated deduplication logic
- **Error Reporting**: Dual logging (to console and log file) in foreground/background formats

## Configuration Files
- `.env`: Contains `DATABASE_URL` and other environment variables
- `db-backup-functions.log`: Automatic log file of all operations
- `tmp/`: Temporary directory for intermediate files

## Troubleshooting
- Check `db-backup-functions.log` for detailed operation records
- Verify database container status: `docker compose ps db`
- Ensure DATABASE_URL is accessible to container via `docker compose exec`
- Watch for common pitfalls:
  - Missing `.env` file
  - Incorrect container name in Docker configuration
  - Insufficient permissions in temporary directories

## Best Practices
- Regular backups using timestamped exports for versioning
- Use `export_data_only` for migration scenarios requiring deduplication
- Perform full database replacements during maintenance windows
- Monitor log files for proactive issue detection