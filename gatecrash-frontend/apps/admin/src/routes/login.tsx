import { isApiException, loginRequestSchema, type LoginRequest } from '@gatecrash/api';
import { CLIENT_LIMITS } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { endpoints, useSessionStore } from '@/lib/session';

/**
 * Login — FRONTEND.md §5.6 and §0.
 *
 * Three fields and **no link**. There is no self-signup, no OTP, no "forgot password" — an admin
 * provisions the account and hands over a generated password. Adding a link here would be
 * promising a flow the backend does not have.
 *
 * **Township code is part of the credential.** Login ids are unique only within a township, so
 * `A-101-1` exists in every township that has a block A; without the code the server has no
 * namespace to resolve the login id in. It is optional for exactly one caller — a `SUPER_ADMIN`
 * belongs to no township and signs in with the field blank, which resolves against the tenantless
 * platform namespace instead. Hence a blank field is submitted as *absent*, never as an empty
 * string, which would be a present code matching no township.
 *
 * Two pieces of real logic beyond that:
 *
 *  - 401 vs 429: a guard mashing a locked-out login is how a shift starts badly, so a lockout says
 *    so, says for how long, and disables submit rather than letting them burn attempts against a
 *    counter that is already tripped (§5.6).
 *  - 403 `TOWNSHIP_INACTIVE`: the credentials were right and the township is suspended or
 *    archived. Saying so is safe (it is only reachable with valid credentials) and necessary —
 *    "wrong password" would send an entire township chasing a problem they do not have.
 */
export function LoginRoute() {
  const { t } = useTranslation();
  const setMe = useSessionStore((s) => s.setMe);
  const endedReason = useSessionStore((s) => s.endedReason);
  const [lockedOut, setLockedOut] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { townshipCode: '', loginId: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await endpoints.auth.login(values);
      // `me` is the authority on role and mustResetPassword — never the JWT (guardrail #2).
      setMe(await endpoints.auth.me());
    } catch (error) {
      if (isApiException(error) && error.status === 429) {
        setLockedOut(true);
        setFormError(t('login.lockedOut', { minutes: CLIENT_LIMITS.loginLockoutMinutes }));
        return;
      }
      if (isApiException(error) && error.status === 401) {
        setFormError(t('login.invalid'));
        return;
      }
      if (isApiException(error) && error.code === 'TOWNSHIP_INACTIVE') {
        setFormError(t('login.townshipInactive'));
        return;
      }
      setFormError(t('errors.generic'));
    }
  });

  const submitting = form.formState.isSubmitting;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-text">{t('common.appName')}</h1>
          <p className="text-sm text-text-muted">{t('login.subtitle')}</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-border bg-surface p-6"
          noValidate
        >
          <h2 className="font-medium text-text">{t('login.title')}</h2>

          {endedReason && !formError ? (
            <p className="rounded-md bg-surface-raised px-3 py-2 text-sm text-text-muted">
              {t('errors.UNAUTHORIZED')}
            </p>
          ) : null}

          {formError ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          ) : null}

          <Field
            label={t('login.townshipCode')}
            hint={t('login.townshipCodeHint')}
            error={form.formState.errors.townshipCode?.message}
          >
            {(props) => (
              <Input
                {...props}
                {...form.register('townshipCode')}
                autoComplete="organization"
                autoFocus
                spellCheck={false}
                autoCapitalize="characters"
                className="uppercase"
              />
            )}
          </Field>

          <Field label={t('login.loginId')} error={form.formState.errors.loginId?.message} required>
            {(props) => (
              <Input
                {...props}
                {...form.register('loginId')}
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
              />
            )}
          </Field>

          <Field label={t('login.password')} error={form.formState.errors.password?.message} required>
            {(props) => (
              <PasswordInput
                {...props}
                {...form.register('password')}
                autoComplete="current-password"
              />
            )}
          </Field>

          <Button type="submit" className="w-full" disabled={submitting || lockedOut}>
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {submitting ? t('login.submitting') : t('login.submit')}
          </Button>

          <p className="text-center text-xs text-text-muted">{t('login.noSignup')}</p>
        </form>
      </div>
    </div>
  );
}
