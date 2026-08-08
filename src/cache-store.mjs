import fs from 'node:fs/promises';
import path from 'node:path';

export class CacheStore {
  constructor({ dataDir, historyDir, maxHistoryDays = 400 }) {
    this.dataDir = dataDir;
    this.historyDir = historyDir;
    this.latestPath = path.join(dataDir, 'latest.json');
    this.maxHistoryDays = maxHistoryDays;
  }

  async init() {
    await fs.mkdir(this.historyDir, { recursive: true, mode: 0o700 });
  }

  async loadLatest() {
    try {
      const raw = await fs.readFile(this.latestPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(snapshot) {
    await this.init();
    const serialized = JSON.stringify(snapshot, null, 2);
    await atomicWrite(this.latestPath, serialized);

    const date = String(snapshot.asOfDate || '').replace(/[^0-9-]/g, '');
    if (date) {
      await atomicWrite(path.join(this.historyDir, `${date}.json`), serialized);
    }
    await this.prune();
  }

  async listHistory(limit = 30) {
    try {
      const names = (await fs.readdir(this.historyDir))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort()
        .reverse()
        .slice(0, Math.min(limit, this.maxHistoryDays));
      const results = [];
      for (const name of names) {
        try {
          results.push(JSON.parse(await fs.readFile(path.join(this.historyDir, name), 'utf8')));
        } catch { /* skip corrupted entry */ }
      }
      return results;
    } catch {
      return [];
    }
  }

  async prune() {
    const names = (await fs.readdir(this.historyDir))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort();
    const remove = names.slice(0, Math.max(0, names.length - this.maxHistoryDays));
    await Promise.all(remove.map((name) => fs.rm(path.join(this.historyDir, name), { force: true })));
  }
}

async function atomicWrite(target, content) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, target);
}
