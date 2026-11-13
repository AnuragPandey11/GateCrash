import {
  formatPaise,
  useAllInvoices,
  useMarkInvoicePaid,
  usePropertyNodes,
  useRecordInvoice,
  type Invoice,
} from '@gatecrash/api';
import {
  INVOICE_CATEGORIES,
  formatDateTime,
  type InvoiceCategory,
  type InvoiceStatus,
  type PropertyNodeId,
} from '@gatecrash/core';
import { CheckCircle2, Loader2, Plus, ReceiptText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { useNomenclature } from '@/features/property/use-nomenclature';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { ReceiptDialog } from './bills';

/**
 * The office's bill book. Payments happen outside the app for now, so the office records each bill
 * against a home — usually already paid, in one step, which issues a receipt the resident sees in
 * their Bills tab. Unpaid bills recorded here are what the move-out screen warns about.
 */
export function BillingRoute() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<InvoiceStatus | 'ALL'>('ALL');
  const [page, setPage] = useState({ page: 1, size: 25 });
  const invoices = useAllInvoices(null, status === 'ALL' ? null : status, page);
  const markPaid = useMarkInvoicePaid();
  const [recording, setRecording] = useState(false);
  const [receipt, setReceipt] = useState<Invoice | null>(null);

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.billing')}
        title={t('portal.billing.title')}
        description={t('portal.billing.subtitle')}
        actions={
          <Button onClick={() => setRecording(true)}>
            <Plus aria-hidden />
            {t('portal.billing.record')}
          </Button>
        }
      />
      <Segmented
        className="mb-4"
        label={t('portal.billing.title')}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage((p) => ({ ...p, page: 1 }));
        }}
        options={[
          { value: 'ALL', label: t('common.all') },
          { value: 'UNPAID', label: t('portal.billing.unpaid') },
          { value: 'PAID', label: t('portal.bills.paid') },
        ]}
      />

      {invoices.isPending ? <LoadingState /> : null}
      {invoices.data && invoices.data.content.length === 0 ? (
        <Card>
          <EmptyState icon={ReceiptText} title={t('portal.billing.empty')} />
        </Card>
      ) : null}

      <div className="stagger space-y-3">
        {(invoices.data?.content ?? []).map((bill) => (
          <Card key={bill.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-text">
                  {bill.unitCode} · {bill.title}
                </p>
                <p className="text-xs text-text-muted">
                  {[bill.periodLabel, t(`portal.bills.category.${bill.category}`),
                    bill.status === 'PAID' ? formatDateTime(bill.paidAt) : bill.dueDate ? t('portal.billing.due', { date: bill.dueDate }) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="font-semibold tabular-nums text-text">{formatPaise(bill.amountPaise)}</p>
                {bill.status === 'PAID' ? (
                  <Button variant="ghost" size="sm" onClick={() => setReceipt(bill)}>
                    <Badge tone="success">{t('portal.bills.paid')}</Badge>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={markPaid.isPending}
                    onClick={async () => {
                      try {
                        await markPaid.mutateAsync({ id: bill.id });
                        toast.success(t('portal.billing.markedPaid'));
                      } catch (error) {
                        toastError(error, t);
                      }
                    }}
                  >
                    <CheckCircle2 aria-hidden />
                    {t('portal.billing.markPaid')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {invoices.data ? (
        <Pagination page={invoices.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
      ) : null}

      {recording ? <RecordDialog onClose={() => setRecording(false)} /> : null}
      {receipt ? <ReceiptDialog bill={receipt} onClose={() => setReceipt(null)} /> : null}
    </>
  );
}

function RecordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  const units = usePropertyNodes({ depth: nom.unitLevel?.depth ?? null }, { enabled: nom.unitLevel != null });
  const record = useRecordInvoice();
  const [unitId, setUnitId] = useState('');
  const [category, setCategory] = useState<InvoiceCategory>('MAINTENANCE');
  const [title, setTitle] = useState('');
  const [period, setPeriod] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState('UPI');
  const [reference, setReference] = useState('');
  const [dueDate, setDueDate] = useState('');

  const grouped = useMemo(() => {
    const groups = new Map<string, { id: string; code: string }[]>();
    for (const u of units.data ?? []) {
      const key = u.containerName ?? '';
      groups.set(key, [...(groups.get(key) ?? []), { id: u.id, code: u.code ?? u.name }]);
    }
    return groups;
  }, [units.data]);

  // Rupees in, paise out — never a float on the wire.
  const paise = Math.round(Number(amount) * 100);
  const valid = unitId && title.trim() && Number.isFinite(paise) && paise > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('portal.billing.record')}</DialogTitle>
          <DialogDescription>{t('portal.billing.recordBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label={nom.unitLevel?.singular ?? t('portal.bills.unit')} required>
            {(props) => (
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger {...props}>
                  <SelectValue placeholder={t('portal.gate.pickUnit')} />
                </SelectTrigger>
                <SelectContent>
                  {[...grouped.entries()].map(([group, list]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {list.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.code}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="space-y-1.5">
            <p className="text-[0.8125rem] font-semibold text-text">{t('portal.bills.categoryLabel')}</p>
            <Segmented
              size="sm"
              label={t('portal.bills.categoryLabel')}
              value={category}
              onChange={setCategory}
              options={INVOICE_CATEGORIES.map((c) => ({ value: c, label: t(`portal.bills.category.${c}`) }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('portal.billing.billTitle')} required>
              {(props) => <Input {...props} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('portal.billing.titleExample')} />}
            </Field>
            <Field label={t('portal.billing.period')}>
              {(props) => <Input {...props} value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Nov 2026" />}
            </Field>
            <Field label={t('portal.billing.amount')} required>
              {(props) => (
                <Input {...props} type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3500" />
              )}
            </Field>
            <Field label={t('portal.billing.dueDate')}>
              {(props) => <Input {...props} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-border p-3">
            <Checkbox checked={paid} onCheckedChange={(v) => setPaid(v === true)} aria-label={t('portal.billing.alreadyPaid')} />
            <span className="text-sm font-medium text-text">{t('portal.billing.alreadyPaid')}</span>
          </label>
          {paid ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('portal.bills.method')}>
                {(props) => <Input {...props} value={method} onChange={(e) => setMethod(e.target.value)} />}
              </Field>
              <Field label={t('portal.bills.reference')}>
                {(props) => <Input {...props} value={reference} onChange={(e) => setReference(e.target.value)} />}
              </Field>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || record.isPending}
            onClick={async () => {
              try {
                await record.mutateAsync({
                  unitId: unitId as PropertyNodeId,
                  category,
                  title: title.trim(),
                  ...(period.trim() ? { periodLabel: period.trim() } : {}),
                  amountPaise: paise,
                  ...(dueDate ? { dueDate } : {}),
                  paid,
                  ...(paid && method.trim() ? { paymentMethod: method.trim() } : {}),
                  ...(paid && reference.trim() ? { paymentReference: reference.trim() } : {}),
                });
                toast.success(t('portal.billing.recorded'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {record.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('portal.billing.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
