import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const base = [
  'w-full rounded-[10px] border border-border bg-surface px-3.5 py-2 text-sm text-text shadow-[inset_0_1px_2px_hsl(224_40%_12%/0.04)]',
  'placeholder:text-text-muted/70 transition-[border-color,box-shadow] duration-200',
  'hover:border-text-muted/40 focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15 focus-visible:ring-offset-0',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/15',
].join(' ');

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, 'h-10', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(base, 'min-h-24 resize-y', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
