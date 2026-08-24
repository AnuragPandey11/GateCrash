import { create } from 'zustand';

/**
 * Connection status — FRONTEND.md §10.4.
 *
 * This is a **functional control, not decoration**. A silent dead socket looks exactly like a
 * quiet gate, and a guard who cannot tell the difference will stand there believing the resident
 * has not answered yet. So the state is explicit, it is rendered, and it records *when* the last
 * frame arrived so an offline pill can say "showing data from 14:32" rather than just "offline".
 */

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ConnectionStatus {
  state: ConnectionState;
  /** Consecutive failed connect attempts. Drives the backoff and the copy. */
  attempts: number;
  /** When the socket last successfully connected. */
  connectedAt: number | null;
  /** When we last heard *anything* — a frame or a successful connect. */
  lastMessageAt: number | null;
  /** Last failure reason, for the pill's detail popover. Never shown as a bare error. */
  lastError: string | null;
}

export interface ConnectionStore extends ConnectionStatus {
  setState: (state: ConnectionState, error?: string | null) => void;
  noteAttempt: () => void;
  noteConnected: () => void;
  noteMessage: () => void;
  reset: () => void;
}

const INITIAL: ConnectionStatus = {
  state: 'idle',
  attempts: 0,
  connectedAt: null,
  lastMessageAt: null,
  lastError: null,
};

export const useConnectionStore = create<ConnectionStore>((set) => ({
  ...INITIAL,
  setState: (state, error) =>
    set((prev) => ({ state, lastError: error === undefined ? prev.lastError : error })),
  noteAttempt: () => set((prev) => ({ attempts: prev.attempts + 1, state: 'reconnecting' })),
  noteConnected: () =>
    set({
      state: 'connected',
      attempts: 0,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
      lastError: null,
    }),
  noteMessage: () => set({ lastMessageAt: Date.now() }),
  reset: () => set(INITIAL),
}));

/** True when the app should be showing a "data may be stale" affordance. */
export function isDegraded(status: Pick<ConnectionStatus, 'state'>): boolean {
  return status.state === 'reconnecting' || status.state === 'offline';
}
