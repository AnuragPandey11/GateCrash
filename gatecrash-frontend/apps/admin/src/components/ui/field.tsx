import { Label } from '@radix-ui/react-label';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A labelled form field with inline error and hint.
 *
 * Errors render *on the field* rather than as a toast (§11.1) — and they are wired with
 * `aria-describedby` and `aria-invalid` so a screen reader announces the failure with the field
 * rather than leaving it as a purely visual red border.
 */
export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /** Receives the ids and accessibility props to spread onto the control. */
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    'aria-label': string;
  }) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="block text-sm font-medium text-text">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </Label>

      {/* `aria-label` as well as the <label>: a Radix Select or Checkbox renders a *button*,
          and `htmlFor` does not name a button. Without this they reach a screen reader as
          "combobox, unlabelled". For a native input the two agree, so it is harmless. */}
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'aria-label': label,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Live character counter for the bounded free-text fields (§8.5, §8.6). */
export function CharCount({ value, max }: { value: string; max: number }) {
  const length = value.length;
  const over = length > max;
  return (
    <span className={cn('tabular-nums text-xs', over ? 'text-danger' : 'text-text-muted')}>
      {length} / {max}
    </span>
  );
}
