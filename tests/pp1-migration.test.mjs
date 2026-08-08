import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

function stable(value) { return JSON.stringify(value, Object.keys(value).sort()); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function schema(db) { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(); }
function tableNames(db) { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name); }
function logicalState(db) {
  const tables = tableNames(db);
  return Object.fromEntries(tables.map((name) => {
    const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
    return [name, { rowCount: rows.length, logicalHash: digest(stable(rows)) }];
  }));
}

test('PP-1 migration與反向rollback以Schema、Row Count與Logical Hash驗收', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'pp1-migration-'));
  const file = path.join(folder, 'fixture.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE legacy(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO legacy(value) VALUES (\'保留\');');
    const beforeSchema = schema(db);
    const beforeLogical = logicalState(db);
    const migration = fs.readFileSync(path.resolve('v2/migrations/019_pp1_market_semantics.sql'), 'utf8');
    db.exec(migration);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run('019_pp1_market_semantics.sql', new Date().toISOString());
    assert.ok(tableNames(db).includes('pp1_contract_selection_sets'));
    const rollback = fs.readFileSync(path.resolve('v2/migrations/rollback/019_pp1_market_semantics.rollback.sql'), 'utf8');
    db.exec(rollback);
    assert.deepEqual(schema(db), beforeSchema);
    assert.deepEqual(logicalState(db), beforeLogical);
  } finally {
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
