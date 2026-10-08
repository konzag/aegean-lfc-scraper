import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://el.aegeanair.com';

test('probe enumeration + in-context fetch', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto(`${BASE}/flight-deals/low-fare-calendar/?dep=ATH&arr=AMS&type=R`, { waitUntil: 'domcontentloaded' });
  for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Αποδοχή")', 'button:has-text("Accept")']) {
    try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 2000 })) { await b.click(); break; } } catch {}
  }
  await page.waitForTimeout(5000);

  const getJson = (url: string) => page.evaluate(async (u) => {
    const r = await fetch(u, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'include',
      signal: AbortSignal.timeout(30_000),
    });
    let body: any = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, url);

  const air = (dir: string, ap: string) =>
    `${BASE}/el/sys/flights/AirportsSearch?airport=${ap}&airline=&expandGroups=false&hideGroups=false&direction=${dir}&version=&searchKey=&showProviderOnlyAlsoAirports=false&showCodeshareOnlyAirports=true`;

  const results: any = {};

  // in-context lowfare for July (promo period) -> confirms replay works
  const lf = await getJson(`${BASE}/el/sys/lowfares/RouteLowFares/?DepartureAirport=ATH&ArrivalAirport=AMS&TripType=RT&DepartureDate=2026-7&ReturnDate=2026-7&SelectedDepartureDate=&SelectedReturnDate=&Type=Fares`);
  results.lowfareJuly = { status: lf.status, outboundLowest: lf.body?.OutboundLowestPrice, inboundLowest: lf.body?.InboundLowestPrice, outDays: lf.body?.Outbound?.length, inDays: lf.body?.Inbound?.length };

  // enumeration variants
  const toATH = await getJson(air('to', 'ATH'));
  const fromATH = await getJson(air('from', 'ATH'));
  const fromEmpty = await getJson(air('from', ''));

  const summ = (r: any) => Array.isArray(r.body) ? {
    status: r.status, count: r.body.length,
    hasAMS: r.body.some((x: any) => x.value === 'AMS'),
    hasATH: r.body.some((x: any) => x.value === 'ATH'),
    sample: r.body.slice(0, 10).map((x: any) => `${x.value}/${x.country}`)
  } : { status: r.status, count: 0, note: 'not-array' };

  results.toATH = summ(toATH);
  results.fromATH = summ(fromATH);
  results.fromEmpty = summ(fromEmpty);

  mkdirSync('discovery', { recursive: true });
  writeFileSync('discovery/probe-to-ATH.json', JSON.stringify(toATH.body, null, 2));
  writeFileSync('discovery/probe-from-ATH.json', JSON.stringify(fromATH.body, null, 2));
  writeFileSync('discovery/probe-summary.json', JSON.stringify(results, null, 2));

  console.log('PROBE_RESULT ' + JSON.stringify(results));
});
