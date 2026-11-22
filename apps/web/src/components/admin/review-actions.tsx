import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/** Entry point from the provider record into the review screen. */
export function ReviewActions({ providerId }: { providerId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/admin/review/${providerId}`} className={buttonVariants({ size: 'sm' })}>
        Open review
      </Link>
      <Link href="/admin/review" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
        Review queue
      </Link>
    </div>
  );
}
