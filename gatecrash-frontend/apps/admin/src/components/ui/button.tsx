import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * shadcn-style button, owned source (§2.2).
 *
 * Variants are named by *role* — `danger` for destructive, `primary` for the affirmative action
 * — never by colour, so the token layer can change palette without touching call sites (§10.1).
 */
const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold tracking-[0.005em]',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out-expo',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        // A faint top highlight and a soft shadow give the primary action weight without a
        // gradient that would date the product.
        primary:
          'bg-primary text-primary-fg shadow-[inset_0_1px_0_hsl(0_0%_100%/0.12),var(--gc-shadow-soft)] hover:bg-primary/90 hover:shadow-raised',
        accent:
          'bg-accent text-accent-fg shadow-[inset_0_1px_0_hsl(0_0%_100%/0.25),var(--gc-shadow-soft)] hover:bg-accent/90 hover:shadow-raised',
        secondary:
          'border border-border bg-surface text-text shadow-soft hover:border-accent/50 hover:bg-surface-raised',
        ghost: 'text-text-muted hover:bg-surface-raised hover:text-text',
        danger:
          'bg-danger text-danger-fg shadow-[inset_0_1px_0_hsl(0_0%_100%/0.12),var(--gc-shadow-soft)] hover:bg-danger/90',
        outline: 'border border-border bg-transparent text-text hover:border-accent/60 hover:bg-accent/5',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        // 48px minimum touch target on the two sizes a finger is likely to meet (§9.7).
        sm: 'h-9 px-3.5 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // Buttons inside a form default to submit, which fires the form when someone meant to
        // open a dialog. Defaulting to "button" makes submission opt-in and explicit.
        {...(asChild ? {} : { type })}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
