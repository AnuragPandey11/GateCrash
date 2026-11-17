import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './lib/i18n';
import { bootstrapSession } from './lib/session';
import { initTheme } from './lib/theme';
// Self-hosted type: no request to a font CDN, nothing for a CSP to block, works offline.
// The Oakshade pairing — see `fontFamily` in the shared Tailwind preset. Manrope stands in for
// Inter until `@fontsource-variable/inter` is added; then import it here and the stack picks it up.
import '@fontsource-variable/manrope';
// Playfair Display is only ever set in italic, for a single emphasised phrase.
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/500-italic.css';
import './styles/index.css';

// Before first paint, so there is no flash of the wrong theme.
initTheme();

// Fire and forget: the session store starts in `loading`, and the router renders a spinner until
// this resolves one way or the other (§5.4).
void bootstrapSession();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
