import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReplayFrame, calculatePriceConfirmation, loadPriceConfirmation, validateFiveMinutePayload } from '../src/intraday-confirmation.mjs';

function payload(overrides = {}) { const start = Date.parse('2026-07-14T01:00:00.000Z'); return { source: 'licensed_vendor', product: 'TX', session: 'day', timeframe: '5m', bars: Array.from({ length: 6 }, (_, index) => ({ timestamp: new Date(start + index * 300_000).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: index === 5 ? 240 : 100, complete: true })), ...overrides }; }

test('five-minute contract rejects unapproved sources and malformed bars', () => { const result = validateFiveMinutePayload(payload({ source: 'unknown', bars: [{ timestamp: 'bad' }] })); assert.equal(result.ok, false); assert.ok(result.errors.includes('source_not_allowed')); assert.ok(result.errors.includes('bar_0_timestamp_invalid')); });
test('price confirmation requires fresh completed bars and never authorizes execution', () => { const data = payload(); const result = calculatePriceConfirmation(data, new Date(data.bars.at(-1).timestamp)); assert.equal(result.ready, true); assert.equal(result.direction, 'long_confirmed'); assert.equal(result.executionAuthorized, false); assert.ok(result.vwap > 0); });
test('mock and missing intraday data cannot confirm price', () => { const data = payload({ source: 'mock' }); assert.equal(calculatePriceConfirmation(data, new Date(data.bars.at(-1).timestamp)).ready, false); const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-intraday-')); try { assert.equal(loadPriceConfirmation(path.join(folder, 'missing.json')).state, 'not_connected'); } finally { fs.rmSync(folder, { recursive: true, force: true }); } });
test('historical replay reveals bars only up to the requested cursor and never authorizes execution', () => { const result = buildReplayFrame(payload(), 6); assert.equal(result.source, 'historical_replay'); assert.equal(result.cursor, 6); assert.equal(result.totalBars, 6); assert.equal(result.ready, true); assert.equal(result.researchOnly, true); assert.equal(result.executionAuthorized, false); });
test('early replay still reports descriptive price and VWAP without authorizing confirmation', () => { const result = buildReplayFrame(payload(), 1); assert.equal(result.cursor, 1); assert.equal(result.ready, false); assert.equal(result.state, 'insufficient_bars'); assert.equal(result.lastClose, 101); assert.ok(result.vwap > 0); assert.equal(result.openingRangeHigh, 102); assert.equal(result.executionAuthorized, false); });
