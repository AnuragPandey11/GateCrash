import { Check, Copy, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The one-time credential hand-off — FRONTEND.md §8.7 and guardrail #3.
 *
 * `POST /admin/users` and `POST /admin/users/{id}/reset-password` return `generatedPassword`
 * **exactly once**. The server stores only a BCrypt hash; if this dialog is dismissed without
 * the password being recorded, the account is unusable and has to be reset again.
 *
 * So the rules here are strict and deliberate:
 *
 *  - The password lives in this component's props and **nowhere else**. Not the query cache, not
 *    a store, not a log, not an analytics event, not a URL. It dies when the dialog unmounts.
 *  - `mandatory` disables Esc and backdrop dismissal. The only exit is the explicit
 *    "I have saved these credentials" button — an accidental Esc here strands an account.
 *  - Print uses the browser's own print of a dedicated node, so nothing is uploaded anywhere.
 */

export interface CredentialDialogProps {
  open: boolean;
  loginId: string;
  password: string;
  fullName: string;
  /**
   * The township code the holder types alongside their login id.
   *
   * Not decoration: login ids are unique only within a township, so the code is half the
   * credential. A hand-off card that omits it is a card nobody can sign in with. Omitted only for a
   * SUPER_ADMIN, which belongs to no township and signs in with the field blank.
   */
  townshipCode?: string | null;
  /** True for a reset rather than a fresh account — the copy differs. */
  isReset?: boolean;
  onDismiss: () => void;
}

export function CredentialDialog({
  open,
  loginId,
  password,
  fullName,
  townshipCode = null,
  isReset = false,
  onDismiss,
}: CredentialDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent mandatory className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isReset ? t('users.credentials.resetTitle') : t('users.credentials.title')}
          </DialogTitle>
          <DialogDescription>
            {isReset
              ? t('users.credentials.resetBody')
              : t('users.credentials.body', { name: fullName })}
          </DialogDescription>
        </DialogHeader>

        <div id="credential-printable" className="space-y-3">
          {townshipCode ? (
            <CredentialRow label={t('users.credentials.townshipCode')} value={townshipCode} />
          ) : (
            <p className="text-xs text-text-muted">{t('users.credentials.noTownship')}</p>
          )}
          <CredentialRow label={t('users.credentials.loginId')} value={loginId} />
          <CredentialRow label={t('users.credentials.password')} value={password} />
          <p className="text-xs text-text-muted">{t('users.credentials.mustChange')}</p>
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              printCredentials({
                heading: fullName,
                townshipCode,
                loginId,
                password,
                townshipLabel: t('users.credentials.townshipCode'),
                loginLabel: t('users.credentials.loginId'),
                passwordLabel: t('users.credentials.password'),
                note: t('users.credentials.mustChange'),
              });
            }}
          >
            <Printer aria-hidden />
            {t('users.credentials.print')}
          </Button>
          <Button onClick={onDismiss}>{t('users.credentials.acknowledge')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard is permission-gated and blocked on insecure origins. The value is on screen
      // in a selectable font, so failing to copy is an inconvenience, not a dead end.
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface-raised p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <div className="flex items-center justify-between gap-2">
        <code className="font-credential select-all break-all text-lg text-text">{value}</code>
        <Button variant="ghost" size="icon" onClick={() => void copy()} aria-label={t('common.copy')}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Print via a detached iframe.
 *
 * `window.print()` on the page itself would print the whole dashboard behind the dialog. Writing
 * a minimal document into an iframe keeps the output to the credentials — and keeps the password
 * inside this browser, which a "generate a PDF server-side" approach would not.
 */
function printCredentials(data: {
  heading: string;
  townshipCode: string | null;
  loginId: string;
  password: string;
  townshipLabel: string;
  loginLabel: string;
  passwordLabel: string;
  note: string;
}): void {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }

  const escapeHtml = (value: string) =>
    value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>GateCrash credentials</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 32px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #555; margin: 0 0 24px; font-size: 13px; }
  dt { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #555; }
  dd { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 20px;
       letter-spacing: .08em; margin: 2px 0 16px; }
  footer { margin-top: 24px; font-size: 12px; color: #555; }
</style></head><body>
  <h1>GateCrash account</h1>
  <p class="sub">${escapeHtml(data.heading)}</p>
  <dl>
    ${
      data.townshipCode
        ? `<dt>${escapeHtml(data.townshipLabel)}</dt><dd>${escapeHtml(data.townshipCode)}</dd>`
        : ''
    }
    <dt>${escapeHtml(data.loginLabel)}</dt><dd>${escapeHtml(data.loginId)}</dd>
    <dt>${escapeHtml(data.passwordLabel)}</dt><dd>${escapeHtml(data.password)}</dd>
  </dl>
  <footer>${escapeHtml(data.note)}</footer>
</body></html>`);
  doc.close();

  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // Give the print dialog time to take its snapshot before the node disappears.
  setTimeout(() => document.body.removeChild(frame), 1_000);
}
