import fs from 'node:fs';
import path from 'node:path';
import { validateFiveMinutePayload } from './intraday-confirmation.mjs';

const LIVE_SOURCES = new Set(['licensed_vendor', 'broker_market_data']);

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function normalizeBar(bar) {
  return {
    timestamp: new Date(bar.timestamp).toISOString(),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
    complete: bar.complete !== false,
  };
}

export function prepareFiveMinuteImport(payload, { now = new Date(), allowHistorical = false } = {}) {
  const validation = validateFiveMinutePayload(payload);
  const errors = [...validation.errors];
  if (!LIVE_SOURCES.has(payload?.source) && payload?.source !== 'historical_replay') errors.push('import_source_not_allowed');
  if (!allowHistorical && payload?.source === 'historical_replay') errors.push('historical_replay_not_live');

  const bars = Array.isArray(payload?.bars) ? payload.bars.map(normalizeBar) : [];
  const lastTimestamp = bars.at(-1)?.timestamp || null;
  if (lastTimestamp && Date.parse(lastTimestamp) > now.getTime() + 60_000) errors.push('future_bar_rejected');

  const contract = String(payload?.contract || '').trim();
  if (!/^\d{6}$/.test(contract)) errors.push('contract_must_be_yyyymm');
  if (!payload?.provider || String(payload.provider).trim().length < 2) errors.push('provider_required');

  const uniqueErrors = [...new Set(errors)];
  return {
    ok: uniqueErrors.length === 0,
    errors: uniqueErrors,
    payload: uniqueErrors.length ? null : {
      schemaVersion: '1.0.0',
      source: payload.source,
      provider: String(payload.provider).trim(),
      product: 'TX',
      contract,
      session: payload.session,
      timeframe: '5m',
      retrievedAt: now.toISOString(),
      firstTimestamp: bars[0]?.timestamp || null,
      lastTimestamp,
      barCount: bars.length,
      bars,
    },
  };
}

export function importFiveMinuteBars(payload, outputPath, options = {}) {
  const prepared = prepareFiveMinuteImport(payload, options);
  if (!prepared.ok) return prepared;
  atomicWriteJson(outputPath, prepared.payload);
  return { ...prepared, outputPath };
}
