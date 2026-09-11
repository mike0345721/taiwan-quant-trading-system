import fs from 'node:fs/promises';
import path from 'node:path';

export class CacheStore {
  constructor({ dataDir, historyDir, stateDir = dataDir, stateHistoryDir = path.join(stateDir, 'history'),
    maxHistoryDays = 400 }) {
    this.dataDir = dataDir;
    this.historyDir = historyDir;
    this.stateDir = stateDir;
    this.stateHistoryDir = stateHistoryDir;
    this.sourceLatestPath = path.join(dataDir, 'latest.json');
    this.latestPath = path.join(stateDir, 'latest.json');
    this.maxHistoryDays = maxHistoryDays;
  }

  async init() {
    await fs.mkdir(this.stateHistoryDir, { recursive: true, mode: 0o700 });
  }

  async loadLatest() {
    for (const candidate of [...new Set([this.latestPath, this.sourceLatestPath])]) {
      try {
        const raw = await fs.readFile(candidate, 'utf8');
        return JSON.parse(raw);
      } catch { /* try the next governed source */ }
    }
    return null;
  }

  async save(snapshot) {
    await this.init();
    const serialized = JSON.stringify(snapshot, null, 2);
    await atomicWrite(this.latestPath, serialized);

    const date = String(snapshot.asOfDate || '').replace(/[^0-9-]/g, '');
    if (date) {
      await atomicWrite(path.join(this.stateHistoryDir, `${date}.json`), serialized);
    }
    await this.prune();
  }

  async listHistory(limit = 30) {
    const files = new Map();
    for (const directory of [...new Set([this.stateHistoryDir, this.historyDir])]) {
      try {
        for (const name of await fs.readdir(directory)) {
          if (/^\d{4}-\d{2}-\d{2}\.json$/.test(name) && !files.has(name)) files.set(name, path.join(directory, name));
        }
      } catch { /* an empty optional source is valid */ }
    }
    const results = [];
    const selected = [...files].sort(([left], [right]) => right.localeCompare(left))
      .slice(0, Math.min(limit, this.maxHistoryDays));
    for (const [, filePath] of selected) {
      try { results.push(JSON.parse(await fs.readFile(filePath, 'utf8'))); } catch { /* skip corrupted entry */ }
    }
    return results;
  }

  async prune() {
    const names = (await fs.readdir(this.stateHistoryDir))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
    const remove = names.slice(0, Math.max(0, names.length - this.maxHistoryDays));
    await Promise.all(remove.map((name) => fs.rm(path.join(this.stateHistoryDir, name), { force: true })));
  }
}

async function atomicWrite(target, content) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
}
