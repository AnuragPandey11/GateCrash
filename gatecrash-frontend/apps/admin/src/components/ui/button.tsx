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
    // Oakshade's buttons are pills: flat ink, no glow.
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold',
    'transition-[background-color,border-color,color,transform] duration-150 ease-out',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        // In dark mode the tokens invert the ink pill to a white one on black.
        primary: 'bg-primary text-primary-fg hover:bg-primary/85',
        accent: 'bg-accent text-accent-fg hover:bg-accent/85',
        secondary: 'border border-border bg-surface text-text hover:border-text/30 hover:bg-surface-raised',
        ghost: 'text-text-muted hover:bg-surface-raised hover:text-text',
        danger: 'bg-danger text-danger-fg shadow-soft hover:bg-danger/90',
        outline: 'border border-border bg-transparent text-text hover:border-text/35 hover:bg-surface-raised/60',
        link: 'text-text underline decoration-text/25 underline-offset-4 hover:decoration-text active:scale-100',
      },
      size: {
        // 48px minimum touch target on the two sizes a finger is likely to meet (§9.7).
        sm: 'h-9 px-4 text-xs',
        md: 'h-10 px-5',
        lg: 'h-12 px-7',
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
