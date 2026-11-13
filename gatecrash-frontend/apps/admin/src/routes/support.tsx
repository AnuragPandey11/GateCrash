import {
  useAllTickets,
  useMyTickets,
  useRaiseTicket,
  useReplyTicket,
  useTicket,
  useTicketAction,
  type TicketSummary,
} from '@gatecrash/api';
import {
  TICKET_CATEGORIES,
  formatDateTime,
  type TicketCategory,
  type TicketStatus,
  type Tone,
} from '@gatecrash/core';
import { CheckCircle2, LifeBuoy, Loader2, Plus, RotateCcw, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

const STATUS_TONE: Record<TicketStatus, Tone> = {
  OPEN: 'pending',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  CLOSED: 'muted',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`portal.support.status.${status}`)}</Badge>;
}

/**
 * Help & Support. One screen, two seats:
 *
 *  - **Resident** — raise a request, follow the thread, close it, or reopen it if it is not fixed.
 *  - **Office** (`office`) — the township's queue, filterable by status; reply and move tickets on.
 *
 * Both sides are told about the other's replies (push + live refresh).
 */
export function SupportRoute({ office = false }: { office?: boolean }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TicketStatus | 'ALL'>(office ? 'OPEN' : 'ALL');
  const [page, setPage] = useState({ page: 1, size: 20 });
  const mine = useMyTickets(page);
  const all = useAllTickets(status === 'ALL' ? null : status, page);
  const list = office ? all : mine;
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        eyebrow={office ? t('pageEyebrow.helpdesk') : t('pageEyebrow.support')}
        title={office ? t('portal.support.officeTitle') : t('portal.support.title')}
        description={office ? t('portal.support.officeSubtitle') : t('portal.support.subtitle')}
        actions={
          office ? null : (
            <Button onClick={() => setRaising(true)}>
              <Plus aria-hidden />
              {t('portal.support.raise')}
            </Button>
          )
        }
      />

      {office ? (
        <Segmented
          className="mb-4"
          label={t('portal.support.officeTitle')}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage((p) => ({ ...p, page: 1 }));
          }}
          options={[
            { value: 'OPEN', label: t('portal.support.status.OPEN') },
            { value: 'IN_PROGRESS', label: t('portal.support.status.IN_PROGRESS') },
            { value: 'RESOLVED', label: t('portal.support.status.RESOLVED') },
            { value: 'CLOSED', label: t('portal.support.status.CLOSED') },
            { value: 'ALL', label: t('common.all') },
          ]}
        />
      ) : null}

      {list.isPending ? <LoadingState /> : null}
      {list.data && list.data.content.length === 0 ? (
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title={office ? t('portal.support.officeEmpty') : t('portal.support.empty')}
            description={office ? undefined : t('portal.support.emptyHint')}
            action={office ? undefined : <Button onClick={() => setRaising(true)}>{t('portal.support.raise')}</Button>}
          />
        </Card>
      ) : null}

      <div className="stagger space-y-3">
        {(list.data?.content ?? []).map((ticket) => (
          <TicketRow key={ticket.id} ticket={ticket} office={office} onOpen={() => setOpenId(ticket.id)} />
        ))}
      </div>
      {list.data ? (
        <Pagination page={list.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
      ) : null}

      {raising ? <RaiseDialog onClose={() => setRaising(false)} onRaised={(id) => { setRaising(false); setOpenId(id); }} /> : null}
      {openId ? <TicketDialog id={openId} office={office} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function TicketRow({ ticket, office, onOpen }: { ticket: TicketSummary; office: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="lift flex w-full items-start justify-between gap-3 rounded-lg border border-border/80 bg-surface p-4 text-left shadow-soft"
    >
      <div className="min-w-0 space-y-1">
        <p className="truncate font-semibold text-text">{ticket.subject}</p>
        <p className="text-xs text-text-muted">
          {[
            t(`portal.support.category.${ticket.category}`),
            office ? `${ticket.unitCode ?? '—'} · ${ticket.raisedByName}` : null,
            formatDateTime(ticket.updatedAt),
            ticket.replies > 0 ? t('portal.support.replies', { count: ticket.replies }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <TicketStatusBadge status={ticket.status} />
    </button>
  );
}

function RaiseDialog({ onClose, onRaised }: { onClose: () => void; onRaised: (id: string) => void }) {
  const { t } = useTranslation();
  const raise = useRaiseTicket();
  const [category, setCategory] = useState<TicketCategory>('MAINTENANCE');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const valid = subject.trim() && description.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('portal.support.raise')}</DialogTitle>
          <DialogDescription>{t('portal.support.raiseBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[0.8125rem] font-semibold text-text">{t('portal.support.categoryLabel')}</p>
            <Segmented
              size="sm"
              label={t('portal.support.categoryLabel')}
              value={category}
              onChange={setCategory}
              options={TICKET_CATEGORIES.map((c) => ({ value: c, label: t(`portal.support.category.${c}`) }))}
            />
          </div>
          <Field label={t('portal.support.subject')} required>
            {(props) => (
              <Input {...props} value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} placeholder={t('portal.support.subjectExample')} />
            )}
          </Field>
          <Field label={t('portal.support.description')} required>
            {(props) => (
              <Textarea {...props} rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || raise.isPending}
            onClick={async () => {
              try {
                const created = (await raise.mutateAsync({
                  category,
                  subject: subject.trim(),
                  description: description.trim(),
                })) as { id: string };
                toast.success(t('portal.support.raised'));
                onRaised(created.id);
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {raise.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {t('portal.support.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One ticket: the original request, the thread, a reply box, and the status actions for each side. */
function TicketDialog({ id, office, onClose }: { id: string; office: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const ticket = useTicket(id);
  const reply = useReplyTicket();
  const action = useTicketAction();
  const [body, setBody] = useState('');
  const data = ticket.data;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {!data ? (
          <LoadingState />
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <TicketStatusBadge status={data.status} />
                <Badge tone="muted">{t(`portal.support.category.${data.category}`)}</Badge>
              </div>
              <DialogTitle>{data.subject}</DialogTitle>
              <DialogDescription>
                {[data.raisedByName, data.unitCode, formatDateTime(data.createdAt)].filter(Boolean).join(' · ')}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-3">
              <div className="rounded-[12px] border border-border/80 bg-surface-raised/60 p-4 text-sm text-text whitespace-pre-wrap">
                {data.description}
              </div>
              {data.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm animate-pop-in',
                    m.fromStaff ? 'mr-auto border border-border bg-surface' : 'ml-auto bg-primary text-primary-fg',
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={cn('pt-1 text-[0.6875rem]', m.fromStaff ? 'text-text-muted' : 'text-primary-fg/75')}>
                    {m.fromStaff ? t('portal.support.office') : m.authorName} · {formatDateTime(m.createdAt)}
                  </p>
                </div>
              ))}
              {data.status !== 'CLOSED' ? (
                <div className="space-y-2 pt-2">
                  <Textarea
                    rows={3}
                    value={body}
                    maxLength={4000}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={office ? t('portal.support.replyAsOffice') : t('portal.support.replyPlaceholder')}
                    aria-label={t('portal.support.reply')}
                  />
                  <Button
                    className="w-full sm:w-auto"
                    disabled={!body.trim() || reply.isPending}
                    onClick={() =>
                      void run(async () => {
                        await reply.mutateAsync({ id, body: body.trim() });
                        setBody('');
                      }, t('portal.support.sent'))
                    }
                  >
                    <Send aria-hidden />
                    {t('portal.support.reply')}
                  </Button>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter className="flex-wrap">
              {office ? (
                <>
                  {data.status === 'OPEN' ? (
                    <Button variant="secondary" onClick={() => void run(() => action.mutateAsync({ id, action: 'status', status: 'IN_PROGRESS' }), t('portal.support.updated'))}>
                      {t('portal.support.markInProgress')}
                    </Button>
                  ) : null}
                  {data.status === 'OPEN' || data.status === 'IN_PROGRESS' ? (
                    <Button onClick={() => void run(() => action.mutateAsync({ id, action: 'status', status: 'RESOLVED' }), t('portal.support.updated'))}>
                      <CheckCircle2 aria-hidden />
                      {t('portal.support.markResolved')}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  {data.status === 'RESOLVED' ? (
                    <Button variant="secondary" onClick={() => void run(() => action.mutateAsync({ id, action: 'reopen' }), t('portal.support.reopened'))}>
                      <RotateCcw aria-hidden />
                      {t('portal.support.reopen')}
                    </Button>
                  ) : null}
                  {data.status !== 'CLOSED' ? (
                    <Button variant="secondary" onClick={() => void run(() => action.mutateAsync({ id, action: 'close' }), t('portal.support.closed'))}>
                      <XCircle aria-hidden />
                      {t('portal.support.close')}
                    </Button>
                  ) : null}
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
