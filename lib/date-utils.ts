import { format, eachDayOfInterval, isWeekend, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

/**
 * Working days (Mon-Fri) between start and end, inclusive. Returns 0 for an
 * invalid/empty range instead of throwing — safe to use in a reduce().
 */
export function countWorkingDays(start: string, end: string): number {
  try {
    return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).filter((d) => !isWeekend(d)).length
  } catch {
    return 0
  }
}

/**
 * Formats a date string safely without timezone shifting.
 * Extracts the YYYY-MM-DD part and constructs a LOCAL date to avoid
 * UTC offset issues (e.g. UTC-3 shifting 2026-04-02T00:00:00Z to Apr 1).
 */
export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  if (typeof date === 'string') {
    // Extract date part (first 10 chars: YYYY-MM-DD) and build local date
    const part = date.substring(0, 10)
    const [y, m, d] = part.split('-').map(Number)
    if (y && m && d) return format(new Date(y, m - 1, d), fmt, { locale: es })
  }
  return format(date as Date, fmt, { locale: es })
}

export function formatMonth(date: Date): string {
  return format(date, 'MMMM', { locale: es })
}

export const DEFAULT_START = '2026-03-02'
export const DEFAULT_END = '2026-06-23'
