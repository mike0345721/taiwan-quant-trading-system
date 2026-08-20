import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';

export const LIVE_COVERAGE_PRODUCTS = Object.freeze(['IX0001', '2330']);
export const DEFAULT_MAX_BYTES_PER_LIVE_FILE = 64 * 1024 * 1024;
export const DEFAULT_LIVE_FILE_WINDOWS = 8;

export async function scanLiveCoverageFile(filePath, { maxBytes = DEFAULT_MAX_BYTES_PER_LIVE_FILE, windows = DEFAULT_LIVE_FILE_WINDOWS } = {}) {
  const stat = fs.statSync(filePath);
  const products = new Set();
  const started = performance.now();
  let parsedRows = 0;
  let malformedRows = 0;
  let earlyExit = false;
  let bytesScanned = 0;
  const windowCount = stat.size <= maxBytes ? 1 : Math.max(1, windows);
  const windowBytes = stat.size <= maxBytes ? stat.size : Math.floor(maxBytes / windowCount);
  const offsets = windowCount === 1
    ? [0]
    : Array.from({ length: windowCount }, (_, index) => Math.floor(index * (stat.size - windowBytes) / (windowCount - 1)));
  let windowsScanned = 0;
  for (const offset of offsets) {
    if (windowBytes <= 0) break;
    const input = fs.createReadStream(filePath, { encoding: 'utf8', start: offset, end: Math.min(stat.size - 1, offset + windowBytes - 1) });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let firstLine = true;
    for await (const line of lines) {
      if (firstLine && offset > 0) { firstLine = false; continue; }
      firstLine = false;
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        parsedRows += 1;
        if ((event.kind === 'index_quote' && event.code === 'IX0001')
          || (event.kind === 'stock_tick' && event.code === '2330')) products.add(event.code);
        if (LIVE_COVERAGE_PRODUCTS.every((product) => products.has(product))) {
          earlyExit = true;
          break;
        }
      } catch {
        malformedRows += 1;
      }
    }
    bytesScanned += input.bytesRead;
    windowsScanned += 1;
    input.destroy();
    if (earlyExit) break;
  }
  const fullyScanned = stat.size <= maxBytes && !earlyExit;
  const provenComplete = LIVE_COVERAGE_PRODUCTS.every((product) => products.has(product));
  return {
    products: [...products].sort(),
    fileBytes: stat.size,
    bytesScanned,
    parsedRows,
    malformedRows,
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
    windowsScanned,
    configuredWindows: windowCount,
    earlyExit,
    fullyScanned,
    provenComplete,
    boundedIncomplete: !provenComplete && !fullyScanned,
  };
}

export async function readBoundedLiveCoverage({ liveEventsDir, expectedDates, maxBytesPerFile = DEFAULT_MAX_BYTES_PER_LIVE_FILE }) {
  const started = performance.now();
  const expected = new Set(expectedDates);
  const coverage = {};
  const unresolvedDates = [];
  const files = fs.existsSync(liveEventsDir)
    ? fs.readdirSync(liveEventsDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name) && expected.has(name.slice(0, 10)))
      .sort()
    : [];
  const fileTelemetry = [];
  for (const name of files) {
    const date = name.slice(0, 10);
    const result = await scanLiveCoverageFile(path.join(liveEventsDir, name), { maxBytes: maxBytesPerFile });
    if (result.products.length > 0) coverage[date] = result.products;
    if (result.boundedIncomplete) unresolvedDates.push(date);
    fileTelemetry.push({ date, file: name, ...result });
  }
  const largestOffender = [...fileTelemetry].sort((a, b) => b.fileBytes - a.fileBytes)[0] ?? null;
  return {
    coverage,
    unresolvedDates,
    telemetry: {
      policy: 'COMPLETED_TRADING_DATES_ONLY_EARLY_EXIT_OR_FAIL_CLOSED_BOUND',
      maxBytesPerFile,
      filesDiscovered: files.length,
      filesScanned: fileTelemetry.length,
      totalFileBytes: fileTelemetry.reduce((sum, row) => sum + row.fileBytes, 0),
      bytesScanned: fileTelemetry.reduce((sum, row) => sum + row.bytesScanned, 0),
      rowsScanned: fileTelemetry.reduce((sum, row) => sum + row.parsedRows, 0),
      earlyExitFiles: fileTelemetry.filter((row) => row.earlyExit).length,
      fullyScannedFiles: fileTelemetry.filter((row) => row.fullyScanned).length,
      boundedIncompleteFiles: fileTelemetry.filter((row) => row.boundedIncomplete).length,
      elapsedMs: Math.round((performance.now() - started) * 10) / 10,
      largestOffender: largestOffender ? {
        date: largestOffender.date,
        fileBytes: largestOffender.fileBytes,
        bytesScanned: largestOffender.bytesScanned,
        elapsedMs: largestOffender.elapsedMs,
      } : null,
    },
  };
}
