function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localParts(timestamp) {
  const match = String(timestamp).match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[+-]\d{2}:\d{2}|Z)$/,
  );
  if (!match) throw new Error(`invalid_candidate_timestamp:${timestamp}`);
  return { date: match[1], hour: Number(match[2]), minute: Number(match[3]), second: Number(match[4]) };
}

export function candidateFiveMinuteTimestamp(timestamp) {
  const parts = localParts(timestamp);
  const rightEdge = parts.hour * 60 + parts.minute;
  const leftMinute = rightEdge - 1;
  const bucket = Math.floor(leftMinute / 5) * 5;
  const hour = Math.floor(bucket / 60);
  const minute = bucket % 60;
  return new Date(
    `${parts.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`,
  ).toISOString();
}

export function aggregateCandidateMinutes(rows = []) {
  const bars = new Map();
  const seen = new Set();
  let duplicateRows = 0;
  let invalidRows = 0;
  for (const row of rows) {
    const identity = `${row.tradeDate}|${row.timestamp}`;
    if (seen.has(identity)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(identity);
    const values = [row.open, row.high, row.low, row.close, row.volume].map(number);
    if (values.some((value) => value == null) || values[4] < 0) {
      invalidRows += 1;
      continue;
    }
    const timestamp = candidateFiveMinuteTimestamp(row.timestamp);
    const [open, high, low, close, volume] = values;
    const existing = bars.get(timestamp);
    if (!existing) {
      bars.set(timestamp, { timestamp, open, high, low, close, volume, minuteCount: 1 });
    } else {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.close = close;
      existing.volume += volume;
      existing.minuteCount += 1;
    }
  }
  return {
    bars: [...bars.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    duplicateRows,
    invalidRows,
  };
}

export function compareCandidateDay(candidateRows, officialPayload) {
  const aggregated = aggregateCandidateMinutes(candidateRows);
  const official = new Map((officialPayload?.bars || []).map((bar) => [bar.timestamp, bar]));
  const candidate = new Map(aggregated.bars.map((bar) => [bar.timestamp, bar]));
  const timestamps = [...new Set([...official.keys(), ...candidate.keys()])].sort();
  const comparisons = timestamps.map((timestamp) => {
    const left = candidate.get(timestamp);
    const right = official.get(timestamp);
    const present = Boolean(left && right);
    const fieldExact = Object.fromEntries(
      ['open', 'high', 'low', 'close', 'volume'].map((field) => [
        field,
        present ? number(left[field]) === number(right[field]) : false,
      ]),
    );
    return {
      timestamp,
      present,
      fieldExact,
      absoluteError: present
        ? Object.fromEntries(
          ['open', 'high', 'low', 'close', 'volume'].map((field) => [
            field,
            Math.abs(number(left[field]) - number(right[field])),
          ]),
        )
        : null,
    };
  });
  const matched = comparisons.filter((item) => item.present);
  const exactCounts = Object.fromEntries(
    ['open', 'high', 'low', 'close', 'volume'].map((field) => [
      field,
      matched.filter((item) => item.fieldExact[field]).length,
    ]),
  );
  return {
    tradeDate: officialPayload?.tradeDate || null,
    officialContract: officialPayload?.contract || null,
    officialBars: official.size,
    candidateBars: candidate.size,
    matchedBars: matched.length,
    missingOfficialBars: [...official.keys()].filter((timestamp) => !candidate.has(timestamp)),
    extraCandidateBars: [...candidate.keys()].filter((timestamp) => !official.has(timestamp)),
    duplicateRows: aggregated.duplicateRows,
    invalidRows: aggregated.invalidRows,
    exactCounts,
    comparisons,
  };
}

export function evaluateOverlapAdmission(days, { expectedDays = 29, expectedBarsPerDay = 60 } = {}) {
  const totals = days.reduce(
    (value, day) => {
      value.officialBars += day.officialBars;
      value.candidateBars += day.candidateBars;
      value.matchedBars += day.matchedBars;
      value.duplicateRows += day.duplicateRows;
      value.invalidRows += day.invalidRows;
      for (const field of Object.keys(value.exactCounts)) value.exactCounts[field] += day.exactCounts[field];
      return value;
    },
    {
      officialBars: 0,
      candidateBars: 0,
      matchedBars: 0,
      duplicateRows: 0,
      invalidRows: 0,
      exactCounts: { open: 0, high: 0, low: 0, close: 0, volume: 0 },
    },
  );
  const expectedBars = expectedDays * expectedBarsPerDay;
  const gates = {
    allTargetDatesPresent: days.length === expectedDays,
    fullSessionCoverage: days.every(
      (day) =>
        day.officialBars === expectedBarsPerDay
        && day.candidateBars === expectedBarsPerDay
        && day.matchedBars === expectedBarsPerDay,
    ),
    noDuplicateRows: totals.duplicateRows === 0,
    noInvalidRows: totals.invalidRows === 0,
    exactOhlc: ['open', 'high', 'low', 'close'].every(
      (field) => totals.exactCounts[field] === expectedBars,
    ),
    exactVolume: totals.exactCounts.volume === expectedBars,
    explicitContractIdentity: false,
  };
  const priceEligible = Object.entries(gates)
    .filter(([name]) => name !== 'exactVolume' && name !== 'explicitContractIdentity')
    .every(([, passed]) => passed);
  const formalAdmissionEligible = Object.values(gates).every(Boolean);
  return {
    policy: {
      priceFields: '100% exact OHLC across every overlapping five-minute bar',
      volume: '100% exact or a separately proven equivalent volume definition',
      contract: 'explicit monthly-contract identity required; TXFR1 alone is insufficient',
    },
    totals,
    gates,
    priceEligible,
    formalAdmissionEligible,
    decision: formalAdmissionEligible
      ? 'eligible_for_controlled_formal_import'
      : 'candidate_only_not_eligible_for_formal_import',
  };
}
