import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { loadV1Snapshots, importSnapshots } from '../src/history-importer.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const loaded = loadV1Snapshots(config.historyPath, config.latestPath);
  const result = importSnapshots(db, loaded.snapshots, { sourcePath: config.historyPath });
  console.log(`Files inspected: ${loaded.files.length}`);
  console.log(`Unique trading dates imported: ${result.imported}`);
  if (loaded.errors.length) {
    console.log(`Files skipped because of errors: ${loaded.errors.length}`);
    loaded.errors.slice(0, 10).forEach((item) => console.log(`- ${item.file}: ${item.error}`));
  }
} finally {
  db.close();
}
