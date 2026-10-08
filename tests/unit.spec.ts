// Offline unit tests for the pure helpers (no browser, no network).
//   npm run test:unit
import { test, expect } from '@playwright/test';
import { nextMonths, parseDotNetDate, ymd } from '../src/aegean';
import { toCsv, neutralizeFormula, restoreFormula } from '../src/csv';
import { pairTrips } from '../src/pairing';
import type { LegFare } from '../src/pairing';

test('nextMonths starts at the current month and rolls over the year', () => {
  expect(nextMonths(3, new Date(Date.UTC(2026, 10, 15)))).toEqual(['2026-11', '2026-12', '2027-1']);
  expect(nextMonths(0)).toEqual([]);
});

test('parseDotNetDate + ymd use UTC', () => {
  const d = parseDotNetDate('/Date(1782950400000)/');
  expect(d).not.toBeNull();
  expect(ymd(d!)).toBe('2026-07-02');
  expect(parseDotNetDate('garbage')).toBeNull();
});

test('CSV neutralises formula-looking text but not numbers', () => {
  expect(neutralizeFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
  expect(neutralizeFormula('Βαρκελώνη')).toBe('Βαρκελώνη');
  expect(restoreFormula(neutralizeFormula('+30 test'))).toBe('+30 test');
  const csv = toCsv([{ label: '@SUM(A1)', price: -5 }], ['label', 'price']);
  expect(csv).toContain(`'@SUM(A1),-5`);
  expect(csv.startsWith('﻿')).toBe(true);
});

test('pairTrips keeps only eligible weekday pairs within the night range, sorted by total', () => {
  const leg = (direction: 'OUT' | 'IN', date: string, price: number): LegFare => ({
    origin: 'ATH', dest: 'BCN', destLabel: 'Barcelona', country: 'ES', codeshare: false,
    direction, date, dow: new Date(date + 'T00:00:00Z').getUTCDay(), price, currency: '€',
  });
  const trips = pairTrips([
    leg('OUT', '2026-07-02', 50), // Thu
    leg('OUT', '2026-07-03', 40), // Fri
    leg('IN', '2026-07-06', 30),  // Mon
    leg('IN', '2026-07-14', 10),  // Tue, too far
    leg('IN', '2026-07-07', 0),   // invalid price, ignored
  ], { outDow: new Set([4, 5]), inDow: new Set([1, 2]), minNights: 3, maxNights: 5 });
  expect(trips.map(t => [t.outDate, t.inDate, t.total])).toEqual([
    ['2026-07-03', '2026-07-06', 70],
    ['2026-07-02', '2026-07-06', 80],
  ]);
});
