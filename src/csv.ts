// src/csv.ts
// UTF-8 *with BOM* CSV writer. The BOM is what makes Excel and PowerShell
// Get-Content render Greek labels and the € symbol correctly instead of mojibake.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const BOM = '\uFEFF';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
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
