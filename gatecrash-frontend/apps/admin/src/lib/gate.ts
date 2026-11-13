import type { GateId } from '@gatecrash/core';
import { create } from 'zustand';

/**
 * Which gate this device is standing at — the guard's one piece of device state.
 *
 * There is no guard-to-gate assignment in the schema yet (FRONTEND.md §15.3), so the guard picks
 * their gate on the console and the choice is remembered per device: the tablet at the service
 * gate keeps saying "Service Gate" across shift changes and reloads.
 */

const STORAGE_KEY = 'gc.gate';

function read(): GateId | null {
  try {
    return (localStorage.getItem(STORAGE_KEY) as GateId | null) || null;
  } catch {
    return null;
  }
}

interface GateStore {
  gateId: GateId | null;
  setGate: (gateId: GateId | null) => void;
}

export const useGateStore = create<GateStore>((set) => ({
  gateId: read(),
  setGate: (gateId) => {
    try {
      if (gateId) localStorage.setItem(STORAGE_KEY, gateId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode: lasts for the tab. Fine.
    }
    set({ gateId });
  },
}));
