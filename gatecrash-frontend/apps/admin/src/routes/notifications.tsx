import {
  PAGE_DEFAULTS,
  useAudiencePreview,
  useNotificationHistory,
  useSendNotification,
  type PageArgs,
} from '@gatecrash/api';
import {
  CLIENT_LIMITS,
  audienceRuleKey,
  buildAudienceRule,
  describeAudienceRule,
  formatDateTime,
  validateAudienceRule,
  type AudienceRule,
} from '@gatecrash/core';
import * as Tabs from '@radix-ui/react-tabs';
import { Loader2, Megaphone, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { NotifStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CharCount, Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { AudienceBuilder } from '@/features/notifications/audience-builder';
import { cn } from '@/lib/cn';
import { errorMessage, toastError } from '@/lib/errors';
import { useDebounced } from '@/lib/use-debounced';
import { toast } from '@/lib/toast';

const TITLE_MAX = 200;
const BODY_MAX = 2000;

/**
 * The notification composer — FRONTEND.md §8.5.
 *
 * The screen with the most damage potential in the product: it makes thousands of phones buzz,
 * at once, with no undo. Everything here is designed around making the blast radius visible
 * *before* the click, not explaining it afterwards.
 *
 * The load-bearing rule: **Send stays disabled until a preview has resolved for the rule
 * currently in the form.** `audienceRuleKey` is what makes "currently" checkable — without it, an
 * admin could edit the audience after the preview resolved and send a rule whose reach nobody
 * ever saw.
 */
export function NotificationsRoute() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('notifications.title')} description={t('notifications.subtitle')} />
      <Tabs.Root defaultValue="compose">
        <Tabs.List className="mb-4 flex gap-1 border-b border-border">
          {(['compose', 'history'] as const).map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {t(`notifications.tabs.${tab}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="compose">
          <Composer />
        </Tabs.Content>
        <Tabs.Content value="history">
          <History />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function Composer() {
  const { t } = useTranslation();
  const send = useSendNotification();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [rule, setRule] = useState<AudienceRule>({ mode: 'ALL' });
  const [flatSearch, setFlatSearch] = useState('');
  const [confirming, setConfirming] = useState(false);

  const ruleError = validateAudienceRule(rule);
  const normalised = useMemo(() => buildAudienceRule(rule), [rule]);
  const currentKey = audienceRuleKey(rule);

  // Debounced so a flat picker does not fire the resolver on every keystroke (§8.5.3).
  const debouncedRule = useDebounced(normalised, CLIENT_LIMITS.audiencePreviewDebounceMs);
  const debouncedKey = audienceRuleKey(debouncedRule);
  const preview = useAudiencePreview(debouncedRule, ruleError === null);

  // The preview on screen describes the rule in the form only when both the debounce has caught
  // up *and* the request for that rule has resolved.
  const previewIsCurrent = debouncedKey === currentKey && preview.isSuccess;
  const recipientCount = preview.data?.recipientCount ?? 0;
  const deviceCount = preview.data?.deviceCount ?? 0;

  const titleValid = title.trim().length > 0 && title.length <= TITLE_MAX;
  const bodyValid = body.trim().length > 0 && body.length <= BODY_MAX;
  const canSend =
    titleValid && bodyValid && ruleError === null && previewIsCurrent && !send.isPending;

  const doSend = async () => {
    try {
      await send.mutateAsync({ title: title.trim(), body: body.trim(), audienceRule: normalised });
      toast.success(t('notifications.compose.sent', { count: recipientCount }));
      setTitle('');
      setBody('');
      setRule({ mode: 'ALL' });
      setConfirming(false);
    } catch (error) {
      // The form stays filled — never clear user input on error (§11.1).
      setConfirming(false);
      toastError(error, t);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.compose.messageTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label={t('notifications.compose.messageTitle')}
              hint={<CharCount value={title} max={TITLE_MAX} />}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('notifications.compose.titlePlaceholder')}
                />
              )}
            </Field>

            <Field
              label={t('notifications.compose.messageBody')}
              hint={<CharCount value={body} max={BODY_MAX} />}
              required
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={body}
                  maxLength={BODY_MAX}
                  rows={6}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('notifications.compose.bodyPlaceholder')}
                />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('notifications.compose.audience')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AudienceBuilder
              rule={rule}
              onChange={setRule}
              error={ruleError}
              flatSearch={flatSearch}
              onFlatSearchChange={setFlatSearch}
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <PhonePreview title={title} body={body} />

        <Card>
          <CardContent className="space-y-3">
            {ruleError ? (
              <p className="text-sm text-text-muted">—</p>
            ) : preview.isError ? (
              <p className="text-sm text-danger">{errorMessage(preview.error, t)}</p>
            ) : preview.isPending || !previewIsCurrent ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                {preview.isFetching
                  ? t('notifications.compose.reachPending')
                  : t('notifications.compose.reachStale')}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-lg font-semibold text-text">
                  {t('notifications.compose.reachPeople', { count: recipientCount })}
                  <span className="px-1 text-text-muted">·</span>
                  <span className="font-normal text-text-muted">
                    {t('notifications.compose.reachDevices', { count: deviceCount })}
                  </span>
                </p>
                {/* Surfacing both numbers is how an admin sees that a blast reaches accounts
                    which cannot receive it (§8.5.3). */}
                {deviceCount < recipientCount ? (
                  <p className="text-xs text-text-muted">
                    {t('notifications.compose.noDevices', {
                      count: recipientCount - deviceCount,
                    })}
                  </p>
                ) : null}
              </div>
            )}

            <Button className="w-full" disabled={!canSend} onClick={() => setConfirming(true)}>
              <Send aria-hidden />
              {previewIsCurrent
                ? t('notifications.compose.sendWithCount', { count: recipientCount })
                : t('notifications.compose.send')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('notifications.compose.confirmTitle')}</DialogTitle>
            {/* The count is restated here, and "there is no way to unsend it" is said out loud
                (§8.5.4) — the second click is deliberate, not typed. */}
            <DialogDescription>
              {t('notifications.compose.confirmBody', {
                people: recipientCount,
                devices: deviceCount,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-surface-raised p-3">
            <p className="font-medium text-text">{title}</p>
            <p className="whitespace-pre-wrap text-sm text-text-muted">{body}</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={send.isPending}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void doSend()} disabled={send.isPending}>
              {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {send.isPending
                ? t('notifications.compose.sending')
                : t('notifications.compose.sendWithCount', { count: recipientCount })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A phone-shaped preview of the heads-up.
 *
 * Not decoration: admins write differently when they can see the truncation. The two-line clamp
 * approximates what an Android heads-up actually shows.
 */
function PhonePreview({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t('notifications.compose.preview')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-surface-raised p-3">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-fg">
              <Megaphone className="size-3.5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-muted">{t('common.appName')}</p>
              <p className={cn('truncate text-sm font-medium', title ? 'text-text' : 'text-text-muted')}>
                {title || t('notifications.compose.titlePlaceholder')}
              </p>
              <p className="line-clamp-2 text-xs text-text-muted">
                {body || t('notifications.compose.bodyPlaceholder')}
              </p>
            </div>
          </div>
        </div>
        <p className="pt-2 text-xs text-text-muted">{t('notifications.compose.previewHint')}</p>
      </CardContent>
    </Card>
  );
}

function History() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageArgs>({ page: 1, size: PAGE_DEFAULTS.notifications });
  const { data, isPending, isError, error, refetch } = useNotificationHistory(page);

  if (isPending) return <LoadingState />;
  if (isError && !data) {
    return <ErrorState message={errorMessage(error, t)} onRetry={() => void refetch()} />;
  }
  if (!data || data.content.length === 0) {
    return (
      <Card>
        <EmptyState icon={Megaphone} title={t('notifications.history.empty')} />
      </Card>
    );
  }

  return (
    <Card>
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>{t('notifications.history.columns.sent')}</TH>
              <TH>{t('notifications.history.columns.title')}</TH>
              <TH>{t('notifications.history.columns.audience')}</TH>
              <TH>{t('notifications.history.columns.status')}</TH>
              <TH>{t('notifications.history.columns.reach')}</TH>
            </tr>
          </THead>
          <TBody>
            {data.content.map((notification) => (
              <TR key={notification.id}>
                <TD className="whitespace-nowrap text-text-muted">
                  {formatDateTime(notification.sentAt ?? notification.createdAt ?? null)}
                </TD>
                <TD>
                  <span className="font-medium">{notification.title}</span>
                  <span className="line-clamp-1 block text-xs text-text-muted">
                    {notification.body}
                  </span>
                </TD>
                <TD className="text-text-muted">{describeAudienceRule(notification.audienceRule)}</TD>
                <TD>
                  <NotifStatusBadge status={notification.status} />
                </TD>
                <TD
                  className="whitespace-nowrap text-text-muted"
                  // Best-effort delivery means delivered < recipients is normal, not an error —
                  // so it is explained in a tooltip rather than coloured red (§8.5.5).
                  title={t('notifications.history.reachedHint')}
                >
                  {t('notifications.history.reached', {
                    delivered: notification.deliveredCount,
                    recipients: notification.recipientCount,
                  })}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
      <Pagination page={data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} />
    </Card>
  );
}
