import fs from 'node:fs';
import path from 'node:path';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function same(left, right) {
  return finite(left) && finite(right) && Math.abs(Number(left) - Number(right)) < 1e-9;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

export function auditPaidTaifexReplay({ tradeDate, result, officialRows = [] }) {
  const day = result?.sessions?.day || null;
  const night = result?.sessions?.night || null;
  const official = officialRows.find((row) => row.contract === day?.contract)
    || officialRows.find((row) => row.is_active === 1)
    || officialRows[0]
    || null;
  const dayBars = day?.bars || [];
  const nightBars = night?.bars || [];
  const calculated = dayBars.length ? {
    open: Number(dayBars[0].open),
    high: Math.max(...dayBars.map((bar) => Number(bar.high))),
    low: Math.min(...dayBars.map((bar) => Number(bar.low))),
    close: Number(dayBars.at(-1).close),
    volume: dayBars.reduce((sum, bar) => sum + Number(bar.volume), 0),
  } : null;
  const checks = {
    parserIntegrity: {
      pass: Number(result?.acceptedTicks || 0) > 0 && Number(result?.malformedTicks || 0) === 0,
      acceptedTicks: Number(result?.acceptedTicks || 0),
      malformedTicks: Number(result?.malformedTicks || 0),
    },
    daySessionCoverage: {
      pass: dayBars.length === 60
        && dayBars[0]?.timestamp?.slice(11, 16) === '00:45'
        && dayBars.at(-1)?.timestamp?.slice(11, 16) === '05:40',
      bars: dayBars.length,
      firstTimestamp: dayBars[0]?.timestamp || null,
      lastTimestamp: dayBars.at(-1)?.timestamp || null,
    },
    nightSessionCoverage: {
      pass: nightBars.length >= 160
        && nightBars[0]?.timestamp?.slice(11, 16) === '07:00'
        && nightBars.at(-1)?.timestamp?.slice(11, 16) === '20:55',
      bars: nightBars.length,
      firstTimestamp: nightBars[0]?.timestamp || null,
      lastTimestamp: nightBars.at(-1)?.timestamp || null,
    },
    contractConsistency: {
      pass: Boolean(day?.contract && night?.contract && day.contract === night.contract),
      dayContract: day?.contract || null,
      nightContract: night?.contract || null,
    },
    officialContract: {
      pass: Boolean(official && official.contract === day?.contract),
      replay: day?.contract || null,
      official: official?.contract || null,
    },
  };
  for (const key of ['open', 'high', 'low', 'close']) {
    checks[key] = {
      pass: Boolean(calculated && official && same(calculated[key], official[key])),
      replay: calculated?.[key] ?? null,
      official: finite(official?.[key]) ? Number(official[key]) : null,
    };
  }
  checks.volumeContainment = {
    pass: Boolean(calculated && official && calculated.volume > 0
      && finite(official.volume) && calculated.volume <= Number(official.volume)),
    replayOutrightDaySession: calculated?.volume ?? null,
    officialAllScopes: finite(official?.volume) ? Number(official.volume) : null,
    exactComparable: false,
  };
  const pass = Object.values(checks).every((check) => check.pass === true);
  return {
    tradeDate,
    pass,
    state: pass ? 'passed_with_volume_scope_warning' : 'failed',
    contract: result?.selectedContract || null,
    selectedContract: result?.selectedContract || null,
    checks,
    excludedSpreadRows: Number(result?.excludedSpreadRows || 0),
    excludedNonOutrightRows: Number(result?.excludedNonOutrightRows || 0),
    researchOnly: true,
    executionAuthorized: false,
  };
}

export function writePaidCandidateArchives(candidateDir, tradeDate, result) {
  const files = [];
  for (const [session, payload] of Object.entries(result.sessions || {})) {
    const output = path.join(candidateDir, `${tradeDate}-${session}.json`);
    atomicWrite(output, payload);
    files.push(output);
  }
  return files;
}

export function promotePaidCandidateArchives(candidateDir, archiveDir, acceptedDates) {
  const promoted = [];
  const identicalExisting = [];
  for (const tradeDate of acceptedDates) {
    for (const session of ['day', 'night']) {
      const source = path.join(candidateDir, `${tradeDate}-${session}.json`);
      if (!fs.existsSync(source)) throw new Error(`PAID_CANDIDATE_MISSING:${tradeDate}:${session}`);
      const target = path.join(archiveDir, `${tradeDate}-${session}.json`);
      if (fs.existsSync(target)) {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
        const candidate = JSON.parse(fs.readFileSync(source, 'utf8'));
        const comparableExisting = {
          contract: existing.contract, session: existing.session, bars: existing.bars,
        };
        const comparableCandidate = {
          contract: candidate.contract, session: candidate.session, bars: candidate.bars,
        };
        if (JSON.stringify(comparableExisting) !== JSON.stringify(comparableCandidate)) {
          throw new Error(`PAID_CANDIDATE_CONFLICT:${tradeDate}:${session}`);
        }
        identicalExisting.push(target);
        continue;
      }
      atomicWrite(target, JSON.parse(fs.readFileSync(source, 'utf8')));
      promoted.push(target);
    }
  }
  return { promoted, identicalExisting };
}
