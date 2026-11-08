// Full-history counts, including one-sided known deltas. One pass instead of
// independently scanning the largest derived table for every lag/report field.
export function readOptionOiCoverage(db) {
  return db.prepare(`SELECT COUNT(*) AS total,
    COUNT(CASE WHEN call_oi_delta_1d IS NOT NULL OR put_oi_delta_1d IS NOT NULL THEN 1 END) AS delta1d,
    COUNT(CASE WHEN call_oi_delta_3d IS NOT NULL OR put_oi_delta_3d IS NOT NULL THEN 1 END) AS delta3d,
    COUNT(CASE WHEN call_oi_delta_5d IS NOT NULL OR put_oi_delta_5d IS NOT NULL THEN 1 END) AS delta5d,
    COUNT(CASE WHEN call_oi_delta_1d IS NOT NULL AND put_oi_delta_1d IS NOT NULL THEN 1 END) AS sampleRows
    FROM option_oi_changes`).get();
}
