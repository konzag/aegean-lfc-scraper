// scripts/rerank.ts
// Re-rank an EXISTING fares.csv without re-scraping (fetching is residential-IP-only
// and rate-limited, so iterate on filters offline against data you already have).
//
//   npx tsx scripts/rerank.ts data/run-XXXX/fares.csv
//   OUT_DOW=5 IN_DOW=1 MIN_NIGHTS=3 MAX_NIGHTS=3 npx tsx scripts/rerank.ts data/run-XXXX/fares.csv

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { writeCsv } from '../src/csv';
import { pairTrips } from '../src/pairing';
import type { LegFare } from '../src/pairing';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/rerank.ts <path/to/fares.csv>');
  process.exit(1);
}

const envNum = (k: string, d: number) => {
  const v = process.env[k]; return v == null || v === '' ? d : Number(v);
};
const envDow = (k: string, d: string) =>
  new Set((process.env[k] ?? d).split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)));

function splitLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const head = splitLine(lines[0]);
  return lines.slice(1).map(l => {
    const c = splitLine(l);
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = c[i] ?? ''));
    return o;
  });
}

const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();

const rows = parseCsv(readFileSync(file, 'utf8'));
const legs: LegFare[] = rows.map(r => ({
  origin: r.origin, dest: r.dest, destLabel: r.dest_label, country: r.country,
  codeshare: /^true$/i.test(r.codeshare),
  direction: r.leg === 'IN' ? 'IN' : 'OUT',
  date: r.date, dow: dowOf(r.date),
  price: Number(r.price), fullPrice: r.full_price ? Number(r.full_price) : undefined,
  currency: r.currency || '€',
}));

const trips = pairTrips(legs, {
  outDow: envDow('OUT_DOW', '4,5'),
  inDow: envDow('IN_DOW', '1,2'),
  minNights: envNum('MIN_NIGHTS', 3),
  maxNights: envNum('MAX_NIGHTS', 5),
});

const out = join(dirname(file), 'ranked.csv');
writeCsv(out,
  trips.map((t, i) => ({
    rank: i + 1, origin: t.origin, dest: t.dest, dest_label: t.destLabel, country: t.country, codeshare: t.codeshare,
    out_date: t.outDate, out_dow: t.outDow, out_price: t.outPrice,
    in_date: t.inDate, in_dow: t.inDow, in_price: t.inPrice, nights: t.nights, total: t.total, currency: t.currency,
  })),
  ['rank', 'origin', 'dest', 'dest_label', 'country', 'codeshare',
   'out_date', 'out_dow', 'out_price', 'in_date', 'in_dow', 'in_price', 'nights', 'total', 'currency']);

console.log(`Re-ranked ${legs.length} legs -> ${trips.length} trips -> ${out}`);
console.table(trips.slice(0, envNum('TOP_N', 20)).map(t => ({
  origin: t.origin, dest: `${t.dest} ${t.destLabel}`,
  out: `${t.outDow} ${t.outDate}`, in: `${t.inDow} ${t.inDate}`,
  nights: t.nights, total: `${t.total}${t.currency}`,
})));
