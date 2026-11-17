import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm text-text shadow-[inset_0_1px_2px_hsl(0_0%_0%/0.03)] transition-[border-color,box-shadow] duration-200 hover:border-text-muted/40 focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15 focus-visible:ring-offset-0 data-[state=open]:border-accent disabled:cursor-not-allowed disabled:opacity-60 [&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="size-4 shrink-0 text-text-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      // Every dropdown is a bounded, scrolling list: never taller than the room left on screen
      // (or 20rem), with a visible scrollbar and arrow buttons at either end, so a long list —
      // time slots, units, gates — reads as "scroll for more" instead of stopping at the edge.
      className={cn(
        'relative z-50 flex max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[8rem] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-overlay data-[state=open]:animate-pop-in',
        position === 'popper' && 'w-[var(--radix-select-trigger-width)] translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-7 shrink-0 cursor-default items-center justify-center border-b border-border/60 text-text-muted">
        <ChevronUp className="size-4" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto p-1">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-7 shrink-0 cursor-default items-center justify-center border-t border-border/60 text-text-muted">
        <ChevronDown className="size-4" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-default select-none items-center rounded-[10px] py-2 pl-8 pr-2 text-sm text-text outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-accent-soft data-[state=checked]:font-semibold data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-accent" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

/**
 * Radix `Select` cannot hold an empty-string value — it reserves it for the placeholder. Filters
 * that mean "any" therefore use this sentinel and convert at the boundary, which also keeps an
 * "Any status" from serialising as `?status=` and 400ing as `TYPE_MISMATCH`.
 */
export const ANY_VALUE = '__any__';

export const fromAny = (value: string): string | null => (value === ANY_VALUE ? null : value);
export const toAny = (value: string | null | undefined): string => value ?? ANY_VALUE;
