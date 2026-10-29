/**
 * CSV writer (RFC 4180, CRLF line endings, UTF-8 with BOM so Excel detects
 * the encoding). Cells that start with a formula character are prefixed with
 * an apostrophe so spreadsheets do not execute text written by other users.
 */

const FORMULA_START_RE = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text = String(value);
  if (FORMULA_START_RE.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

export const CSV_BOM = '﻿';
