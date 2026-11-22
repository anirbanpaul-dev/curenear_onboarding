import * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('field-label', className)} {...props}>
      {children}
      {required ? (
        <span className="ml-1 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}
