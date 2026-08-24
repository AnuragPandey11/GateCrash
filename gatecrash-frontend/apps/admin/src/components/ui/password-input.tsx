import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Input } from './input';

/**
 * A password field with a show/hide toggle.
 *
 * Worth getting the details right, because a login screen is the one place a typo costs a lockout
 * — five failed attempts is a 15-minute wait (§5.6), and a guard mashing a locked login is how a
 * shift starts badly.
 *
 *  - `type="button"` so the toggle never submits the form.
 *  - Focusable and keyboard-operable; an eye that only works with a mouse is worse than no eye.
 *  - The `aria-label` says what the button will *do*, and `aria-pressed` carries the current
 *    state, so a screen reader user knows the password is currently exposed.
 *  - Visibility is component-local and resets on unmount. It is never persisted, and the value
 *    itself is never logged or copied anywhere (guardrail #3).
 *
 * `forwardRef` matters: React Hook Form's `register()` hands back a ref, and without forwarding
 * it the field is invisible to focus management and validation focus.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        // Room for the button so a long password never runs underneath it.
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? t('login.hidePassword') : t('login.showPassword')}
        aria-pressed={visible}
        // A normal tab stop. Taking it out of the tab order would shorten the path to "Sign in"
        // by one key press and make the control unusable for anyone navigating by keyboard —
        // functionality has to be keyboard-operable, and a toggle only a mouse can reach is not.
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
