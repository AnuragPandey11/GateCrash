import { create } from 'zustand';

/**
 * Toasts — FRONTEND.md §11.1.
 *
 * Deliberately tiny and app-owned rather than a dependency: the requirements are specific
 * (occupancy toasts stack at most 3 per §8.3, and error toasts carry a copyable correlation id
 * per §11.3), and those are easier to honour in 60 lines than to configure into a library.
 */

export type ToastTone = 'default' | 'success' | 'danger' | 'warning' | 'info';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** Rendered small and copyable — this is how a support ticket becomes a log line (§11.3). */
  correlationId?: string | null;
  durationMs: number;
  /** Toasts sharing a group are capped together, so a busy gate cannot bury the screen. */
  group?: string;
}

export interface ToastInput extends Partial<Omit<Toast, 'id' | 'title'>> {
  title: string;
}

/** §8.3 caps the occupancy stack at 3; the same cap is a sane default for every group. */
const MAX_PER_GROUP = 3;
const MAX_TOTAL = 5;

interface ToastStore {
  toasts: Toast[];
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  push: (input) => {
    const id = `toast-${++counter}`;
    const toast: Toast = {
      id,
      tone: 'default',
      durationMs: input.tone === 'danger' ? 8_000 : 4_000,
      ...input,
    };

    set((state) => {
      let next = [...state.toasts, toast];
      if (toast.group) {
        const inGroup = next.filter((t) => t.group === toast.group);
        if (inGroup.length > MAX_PER_GROUP) {
          const dropping = new Set(inGroup.slice(0, inGroup.length - MAX_PER_GROUP).map((t) => t.id));
          next = next.filter((t) => !dropping.has(t.id));
        }
      }
      if (next.length > MAX_TOTAL) next = next.slice(next.length - MAX_TOTAL);
      return { toasts: next };
    });

    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  show: (input: ToastInput) => useToastStore.getState().push(input),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, tone: 'success' }),
  error: (title: string, description?: string, correlationId?: string | null) =>
    useToastStore.getState().push({ title, description, tone: 'danger', correlationId }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, tone: 'info' }),
};
