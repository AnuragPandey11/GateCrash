import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('space-y-1 border-b border-border p-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<'h3'>) {
  return <h3 className={cn('font-semibold text-text', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<'p'>) {
  return <p className={cn('text-sm text-text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}
