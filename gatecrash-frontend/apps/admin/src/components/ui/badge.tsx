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
  success: 'bg-success/12 text-success border-success/30',
  danger: 'bg-danger/12 text-danger border-danger/30',
  warning: 'bg-warning/12 text-warning border-warning/30',
  info: 'bg-info/12 text-info border-info/30',
  pending: 'bg-pending/12 text-pending border-pending/30',
  primary: 'bg-primary/12 text-primary border-primary/30',
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
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
