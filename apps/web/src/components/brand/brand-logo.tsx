import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The CureNear lockup: the location-pin/plus mark and the wordmark. The mark is
 * exported from the supplied artwork with a transparent background, so it sits on
 * any surface without a plate behind it.
 */
export function BrandLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Image src="/logo.png" alt="" width={size} height={size} priority className="shrink-0" />
      <span className="text-sm font-semibold tracking-tight text-foreground">CureNear</span>
    </span>
  );
}
