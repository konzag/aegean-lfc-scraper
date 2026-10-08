# aegean-lfc-scraper

Finds the cheapest **long-weekend beach round trips** on Aegean Airlines from
Greek origins (default `ATH,SKG,PVK`) to European, non-Greek beach destinations,
using the public Low Fare Calendar endpoints on `el.aegeanair.com`.

Requests run *inside* a real Chromium page (`page.evaluate(fetch)`), so they carry
the Akamai `_abck` cookie the site sets on the calendar page. No login is needed.

## Setup

```bash
npm ci
npx playwright install chromium
```

## Usage

| Command | What it does |
|---|---|
| `npm run trips` | Full run: enumerate destinations, fetch daily low fares, pair Thu/Fri → Mon/Tue trips, write `data/run-*/{plan.json,fares.csv,ranked.csv,ranked.json}` |
| `npm run rerank -- data/run-XXXX/fares.csv` | Re-rank an existing `fares.csv` offline with different filters |
| `npm run probe` / `npm run discover` | Diagnostics used while reverse-engineering the API (write to `discovery/`) |
| `npm run test:unit` | Offline unit tests for the pure helpers (no browser, no network) |
| `npm run typecheck` | `tsc --noEmit` |

Playwright is configured with **one Chromium project and one worker**. Run one
scraper spec at a time; parallel runs get the session blocked by Akamai.
Fetching works reliably only from a residential IP.

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `ORIGINS` | `ATH,SKG,PVK` | Origin airports |
| `MONTHS` | current month + next 3 | Comma list in `YYYY-M` form; overrides `MONTHS_AHEAD` |
| `MONTHS_AHEAD` | `4` | Number of months to scan, starting with the current one |
| `TRIP` | `RT` | Trip type sent to the API |
| `REGION` | `eu` | API region (`gr`/`eu`/`rs`); Greece is always excluded |
| `BEACH_ONLY` | `true` | Restrict to the allowlist in `src/beaches.ts` |
| `REQUIRE_DIRECT` / `EXCLUDE_CODESHARE` | `false` | Extra filters. The live `direct` flag is unreliable (always false), so nonstop service must be checked separately |
| `OUT_DOW` / `IN_DOW` | `4,5` / `1,2` | Outbound/inbound weekdays (0 = Sun) |
| `MIN_NIGHTS` / `MAX_NIGHTS` | `3` / `5` | Stay length |
| `TOP_N` | `20` | Rows printed per origin |
| `MAX_DEST` | ∞ | Cap destinations per origin (for quick tests) |
| `LIST_ONLY` | `false` | Stop after enumeration (writes `plan.json`) |
| `DUMP_RAW` | `false` | Print the first raw fare response |
| `DELAY_MS` | `1100` | Base delay between calls (+0–400 ms jitter) |
| `FETCH_TIMEOUT_MS` | `30000` | Per-request timeout |
| `MAX_RETRIES` / `BACKOFF_BASE_MS` | `3` / `4000` | Exponential backoff on 403/429/5xx/timeouts (403/429 also reload the page) |
| `MAX_BLOCKED_RATIO` | `0.2` | The run **fails** if more than this share of fare calls stay blocked |

PowerShell example: `$env:MONTHS_AHEAD=6; $env:MAX_DEST=3; npm run trips`

## Assumptions

- Each `RouteLowFares` response gives the cheapest fare per day for each direction.
  A trip's `total` is out + in, which estimates a round-trip price.
- Fare dates are .NET `/Date(epoch)/` values at UTC midnight. All weekday maths uses UTC.
- CSVs are UTF-8 with a BOM so Excel renders Greek text correctly. Text cells that
  start with `= + - @` get a `'` prefix to stop CSV/formula injection.

## Output

`data/`, `discovery/`, `test-results/` and `playwright-report/` are gitignored.
