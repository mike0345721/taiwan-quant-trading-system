import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dailyStorageRoots, assertDailyArguments } from '../../src/daily-storage-binding.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveFromRoot(value, fallback) {
  return path.resolve(root, value || fallback);
}

export function v2Config(env = process.env) {
  assertDailyArguments(path.basename(process.argv[1] || '') === 'backfill-taifex.mjs' ? ['--defer-derived-to-daily-stages'] : [], process.argv.slice(2), env);
  const roots = dailyStorageRoots(path.dirname(root), env);
  const dataRoot = roots.storageV2Root;
  return {
    root, // code/spec root; never redirect frozen specifications to storage
    dataRoot,
    databasePath: roots.bound ? path.join(dataRoot, 'data/research-v2.sqlite') : resolveFromRoot(env.V2_DATABASE_PATH, './data/research-v2.sqlite'),
    historyPath: roots.bound ? path.join(roots.storageAppRoot, 'data/history') : resolveFromRoot(env.V1_HISTORY_PATH, '../data/history'),
    latestPath: roots.bound ? path.join(roots.storageAppRoot, 'data/latest.json') : resolveFromRoot(env.V1_LATEST_PATH, '../data/latest.json'),
    migrationsPath: path.join(root, 'migrations'),
    reportsPath: path.join(dataRoot, 'reports'),
  };
}
