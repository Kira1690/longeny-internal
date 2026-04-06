import {
  formatISO,
  parseISO,
  isValid,
  addMinutes,
  addHours,
  addDays,
  differenceInMinutes,
  differenceInHours,
  startOfDay,
  endOfDay,
  format,
} from 'date-fns';

/**
 * Get current time as ISO 8601 string.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Format a date to ISO 8601 string.
 */
export function toISO(date: Date): string {
  return formatISO(date);
}

/**
 * Parse an ISO 8601 string to a Date object.
 * Throws on invalid input.
 */
export function fromISO(iso: string): Date {
  const date = parseISO(iso);
  if (!isValid(date)) {
    throw new Error(`Invalid ISO 8601 date: ${iso}`);
  }
  return date;
}

/**
 * Check if a string is a valid ISO 8601 date.
 */
export function isValidISO(iso: string): boolean {
  return isValid(parseISO(iso));
}

/**
 * Add a duration to a date.
 */
export function addDuration(
  date: Date,
  amount: number,
  unit: 'minutes' | 'hours' | 'days',
): Date {
  switch (unit) {
    case 'minutes':
      return addMinutes(date, amount);
    case 'hours':
      return addHours(date, amount);
    case 'days':
      return addDays(date, amount);
  }
}

/**
 * Calculate difference between two dates.
 */
export function dateDifference(
  start: Date,
  end: Date,
  unit: 'minutes' | 'hours',
): number {
  switch (unit) {
    case 'minutes':
      return differenceInMinutes(end, start);
    case 'hours':
      return differenceInHours(end, start);
  }
}

/**
 * Get start and end of a day for a given date.
 */
export function dayBounds(date: Date): { start: Date; end: Date } {
  return {
    start: startOfDay(date),
    end: endOfDay(date),
  };
}

/**
 * Format a date for display.
 */
export function formatDisplay(date: Date, pattern = 'yyyy-MM-dd HH:mm'): string {
  return format(date, pattern);
}
