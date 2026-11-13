import { ApiProvider } from '@gatecrash/api';
import { RealtimeProvider, sockJsUrl, type RealtimeFrame } from '@gatecrash/realtime';
import { BrowserRouter } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@/components/toaster';
import { play } from '@/lib/chime';
import { API_URL } from '@/lib/env';
import { useGateStore } from '@/lib/gate';
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
  // The occupancy topic is keyed by township, so the socket needs to know which one this session
  // is looking at. For a super admin that is whatever the console has selected; for everyone else
  // it is simply their own, seeded from `me`.
  const townshipId = useSessionStore((s) =>
    s.state === 'authenticated' ? ((s.actingTownshipId as never) ?? null) : null,
  );

  // The account's sales flag adds its personal visit queue; a guard's chosen gate is its topic.
  const sales = useSessionStore((s) => s.me?.sales ?? false);
  const gateId = useGateStore((s) => s.gateId);

  const onEvent = useCallback(
    (frame: RealtimeFrame) => {
      const role = useSessionStore.getState().me?.role;
      switch (frame.type) {
        case 'OCCUPANCY_CHANGED': {
          // §8.3: a subtle, auto-dismissing toast with entry/exit direction, capped at 3 stacked.
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
          break;
        }
        case 'VISIT_REQUESTED': {
          // Resident or sales agent: someone is at the gate for them. The card is on Home already
          // (the dispatcher refreshed it); this makes sure they notice.
          play('doorbell');
          toast.show({
            title: t('portal.alerts.atGate', { name: frame.visitorName, gate: frame.gateName }),
            tone: 'info',
            durationMs: 8_000,
          });
          break;
        }
        case 'OVERSTAY_ALERT': {
          if (role === 'GUARD') play('alarm');
          toast.show({
            title: t('portal.alerts.overstay', { name: frame.visitorName }),
            description:
              role === 'RESIDENT'
                ? t('portal.alerts.overstayResident')
                : t('portal.alerts.overstayGuard', { unit: frame.flatNumber ?? '—' }),
            tone: 'danger',
            durationMs: 12_000,
          });
          break;
        }
        case 'VISIT_EXTENDED': {
          toast.show({
            title: t('portal.alerts.extended', { name: frame.visitorName, by: frame.extendedByName ?? '' }),
            tone: 'info',
            durationMs: 6_000,
          });
          break;
        }
        case 'SERVICE_UPDATE': {
          toast.show({ title: frame.title, description: frame.body ?? undefined, tone: 'info', durationMs: 7_000 });
          break;
        }
        default:
          break;
      }
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
        townshipId={townshipId}
        selectedGateId={role === 'GUARD' ? (gateId as never) : null}
        sales={sales}
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
