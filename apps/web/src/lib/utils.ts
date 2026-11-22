import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatKolkataDate, formatKolkataDateTime } from '@curenear/shared';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | Date | null): string {
  return value ? formatKolkataDate(value) : '—';
}

export function formatDateTime(value: string | Date | null): string {
  return value ? formatKolkataDateTime(value) : '—';
}
