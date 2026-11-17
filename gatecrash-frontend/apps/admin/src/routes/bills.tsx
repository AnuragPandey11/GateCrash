import { formatPaise, useMyPaidInvoices, type Invoice } from '@gatecrash/api';
import { formatDateTime } from '@gatecrash/core';
import { Printer, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { useSessionStore } from '@/lib/session';

/** The resident's bills: what their home has paid, each with a receipt they can print. */
export function BillsRoute() {
  const { t } = useTranslation();
  const [page, setPage] = useState({ page: 1, size: 20 });
  const bills = useMyPaidInvoices(page);
  const [open, setOpen] = useState<Invoice | null>(null);
  const total = (bills.data?.content ?? []).reduce((sum, i) => sum + i.amountPaise, 0);

  return (
    <>
      <PageHeader eyebrow={t('pageEyebrow.bills')} title={t('portal.bills.title')} description={t('portal.bills.subtitle')} />

      {bills.isPending ? <LoadingState /> : null}
      {bills.data && bills.data.content.length === 0 ? (
        <Card>
          <EmptyState icon={ReceiptText} title={t('portal.bills.empty')} description={t('portal.bills.emptyHint')} />
        </Card>
      ) : null}

      {bills.data && bills.data.content.length > 0 ? (
        <>
          <Card className="mb-4">
            <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-text-muted">{t('portal.bills.shownTotal')}</p>
              <p className="font-display text-3xl text-text">{formatPaise(total)}</p>
            </CardContent>
          </Card>
          <div className="stagger space-y-3">
            {bills.data.content.map((bill) => (
              <button
                key={bill.id}
                type="button"
                onClick={() => setOpen(bill)}
                className="lift flex w-full items-center justify-between gap-3 rounded-lg border border-border/80 bg-surface p-4 text-left shadow-soft"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text">{bill.title}</p>
                  <p className="text-xs text-text-muted">
                    {[bill.periodLabel, t(`portal.bills.category.${bill.category}`), formatDateTime(bill.paidAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums text-text">{formatPaise(bill.amountPaise)}</p>
                  <Badge tone="success">{t('portal.bills.paid')}</Badge>
                </div>
              </button>
            ))}
          </div>
          <Pagination page={bills.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
        </>
      ) : null}

      {open ? <ReceiptDialog bill={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

export function ReceiptDialog({ bill, onClose }: { bill: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useSessionStore((s) => s.me);
  const rows: [string, string | null | undefined][] = [
    [t('portal.bills.receiptNo'), bill.receiptNo],
    [t('portal.bills.unit'), bill.unitCode],
    [t('portal.bills.forLabel'), [bill.title, bill.periodLabel].filter(Boolean).join(' — ')],
    [t('portal.bills.categoryLabel'), t(`portal.bills.category.${bill.category}`)],
    [t('portal.bills.paidOn'), formatDateTime(bill.paidAt)],
    [t('portal.bills.method'), bill.paymentMethod],
    [t('portal.bills.reference'), bill.paymentReference],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md print:shadow-none">
        <DialogHeader>
          <DialogTitle>{t('portal.bills.receipt')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-text-muted">{me?.townshipName}</p>
            <p className="font-display text-4xl text-text">{formatPaise(bill.amountPaise)}</p>
            <Badge tone="success" className="mt-2">
              {t('portal.bills.paid')}
            </Badge>
          </div>
          <dl className="divide-y divide-border/70 rounded-[12px] border border-border/80">
            {rows
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                  <dt className="text-text-muted">{label}</dt>
                  <dd className="text-right font-medium text-text">{value}</dd>
                </div>
              ))}
          </dl>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden />
            {t('portal.bills.print')}
          </Button>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
