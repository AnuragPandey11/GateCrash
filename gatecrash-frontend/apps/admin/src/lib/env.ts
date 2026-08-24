/**
 * Environment — FRONTEND.md §13.1.
 *
 * One var, `VITE_API_URL`, never a hardcoded host. Read once and validated at module load so a
 * misconfigured deploy fails loudly at boot rather than as a confusing blank page after login.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and point it at the backend.`,
    );
  }
  return value;
}

export const API_URL = required('VITE_API_URL', import.meta.env.VITE_API_URL).replace(/\/+$/, '');

export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || null;

export const IS_DEV = import.meta.env.DEV;

if (!IS_DEV && !API_URL.startsWith('https://')) {
  // The backend's `StartupSecretsValidator` refuses a non-https CORS origin outside local, so a
  // mixed-scheme setup fails at the *server* with an error that points nowhere near the cause.
  throw new Error('VITE_API_URL must use https outside local development.');
}
