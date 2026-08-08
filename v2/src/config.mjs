import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveFromRoot(value, fallback) {
  return path.resolve(root, value || fallback);
}

export function v2Config(env = process.env) {
  return {
    root,
    databasePath: resolveFromRoot(env.V2_DATABASE_PATH, './data/research-v2.sqlite'),
    historyPath: resolveFromRoot(env.V1_HISTORY_PATH, '../data/history'),
    latestPath: resolveFromRoot(env.V1_LATEST_PATH, '../data/latest.json'),
    migrationsPath: path.join(root, 'migrations'),
    reportsPath: path.join(root, 'reports'),
  };
}
