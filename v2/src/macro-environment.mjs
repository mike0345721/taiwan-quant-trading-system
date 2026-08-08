import crypto from 'node:crypto';

export const FRED_MACRO_SERIES = Object.freeze([
  {
    key: 'VIXCLS',
    name: 'CBOE Volatility Index: VIX',
    frequency: 'daily_close',
    units: 'index',
    sourceName: 'FRED / CBOE',
    sourceUrl: 'https://fred.stlouisfed.org/series/VIXCLS',
  },
  {
    key: 'DGS10',
    name: 'U.S. Treasury 10-Year Constant Maturity Rate',
    frequency: 'daily',
    units: 'percent',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DGS10',
  },
  {
    key: 'DGS2',
    name: 'U.S. Treasury 2-Year Constant Maturity Rate',
    frequency: 'daily',
    units: 'percent',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DGS2',
  },
  {
    key: 'DFII10',
    name: 'U.S. 10-Year Real Interest Rate',
    frequency: 'daily',
    units: 'percent',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DFII10',
  },
  {
    key: 'DFF',
    name: 'Effective Federal Funds Rate',
    frequency: 'daily',
    units: 'percent',
    sourceName: 'FRED / Federal Reserve Bank of New York',
    sourceUrl: 'https://fred.stlouisfed.org/series/DFF',
  },
  {
    key: 'DTWEXBGS',
    name: 'Trade Weighted U.S. Dollar Index: Broad',
    frequency: 'daily',
    units: 'index',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DTWEXBGS',
  },
  {
    key: 'DEXJPUS',
    name: 'Japanese Yen to One U.S. Dollar',
    frequency: 'daily',
    units: 'yen_per_us_dollar',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DEXJPUS',
  },
  {
    key: 'BAMLH0A0HYM2',
    name: 'ICE BofA U.S. High Yield Option-Adjusted Spread',
    frequency: 'daily',
    units: 'percent',
    sourceName: 'FRED / ICE Data Indices',
    sourceUrl: 'https://fred.stlouisfed.org/series/BAMLH0A0HYM2',
  },
  {
    key: 'DEXCHUS',
    name: 'Chinese Yuan Renminbi to One U.S. Dollar',
    frequency: 'daily',
    units: 'yuan_per_us_dollar',
    sourceName: 'FRED / Federal Reserve Board',
    sourceUrl: 'https://fred.stlouisfed.org/series/DEXCHUS',
  },
  {
    key: 'DCOILWTICO',
    name: 'Crude Oil Prices: West Texas Intermediate',
    frequency: 'daily',
    units: 'dollars_per_barrel',
    sourceName: 'FRED / U.S. Energy Information Administration',
    sourceUrl: 'https://fred.stlouisfed.org/series/DCOILWTICO',
  },
  {
    key: 'PCOPPUSDM',
    name: 'Global Price of Copper',
    frequency: 'monthly',
    units: 'u_s_dollars_per_metric_ton',
    sourceName: 'FRED / International Monetary Fund',
    sourceUrl: 'https://fred.stlouisfed.org/series/PCOPPUSDM',
  },
]);

export const MACRO_AVAILABILITY_RULE = 'strict_prior_observation_date_before_taiwan_session';

function csvCells(line) {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"'; index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(value); value = ''; }
    else value += character;
  }
  cells.push(value);
  return cells;
}

export function parseFredCsv(text, seriesKey) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error(`Empty FRED payload for ${seriesKey}`);
  const headers = csvCells(lines[0]).map((value) => value.trim());
  const dateIndex = headers.findIndex((value) => ['DATE', 'observation_date'].includes(value));
  const valueIndex = headers.indexOf(seriesKey);
  if (dateIndex < 0 || valueIndex < 0) throw new Error(`Unexpected FRED columns for ${seriesKey}: ${headers.join(',')}`);
  return lines.slice(1).map(csvCells).flatMap((cells) => {
    const observationDate = cells[dateIndex]?.trim();
    const rawValue = cells[valueIndex]?.trim();
    const value = Number(rawValue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate) || rawValue === '.' || !Number.isFinite(value)) return [];
    return [{ observationDate, value }];
  });
}

export function latestStrictlyBefore(observations, taiwanTradeDate) {
  return observations
    .filter((row) => row.observationDate < taiwanTradeDate)
    .sort((left, right) => right.observationDate.localeCompare(left.observationDate))[0] ?? null;
}

export function importMacroSeries(db, definition, csvText, fetchedAt = new Date().toISOString()) {
  const observations = parseFredCsv(csvText, definition.key);
  return importMacroObservations(db, definition, observations, csvText, fetchedAt);
}

export function importMacroObservations(db, definition, observations, sourcePayload, fetchedAt = new Date().toISOString()) {
  if (!observations.length) throw new Error(`No valid observations for ${definition.key}`);
  const ordered = [...observations].sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  db.prepare(`INSERT INTO macro_series(
      series_key, display_name, frequency, units, source_name, source_url, availability_rule, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(series_key) DO UPDATE SET display_name=excluded.display_name, frequency=excluded.frequency,
      units=excluded.units, source_name=excluded.source_name, source_url=excluded.source_url,
      availability_rule=excluded.availability_rule`).run(
    definition.key, definition.name, definition.frequency, definition.units,
    definition.sourceName, definition.sourceUrl, MACRO_AVAILABILITY_RULE, fetchedAt,
  );
  const payloadSha256 = crypto.createHash('sha256').update(sourcePayload).digest('hex');
  const run = db.prepare(`INSERT INTO macro_import_runs(
      series_key, fetched_at, first_observation_date, last_observation_date, row_count, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`).get(
    definition.key, fetchedAt, ordered[0].observationDate,
    ordered.at(-1).observationDate, ordered.length, payloadSha256,
  );
  const upsert = db.prepare(`INSERT INTO macro_observations(series_key, observation_date, value, source_run_id)
    VALUES (?, ?, ?, ?) ON CONFLICT(series_key, observation_date)
    DO UPDATE SET value=excluded.value, source_run_id=excluded.source_run_id`);
  for (const row of ordered) upsert.run(definition.key, row.observationDate, row.value, run.id);
  return { runId: run.id, observations: ordered.length, first: ordered[0].observationDate, last: ordered.at(-1).observationDate, payloadSha256 };
}
