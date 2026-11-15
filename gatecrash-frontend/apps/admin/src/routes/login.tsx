import { isApiException, loginRequestSchema, type LoginRequest } from '@gatecrash/api';
import { CLIENT_LIMITS } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { BellRing, Building2, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/theme-toggle';
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
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      {/* The brand panel. Decorative and informational only — nothing here is interactive, so a
          keyboard user lands straight in the form. */}
      <aside
        aria-hidden
        className="midnight-panel relative hidden overflow-hidden text-sidebar-fg lg:flex lg:flex-col lg:justify-between lg:p-14"
      >
        <div className="pointer-events-none absolute -left-24 -top-24 size-[28rem] rounded-full bg-accent/20 blur-3xl animate-drift" />
        <div
          className="pointer-events-none absolute -bottom-32 right-0 size-[30rem] rounded-full bg-[hsl(224_70%_45%/0.25)] blur-3xl animate-drift"
          style={{ animationDelay: '-9s' }}
        />

        <div className="relative flex items-center gap-3 animate-enter">
          <span className="flex size-11 items-center justify-center rounded-[12px] border border-accent/50 bg-accent/10 font-display text-2xl text-accent">
            G
          </span>
          <div className="leading-tight">
            <p className="font-display text-2xl">{t('common.appName')}</p>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.24em] text-sidebar-muted">
              {t('nav.tagline')}
            </p>
          </div>
        </div>

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-5 animate-enter [animation-delay:120ms]">
            <p className="eyebrow">{t('login.heroEyebrow')}</p>
            <h2 className="font-display text-[2.75rem] leading-[1.08] text-sidebar-fg">
              {t('login.heroTitle')}
            </h2>
            <p className="text-[0.9375rem] leading-relaxed text-sidebar-muted">{t('login.heroBody')}</p>
          </div>
          <ul className="stagger space-y-3.5">
            {(
              [
                [ShieldCheck, 'login.heroPoint1'],
                [BellRing, 'login.heroPoint2'],
                [Building2, 'login.heroPoint3'],
              ] as const
            ).map(([Icon, key]) => (
              <li key={key} className="flex items-center gap-3 text-sm text-sidebar-fg/90">
                <span className="flex size-8 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
                  <Icon className="size-4 text-accent" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-muted/80">{t('login.heroFooter')}</p>
      </aside>

      <div className="relative flex items-center justify-center p-6 sm:p-10">
        {/* Light / dark, before signing in too. Top-right of the form side, which is the only side
            a phone shows. */}
        <ThemeToggle className="absolute right-4 top-4 size-10 sm:right-6 sm:top-6" />
        <div className="w-full max-w-[25rem] space-y-8 animate-enter">
          <div className="space-y-3">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="flex size-10 items-center justify-center rounded-[12px] border border-accent/50 bg-accent/10 font-display text-xl text-accent">
                G
              </span>
              <span className="font-display text-2xl text-text">{t('common.appName')}</span>
            </div>
            <p className="eyebrow">{t('login.eyebrow')}</p>
            <h1 className="font-display text-[2.25rem] leading-tight text-text">{t('login.title')}</h1>
            <p className="text-sm text-text-muted">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            {endedReason && !formError ? (
              <p className="rounded-[10px] border border-border bg-surface-raised px-3.5 py-2.5 text-sm text-text-muted animate-pop-in">
                {t('errors.UNAUTHORIZED')}
              </p>
            ) : null}

            {formError ? (
              <p
                role="alert"
                className="rounded-[10px] border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger animate-pop-in"
              >
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
                  className="h-11 uppercase tracking-[0.12em]"
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
                  className="h-11"
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

            <Button type="submit" size="lg" className="w-full" disabled={submitting || lockedOut}>
              {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {submitting ? t('login.submitting') : t('login.submit')}
            </Button>

            <div className="accent-rule opacity-40" />
            <p className="text-center text-xs leading-relaxed text-text-muted">{t('login.noSignup')}</p>
          </form>
        </div>
      </div>
    </div>
  );
}
