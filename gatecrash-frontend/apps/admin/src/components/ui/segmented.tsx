import { cn } from '@/lib/cn';

/**
 * A row of mutually exclusive choices — visitor type, pass type, a status filter.
 *
 * Scrolls sideways rather than wrapping on a narrow phone, so a five-option filter never pushes
 * the content below it down the screen. Each option is a real radio for assistive technology.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; icon?: React.ReactNode }[];
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        '-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold transition-all duration-200',
              size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
              active
                ? 'border-primary bg-primary text-primary-fg shadow-soft'
                : 'border-border bg-surface text-text-muted hover:border-accent/50 hover:text-text',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
