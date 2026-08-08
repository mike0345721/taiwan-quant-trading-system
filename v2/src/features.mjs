function numericOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sumWindow(rows, index, key, size) {
  if (index + 1 < size) return null;
  const values = rows.slice(index + 1 - size, index + 1).map((row) => numericOrNull(row[key]));
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function delta(rows, index, key, lag) {
  if (index < lag) return null;
  const current = numericOrNull(rows[index][key]);
  const previous = numericOrNull(rows[index - lag][key]);
  return current !== null && previous !== null ? current - previous : null;
}

function returnPct(current, previous) {
  const a = numericOrNull(current); const b = numericOrNull(previous);
  return a !== null && b !== null && b !== 0 ? (a / b - 1) * 100 : null;
}

export function rebuildFeatures(db) {
  const rows = db.prepare(`SELECT m.trade_date, m.twii_close, m.tx_close, s.foreign_net_e, f.foreign_net AS futures_foreign_net,
      f.market_open_interest AS market_oi, o.oi_pc_ratio AS active_option_pc_ratio, g.total_score, g.bias
    FROM market_daily m
    LEFT JOIN spot_institutional_daily s USING(trade_date)
    LEFT JOIN futures_positions_daily f USING(trade_date)
    LEFT JOIN options_contract_daily o ON o.trade_date=m.trade_date AND o.is_active=1
    LEFT JOIN signals_daily g USING(trade_date)
    ORDER BY m.trade_date`).all();
  const insert = db.prepare(`INSERT OR REPLACE INTO daily_features VALUES (${Array(16).fill('?').join(',')})`);
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec('DELETE FROM daily_features;');
    rows.forEach((row, index) => {
      insert.run(
        row.trade_date, row.foreign_net_e, sumWindow(rows, index, 'foreign_net_e', 5), sumWindow(rows, index, 'foreign_net_e', 20),
        row.futures_foreign_net, delta(rows, index, 'futures_foreign_net', 1), delta(rows, index, 'futures_foreign_net', 5),
        row.market_oi, delta(rows, index, 'market_oi', 1), row.active_option_pc_ratio,
        index > 0 ? returnPct(row.twii_close, rows[index - 1].twii_close) : null,
        index > 0 ? returnPct(row.tx_close, rows[index - 1].tx_close) : null,
        index + 1 < rows.length ? returnPct(rows[index + 1].tx_close, row.tx_close) : null,
        row.total_score, row.bias, 'v2.1.0',
      );
    });
    db.exec('COMMIT;');
    return { rows: rows.length };
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}
