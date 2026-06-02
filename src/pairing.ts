// src/pairing.ts
// Day-of-week filtering + long-weekend round-trip pairing + ranking.
// Pure functions, no I/O — easy to unit-test and to re-run offline (see scripts/rerank.ts).

import { DOW_NAMES } from './aegean';

export interface LegFare {
  origin: string;
  dest: string;
  destLabel: string;
  country: string;
  codeshare: boolean;
  direction: 'OUT' | 'IN'; // OUT = origin->dest, IN = dest->origin
  date: string;            // YYYY-MM-DD (UTC)
  dow: number;             // 0..6 (UTC, Sun=0)
  price: number;
  fullPrice?: number;
  currency: string;
}

export interface TripConfig {
  outDow: Set<number>;     // eligible outbound weekdays, e.g. {4,5} Thu/Fri
  inDow: Set<number>;      // eligible inbound weekdays, e.g. {1,2} Mon/Tue
  minNights: number;       // inclusive, e.g. 3
  maxNights: number;       // inclusive, e.g. 5
}

export interface RankedTrip {
  origin: string;
  dest: string;
  destLabel: string;
  country: string;
  codeshare: boolean;
  outDate: string; outDow: string; outPrice: number;
  inDate: string; inDow: string; inPrice: number;
  nights: number;
  total: number;           // out + in (round-trip estimate; see README assumption)
  currency: string;
}

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pair eligible outbound dates (Thu/Fri) with eligible inbound dates (Mon/Tue)
 * on the SAME route, keeping only stays of minNights..maxNights. Cross-month
 * weekends work because all legs for a route are pooled before pairing.
 * Result is sorted by total price ascending.
 */
export function pairTrips(legs: LegFare[], cfg: TripConfig): RankedTrip[] {
  const byRoute = new Map<string, { out: LegFare[]; in: LegFare[] }>();
  for (const l of legs) {
    if (!Number.isFinite(l.price) || l.price <= 0) continue;
    const k = `${l.origin}|${l.dest}`;
    let g = byRoute.get(k);
    if (!g) { g = { out: [], in: [] }; byRoute.set(k, g); }
    (l.direction === 'OUT' ? g.out : g.in).push(l);
  }

  const trips: RankedTrip[] = [];
  for (const g of byRoute.values()) {
    const outs = g.out.filter(o => cfg.outDow.has(o.dow));
    const ins = g.in.filter(i => cfg.inDow.has(i.dow));
    for (const o of outs) {
      const oMs = Date.parse(o.date + 'T00:00:00Z');
      for (const i of ins) {
        const iMs = Date.parse(i.date + 'T00:00:00Z');
        const nights = Math.round((iMs - oMs) / DAY);
        if (nights < cfg.minNights || nights > cfg.maxNights) continue;
        trips.push({
          origin: o.origin, dest: o.dest, destLabel: o.destLabel,
          country: o.country, codeshare: o.codeshare,
          outDate: o.date, outDow: DOW_NAMES[o.dow], outPrice: o.price,
          inDate: i.date, inDow: DOW_NAMES[i.dow], inPrice: i.price,
          nights, total: round2(o.price + i.price), currency: o.currency,
        });
      }
    }
  }

  trips.sort((a, b) =>
    a.total - b.total ||
    a.origin.localeCompare(b.origin) ||
    a.outDate.localeCompare(b.outDate));
  return trips;
}
