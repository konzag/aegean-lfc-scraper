import { test } from '@playwright/test';
import { writeFileSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';

const BASE = 'https://el.aegeanair.com';

// ---- config (override via env vars) ----
const ORIGINS = (process.env.ORIGINS || 'ATH,SKG,PVK').split(',').map(s => s.trim()).filter(Boolean);
const MONTHS = (process.env.MONTHS ||
  '2026-7,2026-8,2026-9,2026-10,2026-11,2026-12,2027-1,2027-2,2027-3'
).split(',').map(s => s.trim());
const TRIP = process.env.TRIP || 'RT';
const DELAY_MS = Number(process.env.DELAY_MS || 1000);
const LIST_ONLY = !!process.env.LIST_ONLY;
const MAX_DEST = process.env.MAX_DEST ? Number(process.env.MAX_DEST) : Infinity;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const jitter = () => DELAY_MS + Math.floor(Math.random() * 400);

function parseNetDate(v: any): string | null {
  const m = String(v).match(/Date\((\d+)\)/);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

const CALENDAR_URL = `${BASE}/flight-deals/low-fare-calendar/?dep=ATH&arr=AMS&type=R`;

test('scrape low fares', async ({ page }) => {
  test.setTimeout(3 * 60 * 60 * 1000); // up to 3h

  // 1) load calendar so the browser passes Akamai and gets cookies
  await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded' });
  for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Αποδοχή")', 'button:has-text("Accept")']) {
    try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 2000 })) { await b.click(); break; } } catch {}
  }
  await page.waitForTimeout(5000);

  // same-origin fetch from inside the page (carries Akamai cookies)
  const apiGet = (url: string): Promise<{ status: number; body: any }> =>
    page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'include' });
      let body: any = null; try { body = await r.json(); } catch {}
      return { status: r.status, body };
    }, url);

  // one Akamai-refresh retry on 403 (reload page to renew _abck)
  const apiGetRetry = async (url: string) => {
    let res = await apiGet(url);
    if (res.status === 403) {
      await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      res = await apiGet(url);
    }
    return res;
  };

  const airUrl = (dir: string, ap: string) =>
    `${BASE}/el/sys/flights/AirportsSearch?airport=${ap}&airline=&expandGroups=false&hideGroups=false&direction=${dir}&version=&searchKey=&showProviderOnlyAlsoAirports=false&showCodeshareOnlyAirports=true`;

  // 2) enumerate international destinations per origin (auto-discover the right param)
  async function destinationsFor(origin: string) {
    for (const dir of ['to', 'from']) {
      const r = await apiGetRetry(airUrl(dir, origin));
      if (Array.isArray(r.body) && r.body.length > 1) {
        const list = r.body.filter((x: any) => x?.value && x.value !== origin && x.country && x.country !== 'GR');
        if (list.length > 0) return list.map((x: any) => ({ value: x.value, label: x.label, country: x.country }));
      }
    }
    const r = await apiGetRetry(airUrl('from', '')); // fallback: full network list
    const list = Array.isArray(r.body) ? r.body.filter((x: any) => x?.value && x.value !== origin && x.country && x.country !== 'GR') : [];
    return list.map((x: any) => ({ value: x.value, label: x.label, country: x.country }));
  }

  // ---- run ----
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('data', `run-${runId}`);
  mkdirSync(outDir, { recursive: true });

  // enumerate destinations
  const plan: { origin: string; dests: { value: string; label: string; country: string }[] }[] = [];
  for (const origin of ORIGINS) {
    const dests = (await destinationsFor(origin)).slice(0, MAX_DEST);
    plan.push({ origin, dests });
    console.log(`ENUM ${origin}: ${dests.length} intl destinations`);
    await sleep(jitter());
  }
  writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan, null, 2));

  if (LIST_ONLY) {
    console.log('LIST_ONLY set -> stopping after enumeration. See ' + join(outDir, 'plan.json'));
    return;
  }

  // scrape fares -> incremental CSV (survives a crash)
  const csv = createWriteStream(join(outDir, 'fares.csv'), { encoding: 'utf8' });
  csv.write('captured_at,origin,destination,dest_label,dest_country,leg,from,to,date,price,full_price,class,currency\n');

  const capturedAt = new Date().toISOString();
  let rows = 0, calls = 0, errors = 0, blocked = 0;
  const totalRoutes = plan.reduce((a, p) => a + p.dests.length, 0);
  const totalCalls = totalRoutes * MONTHS.length;
  console.log(`PLAN: ${totalRoutes} routes x ${MONTHS.length} months = ${totalCalls} calls`);

  for (const { origin, dests } of plan) {
    for (const d of dests) {
      for (const month of MONTHS) {
        const url = `${BASE}/el/sys/lowfares/RouteLowFares/?DepartureAirport=${origin}&ArrivalAirport=${d.value}&TripType=${TRIP}&DepartureDate=${month}&ReturnDate=${month}&SelectedDepartureDate=&SelectedReturnDate=&Type=Fares`;
        calls++;
        try {
          const r = await apiGetRetry(url);
          if (r.status === 403) { blocked++; await sleep(jitter()); continue; }
          if (r.status !== 200 || !r.body) { await sleep(jitter()); continue; }
          const cur = r.body.CurrencySymbol || 'EUR';
          const emit = (arr: any[], leg: string, from: string, to: string) => {
            for (const e of (arr || [])) {
              const date = parseNetDate(e.Date);
              if (date == null || e.Price == null) continue;
              const label = String(d.label || '').replace(/"/g, "'");
              csv.write(`${capturedAt},${origin},${d.value},"${label}",${d.country},${leg},${from},${to},${date},${e.Price},${e.FullPrice},${e.Class || ''},${cur}\n`);
              rows++;
            }
          };
          emit(r.body.Outbound, 'OUT', origin, d.value);
          emit(r.body.Inbound, 'IN', d.value, origin);
        } catch {
          errors++;
        }
        if (calls % 25 === 0) console.log(`progress ${calls}/${totalCalls} | rows ${rows} | err ${errors} | 403 ${blocked}`);
        await sleep(jitter());
      }
    }
  }

  csv.end();
  console.log(`DONE: ${calls} calls | ${rows} rows | ${errors} errors | ${blocked} blocked -> ${outDir}\\fares.csv`);
});
