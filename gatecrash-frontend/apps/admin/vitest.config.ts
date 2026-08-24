import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The app's env guard throws at import time when VITE_API_URL is missing (§13.1) — which is
  // the behaviour we want in a real deploy, and which the test run has to satisfy like any
  // other consumer. Must match `TEST_API_URL` in src/test/server.ts.
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('http://localhost:8080'),
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(''),
  },
  test: {
    globals: true,
    // happy-dom rather than jsdom, for one concrete reason: jsdom supplies its own
    // `AbortController`/`AbortSignal` but no `fetch`, so requests end up with a jsdom signal
    // handed to Node's undici `fetch`, which rejects it ("Expected signal to be an instance of
    // AbortSignal"). happy-dom provides the whole fetch stack from one realm, so every request
    // the app makes under test behaves like it does in a browser.
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
