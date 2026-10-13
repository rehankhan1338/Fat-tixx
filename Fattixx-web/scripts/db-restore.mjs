#!/usr/bin/env node
// Restore a backup made by db-backup.mjs. See that file for usage:
//   npm run db:restore -- backups/fattixx-YYYYMMDD-HHMMSS.sql.gz [--into fattixx_restored] [--force]
await import('./db-backup.mjs');
