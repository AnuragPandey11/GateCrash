import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Table primitives. The visitor log drives these through TanStack Table (headless) because it is
 * server-paginated, server-sorted and multi-filter — the only sane fit (§2.2).
 *
 * The wrapper scrolls horizontally on its own so a wide table never makes the whole page scroll
 * sideways.
 */
export function TableWrap({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: ComponentPropsWithoutRef<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: ComponentPropsWithoutRef<'thead'>) {
  return <thead className={cn('border-b border-border bg-surface-raised/50', className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentPropsWithoutRef<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TR({ className, ...props }: ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-border/70 transition-colors duration-150 data-[clickable=true]:cursor-pointer hover:bg-accent-soft/40',
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: ComponentPropsWithoutRef<'th'>) {
  return (
    <th
      className={cn(
        'h-11 whitespace-nowrap px-4 text-left align-middle text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: ComponentPropsWithoutRef<'td'>) {
  return <td className={cn('px-4 py-3 align-middle text-text', className)} {...props} />;
}
