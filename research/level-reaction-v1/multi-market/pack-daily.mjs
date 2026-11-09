// Pack downloaded daily files into small gzip CSV files (one per market) so they can be transferred. Read-only on the inputs.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const IN = process.argv[2] || 'out', OUT = process.argv[3] || 'packed'; fs.mkdirSync(OUT, { recursive: true });
const r = x => x == null ? '' : +Number(x).toPrecision(8);
for (const f of fs.readdirSync(IN).filter(f => f.endsWith('.json'))) {
  const o = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8'));
  const csv = `#${o.name},${o.symbol},${o.currency}\n` + o.rows.map(x => [x[0], r(x[1]), r(x[2]), r(x[3]), r(x[4]), x[5] ?? '', r(x[6])].join(',')).join('\n');
  const gz = zlib.gzipSync(csv, { level: 9 }); fs.writeFileSync(path.join(OUT, f.replace('.json', '.csv.gz')), gz);
  console.log(f, o.rows.length, 'rows', gz.length, 'bytes');
}
