import { z } from 'zod';

/** All timestamps are stored in UTC and rendered in Asia/Kolkata. */
export const KOLKATA_TIME_ZONE = 'Asia/Kolkata';

/** Indian PIN code: exactly six digits, never a number, never leading zero. */
export const pinCodeRegex = /^[1-9][0-9]{5}$/;
export const pinCodeSchema = z
  .string()
  .trim()
  .regex(pinCodeRegex, 'Enter a valid 6-digit PIN code');

/** Indian mobile: ten digits starting 6-9. */
export const mobileRegex = /^[6-9][0-9]{9}$/;
export const mobileSchema = z
  .string()
  .trim()
  .regex(mobileRegex, 'Enter a valid 10-digit Indian mobile number');

export const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
export const isoDateSchema = z
  .string()
  .trim()
  .regex(isoDateRegex, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Enter a real calendar date');

export function isPinCode(value: unknown): value is string {
  return typeof value === 'string' && pinCodeRegex.test(value);
}

/** Money is stored as integer paise; staff type rupees. */
export function rupeesToPaise(input: string | number): number | null {
  const raw = typeof input === 'number' ? String(input) : input.trim().replace(/,/g, '');
  if (raw === '' || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  if (whole === undefined || whole.length > 12) return null;
  const paise = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return remainder === 0
    ? `${sign}${rupees}`
    : `${sign}${rupees}.${String(remainder).padStart(2, '0')}`;
}

export function formatInr(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/** Accepts an array, a comma separated string or a newline separated textarea value. */
export function splitList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    const values = value.filter((entry): entry is string => typeof entry === 'string');
    return values.map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return undefined;
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatKolkataDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeZone: KOLKATA_TIME_ZONE,
  }).format(date);
}

export function formatKolkataDateTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: KOLKATA_TIME_ZONE,
  }).format(date);
}

/** India observes no DST, so a fixed +05:30 offset is exact. */
export const KOLKATA_OFFSET = '+05:30';

/** Start of an Asia/Kolkata calendar day, expressed in UTC. */
export function kolkataDayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000${KOLKATA_OFFSET}`);
}

/** End of an Asia/Kolkata calendar day, expressed in UTC. */
export function kolkataDayEndUtc(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999${KOLKATA_OFFSET}`);
}

export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

export function daysUntil(target: Date, from: Date): number {
  return Math.floor((startOfUtcDay(target).getTime() - startOfUtcDay(from).getTime()) / 86_400_000);
}
