import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysUntil,
  formatInr,
  formatKolkataDate,
  formatKolkataDateTime,
  isPinCode,
  kolkataDayEndUtc,
  kolkataDayStartUtc,
  paiseToRupees,
  pinCodeSchema,
  rupeesToPaise,
  splitList,
  startOfUtcDay,
} from './utils';

describe('shared value helpers', () => {
  it('converts rupees to paise without floating-point drift', () => {
    expect(rupeesToPaise('1250')).toBe(125_000);
    expect(rupeesToPaise('1250.50')).toBe(125_050);
    expect(rupeesToPaise(0.1)).toBe(10);
    expect(rupeesToPaise('1,250')).toBe(125_000);
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('abc')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('12.345')).toBeNull();
  });

  it('formats paise for display and CSV', () => {
    expect(paiseToRupees(125_050)).toBe('1250.50');
    expect(paiseToRupees(0)).toBe('0');
    expect(paiseToRupees(-100)).toBe('-1');
    expect(paiseToRupees(1)).toBe('0.01');
    expect(formatInr(125_000)).toContain('1,250');
    expect(formatInr(0)).toContain('0');
  });

  it('accepts only six-digit Indian PINs', () => {
    expect(isPinCode('700001')).toBe(true);
    expect(isPinCode('012345')).toBe(false);
    expect(isPinCode(700001)).toBe(false);
    expect(pinCodeSchema.safeParse('700001').success).toBe(true);
    expect(pinCodeSchema.safeParse('70001').success).toBe(false);
  });

  it('splits comma/newline lists and drops blanks', () => {
    expect(splitList('a, b ,,a')).toEqual(['a', 'b', 'a']);
    expect(splitList('a\nb\n')).toEqual(['a', 'b']);
    expect(splitList(['a', ' b ', ''])).toEqual(['a', 'b']);
    expect(splitList('')).toBeUndefined();
    expect(splitList(null)).toBeUndefined();
    expect(splitList(42)).toBeUndefined();
  });

  it('renders Kolkata dates and day boundaries in UTC', () => {
    expect(formatKolkataDate('2026-11-22T18:30:00.000Z')).toBe('23 Nov 2026');
    expect(formatKolkataDateTime('2026-11-22T04:00:00.000Z')).toContain('9:30 am');
    expect(kolkataDayStartUtc('2026-11-22').toISOString()).toBe('2026-11-21T18:30:00.000Z');
    expect(kolkataDayEndUtc('2026-11-22').toISOString()).toBe('2026-11-22T18:29:59.999Z');
  });

  it('adds days and counts whole days between timestamps', () => {
    const start = new Date('2026-11-22T00:00:00.000Z');
    expect(addDays(start, 3).toISOString()).toBe('2026-11-25T00:00:00.000Z');
    expect(addDays(start, -1).toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(startOfUtcDay(new Date('2026-11-22T23:59:00.000Z')).toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
    expect(daysUntil(new Date('2026-12-02T00:00:00.000Z'), start)).toBe(10);
  });
});
