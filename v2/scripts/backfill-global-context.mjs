import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { backfillGlobalContext } from '../src/global-context.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const result = await backfillGlobalContext(db, {
    startDate: process.env.V2_GLOBAL_START || '2023-06-01',
    endDate: process.env.V2_GLOBAL_END || new Date().toISOString().slice(0, 10),
    cacheDir: path.join(config.dataRoot, 'data', 'global-cache'),
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} finally { db.close(); }
