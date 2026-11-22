'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 border-r bg-card px-3 py-6 md:block">
      <nav aria-label="Sections" className="space-y-1">
        {items.map((item) => {
          const active =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`));
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block rounded-md px-3 py-2 text-sm',
                active
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
