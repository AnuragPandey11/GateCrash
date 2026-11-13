import type { Tone } from '@gatecrash/core';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Status chip.
 *
 * **Never encodes state in colour alone** (§9.7): every badge carries a word, and status badges
 * carry an icon too. A colour-blind admin and a black-and-white printout both have to work.
 */
const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success/10 text-success border-success/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  info: 'bg-info/10 text-info border-info/25',
  pending: 'bg-pending/10 text-pending border-pending/25',
  primary: 'bg-primary/10 text-primary border-primary/25',
  muted: 'bg-surface-raised text-text-muted border-border',
};

export interface BadgeProps {
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'muted', icon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-[0.02em]',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
