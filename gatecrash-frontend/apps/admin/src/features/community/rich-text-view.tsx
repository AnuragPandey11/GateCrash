import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

/**
 * Renders a community post body.
 *
 * The server already reduced the HTML to an allowlist before storing it (`RichTextSanitizer`).
 * This sanitises again on the way to the screen: defence in depth, and protection for any row that
 * predates the server-side pass or arrives through some future path that forgets it.
 *
 * Rendered inside Quill's own `ql-snow ql-editor` classes so alignment, indentation, fonts and
 * Quill 2's `<li data-list>` lists look exactly as they did in the editor.
 */

const VIDEO_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'player.vimeo.com',
]);

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  // Iframes are allowed only as video embeds from the hosts the server also allows.
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'iframe') return;
    const src = (node as Element).getAttribute('src') ?? '';
    let ok = false;
    try {
      const url = new URL(src);
      ok = url.protocol === 'https:' && VIDEO_HOSTS.has(url.hostname);
    } catch {
      ok = false;
    }
    if (!ok) (node as Element).remove();
  });
  // Links always open in a new tab without handing the opener over.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

export function sanitizePostHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'target', 'data-list'],
    FORBID_ATTR: ['style'],
  });
}

export function RichTextView({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizePostHtml(html), [html]);
  return (
    <div className={cn('ql-snow', className)}>
      <div className="ql-editor gc-rich-view" dangerouslySetInnerHTML={{ __html: clean }} />
    </div>
  );
}
