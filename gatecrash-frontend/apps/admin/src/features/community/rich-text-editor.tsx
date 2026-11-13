import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';

/**
 * The community post editor: Quill 2 with the Snow theme — the same editor quilljs.com demos.
 *
 * Quill owns its DOM, so it is created once into a node React never renders children into, and
 * the component is uncontrolled after mount: `initialValue` seeds it, `onChange` reports out. The
 * compose dialog unmounts on close, which is what gives every new post a fresh editor.
 *
 * What the toolbar can produce is exactly what `RichTextSanitizer` on the server allows through —
 * headings, the three default fonts, emphasis, lists, alignment, links, images, YouTube/Vimeo
 * video, quotes and code. Adding a button here without widening that allowlist ships a format
 * that silently disappears on publish.
 */

const TOOLBAR = [
  [{ header: [false, 1, 2, 3] }, { font: [] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }, { align: [] }],
  ['link', 'image', 'video'],
  ['blockquote', 'code-block'],
  ['clean'],
];

/** Raster only: SVG can carry script, and the server refuses it anyway. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/**
 * Images travel inline as data URIs until there is an upload endpoint (FRONTEND.md §15.1), and
 * every resident's feed downloads them with the post, so they are kept small.
 */
export const MAX_IMAGE_BYTES = 1_500_000;

export interface RichTextChange {
  /** Editor HTML, or '' when there is nothing in it (an empty Quill still holds `<p><br></p>`). */
  html: string;
  /** Visible characters, for the length hint. */
  textLength: number;
}

export function RichTextEditor({
  initialValue = '',
  placeholder,
  onChange,
  ariaLabel,
  invalid = false,
}: {
  initialValue?: string;
  placeholder?: string;
  onChange: (change: RichTextChange) => void;
  ariaLabel: string;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the effect below can run exactly once without going stale.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const messagesRef = useRef({ type: '', size: '' });
  messagesRef.current = {
    type: t('community.editor.imageType'),
    size: t('community.editor.imageTooLarge', { mb: (MAX_IMAGE_BYTES / 1_000_000).toFixed(1) }),
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const mount = host.appendChild(document.createElement('div'));

    const quill = new Quill(mount, {
      theme: 'snow',
      placeholder,
      modules: {
        toolbar: {
          container: TOOLBAR,
          handlers: {
            // Replaces Quill's default, which inlines any file of any size: this one checks the
            // type and size first, so a 12 MB photo never reaches a resident's feed.
            image: () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = IMAGE_TYPES.join(',');
              input.onchange = () => {
                const file = input.files?.[0];
                if (!file) return;
                if (!IMAGE_TYPES.includes(file.type)) {
                  toast.error(messagesRef.current.type);
                  return;
                }
                if (file.size > MAX_IMAGE_BYTES) {
                  toast.error(messagesRef.current.size);
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  const range = quill.getSelection(true);
                  quill.insertEmbed(range.index, 'image', reader.result, 'user');
                  quill.setSelection(range.index + 1, 0, 'silent');
                };
                reader.readAsDataURL(file);
              };
              input.click();
            },
          },
        },
      },
    });

    quill.root.setAttribute('aria-label', ariaLabel);
    quill.root.setAttribute('role', 'textbox');
    quill.root.setAttribute('aria-multiline', 'true');

    if (initialValue) {
      quill.clipboard.dangerouslyPasteHTML(initialValue, 'silent');
    }

    const report = () => {
      const text = quill.getText().trim();
      const hasEmbed = quill.root.querySelector('img, iframe') !== null;
      onChangeRef.current({
        html: text.length === 0 && !hasEmbed ? '' : quill.root.innerHTML,
        textLength: text.length,
      });
    };
    quill.on('text-change', report);

    return () => {
      quill.off('text-change', report);
      // Quill inserts its toolbar as a sibling of the mount node; clearing the host removes both,
      // which also keeps React StrictMode's double mount from leaving two toolbars behind.
      host.innerHTML = '';
    };
    // Mount once. initialValue/placeholder/ariaLabel are read at creation by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className="gc-rich-editor"
      data-invalid={invalid ? 'true' : undefined}
    />
  );
}
