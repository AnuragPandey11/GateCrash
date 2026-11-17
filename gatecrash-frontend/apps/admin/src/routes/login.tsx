import { isApiException, loginRequestSchema, type LoginRequest } from '@gatecrash/api';
import { CLIENT_LIMITS } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, BellRing, Building2, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Trans, useTranslation } from 'react-i18next';
import { BrandTile, OakshadeEndorsement } from '@/components/brand';
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

  const capabilities = t('login.capabilities', { returnObjects: true });

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      {/* The brand panel — an Oakshade ink section, inset with its big rounded corners.
          Decorative and informational only — nothing here is interactive, so a keyboard user
          lands straight in the form. */}
      <aside
        aria-hidden
        className="ink-panel relative hidden overflow-hidden text-sidebar-fg lg:m-3 lg:flex lg:flex-col lg:rounded-[2.5rem] lg:border lg:border-sidebar-border"
      >
        <div className="flex items-center justify-between gap-4 px-12 pt-11 animate-enter xl:px-14">
          <div className="flex items-center gap-3">
            <BrandTile size="lg" inverse />
            <div className="leading-tight">
              <p className="font-display text-[1.375rem]">{t('common.appName')}</p>
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-sidebar-muted">
                {t('nav.tagline')}
              </p>
            </div>
          </div>
          {/* Oakshade's chip: hairline pill on a whisper of white. */}
          <OakshadeEndorsement
            inverse
            className="rounded-full border border-sidebar-fg/15 bg-sidebar-fg/5 px-4 py-2 text-xs font-medium text-sidebar-fg/70"
          />
        </div>

        <div className="flex flex-1 flex-col justify-center px-12 py-12 xl:px-14">
          <div className="max-w-xl space-y-6">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.25em] text-sidebar-fg/50 animate-enter [animation-delay:80ms]">
              {t('login.heroEyebrow')}
            </p>
            <h2 className="font-display text-[3.25rem] leading-[1.04] text-sidebar-fg xl:text-[3.75rem]">
              <span className="reveal-line">
                <span className="[animation-delay:120ms]">
                  <Trans
                    i18nKey="login.heroTitle"
                    components={{ em: <em className="serif-accent text-sidebar-fg/85" /> }}
                  />
                </span>
              </span>
            </h2>
            <p className="max-w-lg text-base leading-relaxed text-sidebar-fg/60 animate-enter [animation-delay:260ms]">
              {t('login.heroBody')}
            </p>
            <ul className="stagger space-y-3 pt-2">
              {(
                [
                  [ShieldCheck, 'login.heroPoint1'],
                  [BellRing, 'login.heroPoint2'],
                  [Building2, 'login.heroPoint3'],
                ] as const
              ).map(([Icon, key]) => (
                <li key={key} className="flex items-center gap-3.5 text-sm text-sidebar-fg/85">
                  <span className="flex size-9 items-center justify-center rounded-xl border border-sidebar-fg/10 bg-sidebar-fg/[0.06]">
                    <Icon className="size-4" />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* What the suite does, drifting past — Oakshade's slow marquee with fading edges. */}
        <div className="marquee-mask overflow-hidden border-y border-sidebar-fg/10 py-4">
          <div className="flex w-max animate-marquee">
            {[0, 1].map((copy) => (
              <ul key={copy} className="flex shrink-0 items-center">
                {capabilities.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-6 pr-6 text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-fg/45"
                  >
                    {item}
                    <span className="size-1 rounded-full bg-sidebar-fg/30" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <p className="px-12 pt-5 text-xs text-sidebar-muted/80 xl:px-14">{t('login.heroFooter')}</p>

        {/* The giant wordmark, cropped by the panel's foot and fading into the ink. */}
        <p className="wordmark-giant -mb-[1.6vw] mt-2 text-center text-[clamp(5rem,10.5vw,11rem)]">
          {t('common.appName')}
        </p>
      </aside>

      <div className="relative flex flex-col items-center justify-center p-6 sm:p-10">
        {/* Light / dark, before signing in too. Top-right of the form side, which is the only side
            a phone shows. */}
        <ThemeToggle className="absolute right-4 top-4 size-10 sm:right-6 sm:top-6" />
        <div className="w-full max-w-[25rem] space-y-9">
          <div className="space-y-3.5">
            <div className="mb-8 flex items-center gap-3 animate-enter lg:hidden">
              <BrandTile />
              <span className="font-display text-2xl text-text">{t('common.appName')}</span>
            </div>
            <p className="eyebrow animate-enter">{t('login.eyebrow')}</p>
            <h1 className="font-display text-[2.5rem] leading-[1.05] text-text">
              <span className="reveal-line">
                <span className="[animation-delay:60ms]">{t('login.title')}</span>
              </span>
            </h1>
            <p className="text-sm text-text-muted animate-enter [animation-delay:120ms]">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-5 animate-enter [animation-delay:180ms]" noValidate>
            {endedReason && !formError ? (
              <p className="rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text-muted animate-pop-in">
                {t('errors.UNAUTHORIZED')}
              </p>
            ) : null}

            {formError ? (
              <p
                role="alert"
                className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger animate-pop-in"
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
              {submitting ? null : <ArrowRight aria-hidden />}
            </Button>

            <div className="accent-rule" />
            <p className="text-center text-xs leading-relaxed text-text-muted">{t('login.noSignup')}</p>
          </form>
        </div>

        <OakshadeEndorsement className="mt-14 text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-text-muted lg:absolute lg:bottom-8 lg:mt-0" />
      </div>
    </div>
  );
}
