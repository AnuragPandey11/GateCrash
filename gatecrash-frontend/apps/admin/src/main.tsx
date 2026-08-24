import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './lib/i18n';
import { bootstrapSession } from './lib/session';
import { initTheme } from './lib/theme';
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
