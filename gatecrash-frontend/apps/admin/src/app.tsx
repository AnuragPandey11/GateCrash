import { ApiProvider } from '@gatecrash/api';
import { RealtimeProvider, sockJsUrl, type RealtimeFrame } from '@gatecrash/realtime';
import { BrowserRouter } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@/components/toaster';
import { API_URL } from '@/lib/env';
import { apiClient, queryClient, sessionManager, useSessionStore } from '@/lib/session';
import { toast } from '@/lib/toast';
import { AppRoutes } from '@/routes';

/**
 * Provider wiring.
 *
 * The transport is SockJS because `WebSocketConfig` registers `/ws` with `.withSockJS()` only
 * (§6.2). On the web that is not a workaround — SockJS is the endpoint's actual contract. Mobile
 * is the side that has to reach for `/ws/websocket`, and §15.2 tracks fixing that.
 */
export function App() {
  const { t } = useTranslation();

  // The socket connects only in `authenticated`. In `mustResetPassword` the STOMP interceptor
  // refuses CONNECT outright, so attempting it would be a guaranteed failure loop (§5.1).
  const role = useSessionStore((s) => (s.state === 'authenticated' ? (s.me?.role ?? null) : null));

  const onEvent = useCallback(
    (frame: RealtimeFrame) => {
      // §8.3: a subtle, auto-dismissing toast with entry/exit direction, capped at 3 stacked.
      if (frame.type !== 'OCCUPANCY_CHANGED') return;
      const entering = frame.status === 'CHECKED_IN';
      toast.show({
        title: t(entering ? 'occupancy.entered' : 'occupancy.left', {
          name: frame.visitorName,
          gate: frame.gateName,
        }),
        tone: entering ? 'info' : 'default',
        group: 'occupancy',
        durationMs: 3_000,
      });
    },
    [t],
  );

  return (
    <ApiProvider client={apiClient} queryClient={queryClient}>
      <RealtimeProvider
        transport={{ kind: 'sockjs', factory: () => new SockJS(sockJsUrl(API_URL)) as never }}
        getAccessToken={() => sessionManager.getAccessToken()}
        refreshAccessToken={() => sessionManager.refreshOnce()}
        role={role}
        onEvent={onEvent}
      >
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        <Toaster />
      </RealtimeProvider>
    </ApiProvider>
  );
}
