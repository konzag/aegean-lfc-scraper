import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  BASE, airportsSearchUrl, routeLowFaresUrl, parseDotNetDate, ymd, DOW_NAMES, nextMonths,
} from '../src/aegean';
import type { AirportItem, RouteLowFares } from '../src/aegean';
import { isBeach } from '../src/beaches';
import { writeCsv } from '../src/csv';
import { pairTrips } from '../src/pairing';
import type { LegFare, RankedTrip } from '../src/pairing';

// ---------------- config (override via env) ----------------
const env = (k: string, d: string) => process.env[k] ?? d;
const envNum = (k: string, d: number) => {
  const v = process.env[k]; return v == null || v === '' ? d : Number(v);
};
const envBool = (k: string, d: boolean) => {
  const v = process.env[k]; return v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v);
};
const envDow = (k: string, d: string) =>
  new Set(env(k, d).split(',').map(s => Number(s.trim())).filter(n => !Number.isNaN(n)));

const ORIGINS   = env('ORIGINS', 'ATH,SKG,PVK').split(',').map(s => s.trim()).filter(Boolean);
// Default: the current month + the next MONTHS_AHEAD-1 months (never past months).
const MONTHS    = (process.env.MONTHS
  ? process.env.MONTHS.split(',').map(s => s.trim()).filter(Boolean)
  : nextMonths(envNum('MONTHS_AHEAD', 4)));
const TRIP      = env('TRIP', 'RT');
const DELAY_MS  = envNum('DELAY_MS', 1100);
const FETCH_TIMEOUT_MS  = envNum('FETCH_TIMEOUT_MS', 30_000);
const MAX_RETRIES       = envNum('MAX_RETRIES', 3);        // per call, on 403/429/5xx/timeout
const BACKOFF_BASE_MS   = envNum('BACKOFF_BASE_MS', 4000); // 4s, 8s, 16s (+ jitter)
const MAX_BLOCKED_RATIO = envNum('MAX_BLOCKED_RATIO', 0.2);  // fail the run above this
const MAX_DEST  = process.env.MAX_DEST ? Number(process.env.MAX_DEST) : Infinity;
const LIST_ONLY = envBool('LIST_ONLY', false);
const DUMP_RAW  = envBool('DUMP_RAW', false);

const REGION            = env('REGION', 'eu');           // req 2: Europe excl. Greece
const BEACH_ONLY        = envBool('BEACH_ONLY', true);   // req 3: beach allowlist
// NOTE: the live `direct` flag from AirportsSearch is ALWAYS false in this context
// (verified empirically), and RouteLowFares exposes no stops field — so neither
// endpoint can prove nonstop. Default OFF; nonstop is handled out-of-band (see README).
const REQUIRE_DIRECT    = envBool('REQUIRE_DIRECT', false); // req 1: see analysis
const EXCLUDE_CODESHARE = envBool('EXCLUDE_CODESHARE', false);

const OUT_DOW    = envDow('OUT_DOW', '4,5'); // Thu, Fri
const IN_DOW     = envDow('IN_DOW', '1,2');  // Mon, Tue
const MIN_NIGHTS = envNum('MIN_NIGHTS', 3);
const MAX_NIGHTS = envNum('MAX_NIGHTS', 5);
const TOP_N      = envNum('TOP_N', 20);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = () => DELAY_MS + Math.floor(Math.random() * 400);
const CALENDAR_URL = `${BASE}/flight-deals/low-fare-calendar/?dep=ATH&arr=AMS&type=R`;

test('aegean direct beach long-weekends', async ({ page }) => {
  test.setTimeout(3 * 60 * 60 * 1000); // up to 3h

  // ---- 1) Akamai warm-up (proven sequence: load calendar, accept cookies, settle) ----
  await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded' });
  for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Αποδοχή")', 'button:has-text("Accept")']) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 })) { await b.click(); break; }
    } catch { /* ignore */ }
  }
  await page.waitForTimeout(5000);

  // same-origin fetch from inside the page (carries the _abck cookie).
  // status 0 = network error or timeout (AbortSignal), with the reason in `error`.
  type ApiResult = { status: number; body: any; error?: string };
  const apiGet = (url: string): Promise<ApiResult> =>
    page.evaluate(async ({ u, timeoutMs }) => {
      try {
        const r = await fetch(u, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
          signal: AbortSignal.timeout(timeoutMs),
        });
        let body: any = null; try { body = await r.json(); } catch { /* non-JSON */ }
        return { status: r.status, body };
      } catch (e) {
        return { status: 0, body: null, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
    }, { u: url, timeoutMs: FETCH_TIMEOUT_MS });

  const retryable = (s: number) => s === 0 || s === 403 || s === 429 || s >= 500;

  // Exponential backoff. On 403/429 also reload the calendar page (renews Akamai _abck).
  const apiGetRetry = async (url: string): Promise<ApiResult> => {
    let res = await apiGet(url);
    for (let attempt = 1; attempt <= MAX_RETRIES && retryable(res.status); attempt++) {
      const wait = BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 1000);
      console.warn(`retry ${attempt}/${MAX_RETRIES} in ${wait}ms: HTTP ${res.status}${res.error ? ` (${res.error})` : ''} ${url}`);
      if (res.status === 403 || res.status === 429) {
        await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(wait);
      res = await apiGet(url);
    }
    return res;
  };

  // ---- 2) enumeration + filtering ----
  async function enumerate(origin: string): Promise<AirportItem[]> {
    const r = await apiGetRetry(airportsSearchUrl(origin, 'to')); // direction=to&airport=ORIGIN -> dests FROM origin
    if (r.status !== 200 || !Array.isArray(r.body)) {
      // Otherwise a blocked/failed enumeration silently drops the whole origin.
      console.warn(`ENUM FAILED for ${origin}: HTTP ${r.status}${r.error ? ` (${r.error})` : ''} — origin skipped`);
    }
    const arr: any[] = Array.isArray(r.body) ? r.body : [];
    return arr
      .filter(x => x?.value && x.value !== origin)
      .map(x => ({
        value: String(x.value),
        label: String(x.label ?? x.citylabel ?? x.value),
        country: String(x.country ?? ''),
        region: x.region,
        direct: !!x.direct,
        codeshare: !!x.codeshare,
      }));
  }

  const select = (items: AirportItem[]) => items.filter(d =>
    d.region === REGION &&
    d.country !== 'GR' &&
    (!BEACH_ONLY || isBeach(d.value)) &&
    (!REQUIRE_DIRECT || d.direct === true) &&
    (!EXCLUDE_CODESHARE || d.codeshare === false));

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('data', `run-${runId}`);
  mkdirSync(outDir, { recursive: true });

  const plan: { origin: string; dests: AirportItem[] }[] = [];
  const diag: Record<string, unknown>[] = [];
  for (const origin of ORIGINS) {
    const all = await enumerate(origin);
    const eu = all.filter(d => d.region === REGION && d.country !== 'GR');
    const euBeach = eu.filter(d => isBeach(d.value));
    let dests = select(all);
    if (Number.isFinite(MAX_DEST)) dests = dests.slice(0, MAX_DEST);
    plan.push({ origin, dests });
    diag.push({
      origin,
      enumerated: all.length,
      eu: eu.length,
      eu_beach: euBeach.length,
      eu_beach_direct: euBeach.filter(d => d.direct).length,
      selected: dests.length,
      // '*' = live direct flag true, '(cs)' = codeshare. Use this to verify the flag per origin.
      eu_beach_list: euBeach.map(d => `${d.value}${d.direct ? '*' : ''}${d.codeshare ? '(cs)' : ''}`).join(' '),
    });
    console.log(`ENUM ${origin}: total=${all.length} eu=${eu.length} eu∩beach=${euBeach.length} (direct=${euBeach.filter(d => d.direct).length}) -> selected=${dests.length}`);
    await sleep(jitter());
  }
  console.table(diag);
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify({
    config: { ORIGINS, MONTHS, TRIP, REGION, BEACH_ONLY, REQUIRE_DIRECT, EXCLUDE_CODESHARE,
              OUT_DOW: [...OUT_DOW], IN_DOW: [...IN_DOW], MIN_NIGHTS, MAX_NIGHTS },
    diag, plan,
  }, null, 2));

  if (LIST_ONLY) {
    console.log(`LIST_ONLY: enumeration only. Inspect ${join(outDir, 'plan.json')}`);
    console.log('In eu_beach_list: "*" means the live `direct` flag is true. Verify a known nonstop (e.g. ATH→BCN/NCE) shows "*".');
    return;
  }

  // ---- 3) fare collection ----
  const legMap = new Map<string, LegFare>(); // dedup origin|dest|DIR|date -> keep min price
  const put = (l: LegFare) => {
    const k = `${l.origin}|${l.dest}|${l.direction}|${l.date}`;
    const prev = legMap.get(k);
    if (!prev || l.price < prev.price) legMap.set(k, l);
  };

  let calls = 0, blocked = 0, errors = 0, dumped = false;
  const totalCalls = plan.reduce((a, p) => a + p.dests.length, 0) * MONTHS.length;
  console.log(`PLAN: ${totalCalls} fare calls (${ORIGINS.length} origins x dests x ${MONTHS.length} months)`);

  for (const { origin, dests } of plan) {
    for (const d of dests) {
      for (const month of MONTHS) {
        calls++;
        const url = routeLowFaresUrl({ origin, dest: d.value, tripType: TRIP, month });
        try {
          const r = await apiGetRetry(url);
          if (r.status === 403 || r.status === 429) {
            blocked++;
            console.warn(`BLOCKED (HTTP ${r.status}) after ${MAX_RETRIES} retries: ${origin}->${d.value} ${month}`);
            await sleep(jitter()); continue;
          }
          if (r.status !== 200 || !r.body) {
            errors++;
            console.warn(`FAILED HTTP ${r.status}${r.error ? ` (${r.error})` : ''}: ${origin}->${d.value} ${month}`);
            await sleep(jitter()); continue;
          }
          const data = r.body as RouteLowFares;

          if (DUMP_RAW && !dumped) {
            dumped = true;
            console.log('RAW top-level keys:', Object.keys(data));
            console.log('RAW Outbound[0]:', JSON.stringify(data.Outbound?.[0] ?? null));
            // ^ Inspect this for any per-fare stops/segments/flightNumber field
            //   that would let us guarantee nonstop at the fare level.
          }

          const cur = data.CurrencySymbol || '€';
          const emit = (arr: any[] | undefined, dir: 'OUT' | 'IN') => {
            for (const e of (arr || [])) {
              const dt = parseDotNetDate(e.Date);
              if (!dt || e.Price == null) continue;
              put({
                origin, dest: d.value, destLabel: d.label, country: d.country, codeshare: d.codeshare,
                direction: dir, date: ymd(dt), dow: dt.getUTCDay(),
                price: Number(e.Price), fullPrice: e.FullPrice != null ? Number(e.FullPrice) : undefined,
                currency: cur,
              });
            }
          };
          emit(data.Outbound, 'OUT');
          emit(data.Inbound, 'IN');
        } catch (e) {
          errors++;
          console.warn(`ERROR ${origin}->${d.value} ${month}: ${e instanceof Error ? e.message : String(e)}`);
        }

        if (calls % 25 === 0) {
          console.log(`progress ${calls}/${totalCalls} | legs ${legMap.size} | 403 ${blocked} | err ${errors}`);
        }
        await sleep(jitter());
      }
    }
  }

  const legs = [...legMap.values()];

  // raw legs CSV (BOM)
  writeCsv(join(outDir, 'fares.csv'),
    legs.map(l => ({
      origin: l.origin, dest: l.dest, dest_label: l.destLabel, country: l.country, codeshare: l.codeshare,
      leg: l.direction, date: l.date, dow: DOW_NAMES[l.dow], price: l.price, full_price: l.fullPrice ?? '', currency: l.currency,
    })),
    ['origin', 'dest', 'dest_label', 'country', 'codeshare', 'leg', 'date', 'dow', 'price', 'full_price', 'currency']);

  // pair + rank
  const trips = pairTrips(legs, { outDow: OUT_DOW, inDow: IN_DOW, minNights: MIN_NIGHTS, maxNights: MAX_NIGHTS });
  writeRanked(outDir, trips);

  console.log(`\nDONE: ${calls} calls | ${legs.length} legs | ${trips.length} trips | 403 ${blocked} | err ${errors}`);
  console.log(`OUT -> ${join(outDir, 'fares.csv')} | ${join(outDir, 'ranked.csv')}`);
  printTop(trips, TOP_N);

  // Fail loudly instead of silently producing a partial ranking.
  expect(calls, 'no fare calls were planned (check ORIGINS/MONTHS/filters)').toBeGreaterThan(0);
  expect(blocked / calls, `blocked ratio ${blocked}/${calls} exceeds MAX_BLOCKED_RATIO`).toBeLessThanOrEqual(MAX_BLOCKED_RATIO);
});

function writeRanked(outDir: string, trips: RankedTrip[]) {
  writeCsv(join(outDir, 'ranked.csv'),
    trips.map((t, i) => ({
      rank: i + 1, origin: t.origin, dest: t.dest, dest_label: t.destLabel, country: t.country, codeshare: t.codeshare,
      out_date: t.outDate, out_dow: t.outDow, out_price: t.outPrice,
      in_date: t.inDate, in_dow: t.inDow, in_price: t.inPrice, nights: t.nights, total: t.total, currency: t.currency,
    })),
    ['rank', 'origin', 'dest', 'dest_label', 'country', 'codeshare',
     'out_date', 'out_dow', 'out_price', 'in_date', 'in_dow', 'in_price', 'nights', 'total', 'currency']);
  writeFileSync(join(outDir, 'ranked.json'), JSON.stringify(trips, null, 2));
}

function printTop(trips: RankedTrip[], n: number) {
  const byOrigin = new Map<string, RankedTrip[]>();
  for (const t of trips) {
    const a = byOrigin.get(t.origin) ?? [];
    a.push(t); byOrigin.set(t.origin, a);
  }
  for (const [origin, arr] of byOrigin) {
    console.log(`\n=== TOP ${n} — ${origin} ===`);
    console.table(arr.slice(0, n).map(t => ({
      dest: `${t.dest} ${t.destLabel}`,
      out: `${t.outDow} ${t.outDate}`,
      in: `${t.inDow} ${t.inDate}`,
      nights: t.nights,
      total: `${t.total}${t.currency}`,
    })));
  }
}
