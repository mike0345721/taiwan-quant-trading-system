import { importMacroObservations } from './macro-environment.mjs';

export const TAIWAN_VIX_SERIES = Object.freeze({
  key: 'TAIWANVIX',
  name: 'TAIEX Options Volatility Index closing one-minute average',
  frequency: 'daily_close',
  units: 'index',
  sourceName: 'TAIFEX',
  sourceUrl: 'https://www.taifex.com.tw/cht/7/vixDaily3MNew',
});

export function decodeTaifexVix(buffer) {
  return new TextDecoder('big5').decode(buffer);
}

export function parseTaifexVixDaily(text) {
  return String(text).split(/\r?\n/).flatMap((line) => {
    const cells = line.trim().split(/\s+/);
    if (!/^\d{8}$/.test(cells[0] || '')) return [];
    const closeOneMinuteAverage = Number(cells.at(-1));
    if (!Number.isFinite(closeOneMinuteAverage)) return [];
    const date = cells[0];
    return [{
      observationDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      value: closeOneMinuteAverage,
    }];
  });
}

export function taifexVixMonthUrls(pageHtml) {
  return [...String(pageHtml).matchAll(/https:\/\/www\.taifex\.com\.tw\/file\/taifex\/Dailydownload\/vix\/log2data\/\d{6}new\.txt/g)]
    .map((match) => match[0]).filter((url, index, urls) => urls.indexOf(url) === index);
}

export function importTaiwanVix(db, text, fetchedAt = new Date().toISOString()) {
  return importMacroObservations(db, TAIWAN_VIX_SERIES, parseTaifexVixDaily(text), text, fetchedAt);
}

export function alignTaiwanVixWithKnownUs(taiwanObservations, usObservations) {
  const taiwan = [...taiwanObservations].sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  const us = [...usObservations].sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  const rows = [];
  let usIndex = -1;
  for (let index = 0; index < taiwan.length; index += 1) {
    const current = taiwan[index];
    while (usIndex + 1 < us.length && us[usIndex + 1].observationDate < current.observationDate) usIndex += 1;
    if (usIndex < 0) continue;
    const priorTaiwan = taiwan[index - 1]; const knownUs = us[usIndex]; const priorUs = us[usIndex - 1];
    rows.push({
      tradeDate: current.observationDate,
      taiwanVix: Number(current.value),
      taiwanChange: priorTaiwan ? Number(current.value) - Number(priorTaiwan.value) : null,
      usVix: Number(knownUs.value),
      usSourceDate: knownUs.observationDate,
      usChange: priorUs ? Number(knownUs.value) - Number(priorUs.value) : null,
    });
  }
  return rows;
}
