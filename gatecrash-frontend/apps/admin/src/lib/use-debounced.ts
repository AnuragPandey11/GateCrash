import { useEffect, useState } from 'react';

/**
 * Debounce a value.
 *
 * Used by the audience preview (§8.5.3): every keystroke in a flat picker would otherwise fire a
 * `POST /notifications/preview`, and that endpoint runs the real `AudienceResolver` query.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
