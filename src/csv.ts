// src/csv.ts
// UTF-8 *with BOM* CSV writer. The BOM is what makes Excel and PowerShell
// Get-Content render Greek labels and the € symbol correctly instead of mojibake.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const BOM = '\uFEFF';

// Text starting with one of these is interpreted as a formula by Excel/Sheets
// (CSV/formula injection). Labels come from a remote API, so neutralise them.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefix a quote to text values that a spreadsheet would treat as a formula. */
export function neutralizeFormula(s: string): string {
  return FORMULA_START.test(s) ? `'${s}` : s;
}

/** Inverse of neutralizeFormula, for reading our own CSVs back. */
export function restoreFormula(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  // Only text is guarded; numbers (e.g. negative prices) stay numeric.
  const s = typeof v === 'string' ? neutralizeFormula(v) : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const head = cols.map(cell).join(',');
  const body = rows.map(r => cols.map(c => cell(r[c])).join(',')).join('\r\n');
  return BOM + head + (body ? '\r\n' + body : '') + '\r\n';
}

export function writeCsv(path: string, rows: Array<Record<string, unknown>>, columns?: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(rows, columns), { encoding: 'utf8' }); // BOM already embedded
}
