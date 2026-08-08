import crypto from 'node:crypto';

export const FUNDAMENTAL_SERIES = Object.freeze([
  { key: 'TW_EXPORT_YOY', name: '台灣出口年增率', frequency: 'monthly', units: 'percent', sourceName: '財政部統計處', sourceUrl: 'https://www.mof.gov.tw/htmlList/103', releaseRule: '官方發布日下午4時後可用' },
  { key: 'TW_EXPORT_ICT_YOY', name: '資通與視聽產品出口年增率', frequency: 'monthly', units: 'percent', sourceName: '財政部統計處', sourceUrl: 'https://www.mof.gov.tw/htmlList/103', releaseRule: '官方發布日下午4時後可用' },
  { key: 'TW_EXPORT_ELEC_YOY', name: '電子零組件出口年增率', frequency: 'monthly', units: 'percent', sourceName: '財政部統計處', sourceUrl: 'https://www.mof.gov.tw/htmlList/103', releaseRule: '官方發布日下午4時後可用' },
  { key: 'TW_EXPORT_ORDERS_YOY', name: '外銷訂單年增率', frequency: 'monthly', units: 'percent', sourceName: '經濟部統計處', sourceUrl: 'https://www.moea.gov.tw/MNS/populace/content/ContentMenu.aspx?menu_id=32830', releaseRule: '官方實際發布日後可用' },
  { key: 'TW_INDUSTRIAL_PRODUCTION_YOY', name: '工業生產指數年增率', frequency: 'monthly', units: 'percent', sourceName: '經濟部統計處', sourceUrl: 'https://www.moea.gov.tw/Mns/dos/content/ContentMenu.aspx?menu_id=9431', releaseRule: '官方實際發布日後可用' },
  { key: 'TW_SEMICON_PRODUCTION_YOY', name: '半導體業生產指數年增率', frequency: 'monthly', units: 'percent', sourceName: '經濟部統計處', sourceUrl: 'https://www.moea.gov.tw/Mns/dos/content/ContentMenu.aspx?menu_id=9431', releaseRule: '官方實際發布日後可用' },
  { key: 'TSMC_REVENUE_YOY', name: '台積電月營收年增率', frequency: 'monthly', units: 'percent', sourceName: '台積電投資人關係', sourceUrl: 'https://investor.tsmc.com/english/monthly-revenue', releaseRule: '公司實際公告日後可用' },
  { key: 'TW_LEADING_INDEX', name: '台灣景氣領先指標', frequency: 'monthly', units: 'index', sourceName: '國家發展委員會', sourceUrl: 'https://index.ndc.gov.tw/', releaseRule: '官方實際發布日後可用' },
  { key: 'TW_FX_RESERVES', name: '台灣外匯存底', frequency: 'monthly', units: 'million_usd', sourceName: '中央銀行', sourceUrl: 'https://www.cbc.gov.tw/', releaseRule: '央行實際發布時間後可用' },
]);

export function importFundamentalReleases(db, definition, rows, sourcePayload = '', importedAt = new Date().toISOString()) {
  if (!rows.length) return { series: definition.key, rows: 0 };
  db.prepare(`INSERT INTO fundamental_series(series_key, display_name, frequency, units, source_name, source_url, release_rule, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(series_key) DO UPDATE SET display_name=excluded.display_name,
    frequency=excluded.frequency, units=excluded.units, source_name=excluded.source_name,
    source_url=excluded.source_url, release_rule=excluded.release_rule`).run(
    definition.key, definition.name, definition.frequency, definition.units,
    definition.sourceName, definition.sourceUrl, definition.releaseRule, importedAt,
  );
  const sha = crypto.createHash('sha256').update(String(sourcePayload)).digest('hex');
  const upsert = db.prepare(`INSERT INTO fundamental_releases(
      series_key, reference_period, release_date, release_time, value, yoy_pct,
      revision_vintage, source_payload_sha256, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(series_key, reference_period, revision_vintage) DO UPDATE SET
      release_date=excluded.release_date, release_time=excluded.release_time,
      value=excluded.value, yoy_pct=excluded.yoy_pct,
      source_payload_sha256=excluded.source_payload_sha256, imported_at=excluded.imported_at`);
  for (const row of rows) {
    if (!/^\d{4}-\d{2}$/.test(row.referencePeriod) || !/^\d{4}-\d{2}-\d{2}$/.test(row.releaseDate) || !Number.isFinite(Number(row.value))) {
      throw new Error(`Invalid ${definition.key} release row: ${JSON.stringify(row)}`);
    }
    upsert.run(definition.key, row.referencePeriod, row.releaseDate, row.releaseTime ?? null,
      Number(row.value), Number.isFinite(Number(row.yoyPct)) ? Number(row.yoyPct) : null,
      row.revisionVintage || 'initial', sha, importedAt);
  }
  return { series: definition.key, rows: rows.length, payloadSha256: sha };
}

export function latestFundamentalBefore(rows, tradeDate, marketOpenTime = '08:45') {
  return rows.filter((row) => row.release_date < tradeDate
    || (row.release_date === tradeDate && String(row.release_time || '23:59') < marketOpenTime))
    .sort((a, b) => `${b.release_date} ${b.release_time || ''}`.localeCompare(`${a.release_date} ${a.release_time || ''}`))[0] ?? null;
}
