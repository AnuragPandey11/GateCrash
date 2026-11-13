import { changePasswordRequestSchema, isApiException } from '@gatecrash/api';
import { SERVER_DEFAULTS } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { applyFieldErrors, errorMessage } from '@/lib/errors';
import { endpoints, useSessionStore } from '@/lib/session';
import { toast } from '@/lib/toast';

/**
 * The forced password change — FRONTEND.md §5.1 and §9.6.
 *
 * While the session is in `MUST_RESET_PASSWORD` this is the *only* screen that renders.
 * `PasswordResetEnforcementFilter` answers `403 PASSWORD_RESET_REQUIRED` on every other path and
 * refuses STOMP CONNECT, so anything else would be a screen full of errors.
 *
 * The trap worth naming: `POST /auth/password` revokes every refresh token and returns a **fresh
 * `LoginResponse`**. `endpoints.auth.changePassword` adopts those tokens for us (§5.3) — without
 * that, the user is signed out the instant they succeed, which reads as a broken app.
 */

const formSchema = changePasswordRequestSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords-must-match',
  });

type FormValues = z.infer<typeof formSchema>;

/**
 * A four-step meter, not a score out of 100.
 *
 * It is advisory: the server's only rule is ≥10 characters, and this must never block a password
 * the backend would accept. Its job is to nudge, not to gate.
 */
function strength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < SERVER_DEFAULTS.passwordMinLength) return 0;
  let score = 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

const STRENGTH_LABEL = ['weak', 'weak', 'fair', 'good', 'strong'] as const;
const STRENGTH_COLOUR = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-info', 'bg-success'] as const;

export function ChangePasswordRoute() {
  const { t } = useTranslation();
  const setMe = useSessionStore((s) => s.setMe);
  const forced = useSessionStore((s) => s.state === 'mustResetPassword');

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = form.watch('newPassword') ?? '';
  const score = strength(newPassword);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await endpoints.auth.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // Re-read the session: `mustResetPassword` is now false and the state machine moves on.
      setMe(await endpoints.auth.me());
      toast.success(t('changePassword.success'));
    } catch (error) {
      const applied = applyFieldErrors(
        error,
        (name, err) => form.setError(name as keyof FormValues, err),
        ['currentPassword', 'newPassword'],
      );
      if (!applied) {
        // A rejected *new* password (422 WEAK_PASSWORD — "must not contain your login id") is
        // about the field the user has to change, not the one they typed correctly. Putting
        // every server error on `currentPassword` would send them hunting in the wrong place.
        const field =
          isApiException(error) && (error.isBusinessRule || error.code === 'WEAK_PASSWORD')
            ? 'newPassword'
            : 'currentPassword';
        form.setError(field, {
          type: 'server',
          message: isApiException(error) ? errorMessage(error, t) : t('errors.generic'),
        });
      }
    }
  });

  const confirmError = form.formState.errors.confirmPassword?.message;
  const submitting = form.formState.isSubmitting;

  return (
    <div className="midnight-panel flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 animate-enter">
        <form
          onSubmit={onSubmit}
          className="relative space-y-5 rounded-lg border border-border/80 bg-surface p-8 shadow-overlay before:pointer-events-none before:absolute before:inset-x-10 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-accent/70 before:to-transparent"
          noValidate
        >
          <div className="space-y-1">
            <h1 className="font-display text-[1.75rem] leading-tight text-text">{t('changePassword.title')}</h1>
            {forced ? (
              <p className="text-sm text-text-muted">{t('changePassword.forcedSubtitle')}</p>
            ) : null}
          </div>

          <Field
            label={t('changePassword.currentPassword')}
            error={form.formState.errors.currentPassword?.message}
            required
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('currentPassword')}
                type="password"
                autoComplete="current-password"
                autoFocus
              />
            )}
          </Field>

          <Field
            label={t('changePassword.newPassword')}
            error={
              form.formState.errors.newPassword?.type === 'server'
                ? form.formState.errors.newPassword.message
                : form.formState.errors.newPassword
                  ? t('changePassword.tooShort', { min: SERVER_DEFAULTS.passwordMinLength })
                  : undefined
            }
            hint={
              <span className="flex items-center gap-2">
                <span className="flex flex-1 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={cn(
                        'h-1 flex-1 rounded-full',
                        step <= score ? STRENGTH_COLOUR[score] : 'bg-border',
                      )}
                    />
                  ))}
                </span>
                <span>{t(`changePassword.strength.${STRENGTH_LABEL[score]}`)}</span>
              </span>
            }
            required
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('newPassword')}
                type="password"
                autoComplete="new-password"
              />
            )}
          </Field>

          <Field
            label={t('changePassword.confirmPassword')}
            error={confirmError ? t('changePassword.mismatch') : undefined}
            required
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('confirmPassword')}
                type="password"
                autoComplete="new-password"
              />
            )}
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {submitting ? t('changePassword.submitting') : t('changePassword.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
