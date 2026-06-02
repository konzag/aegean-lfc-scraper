import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';

test('discover low-fare API', async ({ page }) => {
  test.setTimeout(120_000);

  const captured: { url: string; status: number; ct: string }[] = [];
  const jsonBodies: { url: string; body: string }[] = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json') || /lowfare|fare|calendar|availab|price|month|flight/i.test(url)) {
      captured.push({ url, status: resp.status(), ct });
      if (ct.includes('json')) {
        try { jsonBodies.push({ url, body: (await resp.text()).slice(0, 4000) }); } catch {}
      }
    }
  });

  await page.goto(
    'https://el.aegeanair.com/flight-deals/low-fare-calendar/?dep=ATH&arr=AMS&type=R',
    { waitUntil: 'domcontentloaded' }
  );

  // cookie consent (best-effort)
  for (const sel of ['#onetrust-accept-btn-handler', 'button:has-text("Αποδοχή")', 'button:has-text("Accept")']) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 })) { await b.click(); break; }
    } catch {}
  }

  // let the widget fire its API calls
  await page.waitForTimeout(20_000);

  mkdirSync('discovery', { recursive: true });
  writeFileSync('discovery/captured-urls.json', JSON.stringify(captured, null, 2));
  writeFileSync('discovery/json-bodies.json', JSON.stringify(jsonBodies, null, 2));

  console.log('\n===== CANDIDATE URLS =====');
  for (const c of captured) console.log(`${c.status} ${c.ct}  ${c.url}`);
  console.log('PAGE TITLE:', await page.title());
  console.log('===== END =====\n');
});