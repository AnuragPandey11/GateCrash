import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useRouteError } from 'react-router-dom';
import i18n from '@/lib/i18n';
import { Button } from './ui/button';

/**
 * Error boundaries — FRONTEND.md §11.4: one per route, with a Reload action.
 *
 * Per-route rather than one at the root: a crash in the notification composer should not take
 * the occupancy board down with it. The admin can navigate away and keep working.
 *
 * Note what is *not* here: any breadcrumb, log line or crash-report payload. When a reporter is
 * wired in (§11.4), it needs a scrubber that drops `password`, `pin`, `generatedPassword`,
 * `fcmToken`, `accessToken` and `refreshToken` before anything leaves the browser.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only until a reporter with the §11.4 scrubber is configured.
    console.error('Route crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorScreen error={this.state.error} onReset={() => this.setState({ error: null })} />
    );
  }
}

function ErrorScreen({ error, onReset }: { error: Error; onReset?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <h2 className="text-lg font-semibold text-text">{i18n.t('errors.boundary.title')}</h2>
      <p className="max-w-md text-sm text-text-muted">{i18n.t('errors.boundary.body')}</p>
      <Button variant="secondary" onClick={() => (onReset ? onReset() : window.location.reload())}>
        {i18n.t('errors.boundary.reload')}
      </Button>
      <details className="mt-2 max-w-lg text-left">
        <summary className="cursor-pointer text-xs text-text-muted">
          {i18n.t('errors.boundary.details')}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-raised p-3 text-xs text-text-muted">
          {error.message}
        </pre>
      </details>
    </div>
  );
}

/** The router's `errorElement`, for failures thrown by a loader rather than during render. */
export function RouteErrorElement() {
  const error = useRouteError();
  return <ErrorScreen error={error instanceof Error ? error : new Error(String(error))} />;
}
