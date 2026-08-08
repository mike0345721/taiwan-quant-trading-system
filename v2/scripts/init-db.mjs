import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  const result = applyMigrations(db, config.migrationsPath);
  console.log(`V2 database ready: ${config.databasePath}`);
  console.log(`Migrations applied now: ${result.applied}/${result.total}`);
} finally {
  db.close();
}
