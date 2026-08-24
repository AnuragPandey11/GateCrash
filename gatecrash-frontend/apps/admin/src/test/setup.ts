import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './server';

/**
 * Test harness — FRONTEND.md §12.
 *
 * `onUnhandledRequest: 'error'` is deliberate: a screen that quietly calls an endpoint nobody
 * mocked is a screen making a request nobody reviewed. Failing loudly is how the shared MSW
 * handlers stay an accurate description of the contract.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// jsdom implements neither, and Radix uses both for positioning.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Radix's Select calls these while dragging a pointer over the listbox. No DOM implementation
// ships them, and without the stubs every Select interaction throws instead of opening.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
