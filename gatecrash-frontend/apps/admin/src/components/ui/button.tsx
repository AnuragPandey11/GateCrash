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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary/90',
        secondary: 'bg-surface-raised text-text hover:bg-surface-raised/70 border border-border',
        ghost: 'text-text hover:bg-surface-raised',
        danger: 'bg-danger text-danger-fg hover:bg-danger/90',
        outline: 'border border-border bg-surface text-text hover:bg-surface-raised',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        // 48px minimum touch target on the two sizes a finger is likely to meet (§9.7).
        sm: 'h-8 px-3 text-xs',
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
