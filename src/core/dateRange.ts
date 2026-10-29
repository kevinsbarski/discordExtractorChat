import type { DateRange } from './types';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through Date to reject values such as 2026-02-31.
  const probe = new Date(year, month - 1, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Turns two calendar dates into an inclusive range of instants in the
 * browser's local time zone: start of the first day to the last millisecond
 * of the last day. Daylight-saving transitions are handled by `Date`.
 */
export function buildDateRange(startDate: string, endDate: string): DateRange {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start) throw new Error(`Invalid start date: ${startDate}`);
  if (!end) throw new Error(`Invalid end date: ${endDate}`);

  const startMs = new Date(start.year, start.month - 1, start.day, 0, 0, 0, 0).getTime();
  const endMs = new Date(end.year, end.month - 1, end.day, 23, 59, 59, 999).getTime();
  if (endMs < startMs) throw new Error('The end date is before the start date.');

  return { startMs, endMs, startDate, endDate, timeZone: localTimeZone() };
}

export function isWithinRange(range: Pick<DateRange, 'startMs' | 'endMs'>, ms: number): boolean {
  return ms >= range.startMs && ms <= range.endMs;
}

/** Local calendar date of `date` as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(isoDate: string, days: number): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) throw new Error(`Invalid date: ${isoDate}`);
  return toIsoDate(new Date(parsed.year, parsed.month - 1, parsed.day + days));
}
