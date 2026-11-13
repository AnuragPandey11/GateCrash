import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * The surface everything sits on: white (or midnight) paper with a hairline edge and a soft,
 * layered shadow — depth from light, not from heavy borders.
 */
export function Card({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border/80 bg-surface shadow-soft', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('space-y-1 border-b border-border/70 px-5 py-4', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<'h3'>) {
  return (
    <h3
      className={cn('text-[0.9375rem] font-semibold tracking-[-0.005em] text-text', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cn('text-sm text-text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}
