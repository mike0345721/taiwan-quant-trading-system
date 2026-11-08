import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertPlainLocalPath } from './owner-local-research-root.mjs';

// Execute-only check. Preflight never opens SQLite or bootstraps an empty store.
export function assertExistingDailyDatabase(roots) {
  if (!roots.bound) return;
  const file = path.join(roots.storageV2Root, 'data/research-v2.sqlite');
  assertPlainLocalPath(file, false);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
        || !db.prepare('SELECT 1 FROM market_daily LIMIT 1').get()) throw Error('DAILY_EXISTING_POPULATED_DATABASE_REQUIRED');
  } finally { db.close(); }
}
