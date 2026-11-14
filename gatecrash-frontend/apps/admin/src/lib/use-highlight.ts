import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * `?highlight=<id>` support: once the list has rendered (`ready`), scroll the element marked
 * `data-highlight-id="<id>"` into view and report it as highlighted for a few seconds — long
 * enough for the blink to be seen. The parameter is then dropped, so opening the same item from
 * the bell again blinks it again.
 */
export function useHighlight(ready: boolean, durationMs = 3600): string | null {
  const [params, setParams] = useSearchParams();
  const target = params.get('highlight');
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!target || !ready) return undefined;
    setActive(target);
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-highlight-id="${target}"]`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
    const timer = setTimeout(() => {
      setActive(null);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('highlight');
          return next;
        },
        { replace: true },
      );
    }, durationMs);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [target, ready, durationMs, setParams]);

  return active;
}
