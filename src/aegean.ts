// src/aegean.ts
// Aegean Low Fare Calendar — endpoint URL builders, response types, parsers.
// No I/O here. All network calls happen INSIDE the page context (page.evaluate)
// so they inherit the Akamai _abck cookie; these helpers only build/parse.

export const BASE = 'https://el.aegeanair.com';

export type Region = 'gr' | 'eu' | 'rs';

// Shape confirmed from discovery/probe-to-ATH.json
export interface AirportItem {
  value: string;       // IATA, e.g. 'BCN'
  label: string;       // Greek display name
  country: string;     // ISO2, e.g. 'ES'
  region: Region;      // 'gr' Greece | 'eu' Europe | 'rs' rest of world
  direct: boolean;     // Aegean nonstop service flag (verify per-origin — see README)
  codeshare: boolean;  // codeshare-only marketing
}

export interface FareItem {
  Date: string;        // .NET "/Date(epoch_ms)/"
  Price: number;
  FullPrice?: number;
  Class?: string;
}

export interface RouteLowFares {
  Outbound: FareItem[];        // origin -> dest, daily lowest for the month
  Inbound: FareItem[];         // dest -> origin, daily lowest for the month
  OutboundLowestPrice?: number;
  InboundLowestPrice?: number;
  CurrencySymbol?: string;     // "€"
}

export function airportsSearchUrl(airport: string, direction: 'to' | 'from' = 'to'): string {
  const p = new URLSearchParams({
    airport,
    airline: '',
    expandGroups: 'false',
    hideGroups: 'false',
    direction,
    version: '',
    searchKey: '',
    showProviderOnlyAlsoAirports: 'false',
    showCodeshareOnlyAirports: 'true',
  });
  return `${BASE}/el/sys/flights/AirportsSearch?${p.toString()}`;
}

export function routeLowFaresUrl(o: {
  origin: string; dest: string; tripType: string; month: string; // month = 'YYYY-M'
}): string {
  const p = new URLSearchParams({
    DepartureAirport: o.origin,
    ArrivalAirport: o.dest,
    TripType: o.tripType,
    DepartureDate: o.month,
    ReturnDate: o.month,
    SelectedDepartureDate: '',
    SelectedReturnDate: '',
    Type: 'Fares',
  });
  return `${BASE}/el/sys/lowfares/RouteLowFares/?${p.toString()}`;
}

const DOTNET = /Date\((\d+)\)/;

/** Parse ".NET /Date(epoch_ms)/" -> Date (epoch is UTC midnight). */
export function parseDotNetDate(v: unknown): Date | null {
  const m = DOTNET.exec(String(v));
  return m ? new Date(Number(m[1])) : null;
}

/** YYYY-MM-DD using UTC getters (the epoch is UTC midnight). */
export function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The current month plus the following n-1 months, in the API's 'YYYY-M' format.
 * e.g. nextMonths(3, new Date('2026-11-15')) -> ['2026-11', '2026-12', '2027-1']
 */
export function nextMonths(n: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth(); // 0-based
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${m + 1}`);
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return out;
}

// getUTCDay(): 0=Sun .. 6=Sat
export const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
