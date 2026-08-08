import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { rebuildFeatures } from '../src/features.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const result = rebuildFeatures(db);
  console.log(`Daily feature rows rebuilt: ${result.rows}`);
} finally {
  db.close();
}
