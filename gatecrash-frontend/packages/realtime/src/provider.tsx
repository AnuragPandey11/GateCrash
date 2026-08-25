import type { GateId, TownshipId, UserRole } from '@gatecrash/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { RealtimeClient, type ConnectionTransport } from './client';
import { createFrameDispatcher, reconcile } from './dispatcher';
import type { RealtimeFrame } from './frames';
import { useShallow } from 'zustand/react/shallow';
import { useConnectionStore, type ConnectionStatus } from './status';

/**
 * React wiring for the realtime layer.
 *
 * The provider owns exactly one `RealtimeClient`, connects it when there is a session and a role,
 * and disconnects it on logout or when the session enters `MUST_RESET_PASSWORD` — the interceptor
 * refuses CONNECT in that state, so attempting it would be a guaranteed failure loop (§5.1).
 */

interface RealtimeContextValue {
  client: RealtimeClient | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({ client: null });

export interface RealtimeProviderProps {
  transport: ConnectionTransport;
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<unknown>;
  /** Null while unauthenticated or mid-password-reset — the client stays disconnected. */
  role: UserRole | null;
  /**
   * The township whose live feeds to subscribe to. For every role but SUPER_ADMIN this is the
   * session's own township; for a super admin it is the one they have selected in the console, and
   * until they select one there is nothing to subscribe to — the occupancy destination carries the
   * township id, so there is no tenant-agnostic form of it to fall back on.
   */
  townshipId?: TownshipId | null;
  /** GUARD: the gate this device stands at. ADMIN: gates the current screen watches. */
  selectedGateId?: GateId | null;
  watchedGateIds?: readonly GateId[];
  /** Non-cache side effects: the occupancy toast, the guard's haptic and tone. */
  onEvent?: (frame: RealtimeFrame) => void;
  children: ReactNode;
}

export function RealtimeProvider({
  transport,
  getAccessToken,
  refreshAccessToken,
  role,
  townshipId = null,
  selectedGateId = null,
  watchedGateIds,
  onEvent,
  children,
}: RealtimeProviderProps) {
  const queryClient = useQueryClient();

  // Held in refs so changing a handler never tears down a live socket.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const getTokenRef = useRef(getAccessToken);
  getTokenRef.current = getAccessToken;
  const refreshRef = useRef(refreshAccessToken);
  refreshRef.current = refreshAccessToken;

  const client = useMemo(() => {
    const dispatch = createFrameDispatcher(queryClient, {
      onEvent: (frame) => onEventRef.current?.(frame),
    });
    return new RealtimeClient({
      transport,
      getAccessToken: () => getTokenRef.current(),
      refreshAccessToken: () => refreshRef.current(),
      onFrame: dispatch,
      onReconnect: () => reconcile(queryClient),
    });
    // `transport` is stable for an app's lifetime; rebuilding the client on a re-render would
    // drop the socket on every parent update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  const gateKey = watchedGateIds?.join(',') ?? '';

  useEffect(() => {
    if (!role) {
      client.disconnect();
      return;
    }
    client.connect(role, {
      townshipId,
      selectedGateId,
      watchedGateIds: watchedGateIds ?? [],
    });
    return () => client.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, role]);

  // A gate or township change re-subscribes without dropping the socket. A super admin switching
  // township in the console is exactly this path: same connection, different occupancy topic.
  useEffect(() => {
    if (!role) return;
    client.updateContext({ townshipId, selectedGateId, watchedGateIds: watchedGateIds ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, role, townshipId, selectedGateId, gateKey]);

  // The other half of guardrail #7: window focus reconciles even if the socket never dropped.
  useEffect(() => {
    if (!role || typeof window === 'undefined') return;
    const onFocus = () => reconcile(queryClient);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [queryClient, role]);

  const value = useMemo<RealtimeContextValue>(() => ({ client }), [client]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeClient | null {
  return useContext(RealtimeContext).client;
}

export function useConnectionStatus(): ConnectionStatus {
  // `useShallow` is not optional here: this selector builds a fresh object every call, and
  // zustand v5 compares with `Object.is`, so without it every store write re-renders every
  // consumer forever.
  return useConnectionStore(
    useShallow((s) => ({
      state: s.state,
      attempts: s.attempts,
      connectedAt: s.connectedAt,
      lastMessageAt: s.lastMessageAt,
      lastError: s.lastError,
    })),
  );
}
