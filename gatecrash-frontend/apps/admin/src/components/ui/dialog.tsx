import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Removes the close button and blocks dismissal by Esc or backdrop click.
     *
     * Used by the one-time credential hand-off (§8.7): the generated password is shown once and
     * cannot be retrieved, so an accidental Esc would strand an account nobody can sign into.
     * The only way out is the explicit "I have saved this" button.
     */
    mandatory?: boolean;
  }
>(({ className, children, mandatory = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[hsl(226_40%_6%/0.55)] backdrop-blur-sm data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      onEscapeKeyDown={mandatory ? (e) => e.preventDefault() : undefined}
      onPointerDownOutside={mandatory ? (e) => e.preventDefault() : undefined}
      onInteractOutside={mandatory ? (e) => e.preventDefault() : undefined}
      className={cn(
        // max-h + overflow is load-bearing, not polish. The dialog is centred with
        // -translate-y-1/2, so without a height bound a tall form grows off *both* ends of the
        // viewport and its footer becomes unreachable -- the user can see the form but cannot
        // submit it. dvh rather than vh so a mobile browser's collapsing toolbar is accounted for.
        //
        // flex-col rather than grid so a DialogBody can claim the leftover height and scroll on
        // its own, keeping the title and the action buttons pinned. Dialogs that do not use
        // DialogBody still scroll as a whole here, so none of them can trap their own footer.
        'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg',
        '-translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-lg border',
        'border-border/80 bg-surface p-7 shadow-overlay data-[state=open]:animate-scale-in',
        // An accent hairline across the top edge: the one flourish every dialog shares.
        'before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px',
        'before:bg-gradient-to-r before:from-transparent before:via-accent/70 before:to-transparent',
        className,
      )}
      {...props}
    >
      {children}
      {mandatory ? null : (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('shrink-0 space-y-1.5 pr-6', className)} {...props} />;
}

/**
 * The scrollable middle of a tall dialog, so the header and the action buttons stay put while the
 * form scrolls between them. Optional: a short dialog does not need it.
 *
 * The negative margin with matching padding puts the scrollbar at the dialog's edge while keeping
 * the fields aligned with the header, and stops a focus ring being clipped by the scroll container.
 */
export function DialogBody({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('-mx-7 min-h-0 flex-1 space-y-3 overflow-y-auto px-7 py-1', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-display text-[1.375rem] leading-tight text-text', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
