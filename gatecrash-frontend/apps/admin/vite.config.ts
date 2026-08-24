import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    // `sockjs-client` is a browserify-era package: `lib/entry.js` reads `'_sockjs_onload' in
    // global` at module top level, and `global` does not exist in a browser ESM context. Without
    // this the whole app dies on a blank screen with `ReferenceError: global is not defined`
    // before React ever mounts.
    //
    // We need SockJS specifically — `WebSocketConfig` registers `/ws` with `.withSockJS()` only
    // (FRONTEND.md §6.2) — so the shim is the fix rather than swapping the transport.
    global: 'globalThis',
  },
  optimizeDeps: {
    // Workspace packages are symlinked TypeScript sources, not published builds — let Vite's
    // transform pipeline handle them instead of trying to pre-bundle them as dependencies.
    exclude: ['@gatecrash/api', '@gatecrash/core', '@gatecrash/realtime'],
    esbuildOptions: {
      // The top-level `define` above does NOT reach dependency pre-bundling — esbuild builds
      // `.vite/deps` separately, so `sockjs-client` kept its bare `global` and the app still died
      // on a blank screen. Both are required: this one shims the prebundle, the other shims our
      // own source.
      define: { global: 'globalThis' },
    },
  },
  server: {
    port: 5173,
    // The backend's CORS allowlist must contain this exact origin — scheme + host + port, no
    // wildcard (the config rejects `*` at boot). It is the most common "works locally, blank
    // page in staging" cause (§13.1).
    strictPort: true,
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Split the stable third-party layers out of the app chunk: they change on a dependency
        // bump, the app chunk changes on every deploy, and separating them means a routine
        // release does not invalidate 400kB of cached vendor code.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-table'],
          // Only the app's own direct deps: pnpm's strict layout means a transitive
          // like @stomp/stompjs is not resolvable from here.
          sockjs: ['sockjs-client'],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
