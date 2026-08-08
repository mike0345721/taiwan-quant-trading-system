function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTwseMarginPayload(payload, expectedDate = null) {
  if (payload?.stat !== 'OK') throw new Error(`TWSE margin: ${payload?.stat || 'invalid response'}`);
  if (expectedDate && String(payload.date) !== String(expectedDate).replaceAll('-', '')) throw new Error('TWSE margin: response date mismatch');
  const rows = payload?.tables?.[0]?.data;
  if (!Array.isArray(rows)) throw new Error('TWSE margin: rows missing');
  const marginAmount = rows.find((row) => String(row?.[0] || '').includes('融資金額'));
  const shortBalance = rows.find((row) => String(row?.[0] || '').startsWith('融券'));
  const marginThousand = number(marginAmount?.[5]); const shortLots = number(shortBalance?.[5]);
  if (marginThousand == null || shortLots == null) throw new Error('TWSE margin: required rows missing');
  return {
    tradeDate: `${String(payload.date).slice(0, 4)}-${String(payload.date).slice(4, 6)}-${String(payload.date).slice(6, 8)}`,
    marginBalanceE: marginThousand / 100_000,
    shortBalanceLots: Math.trunc(shortLots),
  };
}
