import {
  useEndpoints,
  usePropertyNodes,
  useGates,
  useVisitSearch,
  type VisitResponse,
} from '@gatecrash/api';
import {
  CLIENT_LIMITS,
  VISITOR_TYPES,
  VISIT_STATUSES,
  datetimeLocalToOffset,
  formatDateTime,
  offsetToDatetimeLocal,
  type FlatId,
  type VisitStatus,
  type VisitorType,
} from '@gatecrash/core';
import { Download, Loader2, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { MeetSalesBadge, VisitStatusBadge, VisitorTypeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  ANY_VALUE,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  fromAny,
  toAny,
} from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import {
  ExportTooLargeError,
  downloadCsv,
  exportVisitsCsv,
  type ExportProgress,
} from '@/features/visits/export-csv';
import { useVisitFilters } from '@/features/visits/use-visit-filters';
import { VisitDetailDrawer } from '@/features/visits/visit-detail-drawer';
import { errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { useNomenclature } from '@/features/property/use-nomenclature';

/**
 * The visitor log — FRONTEND.md §8.4.
 *
 * Server-paginated, server-filtered, with filters serialised to the URL (see `useVisitFilters`).
 * A row opens the deep-linkable detail drawer at `/visits/:id` without losing the table's
 * filters behind it.
 */
export function VisitsRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { visitId } = useParams();
  const endpoints = useEndpoints();

  const { filters, page, setFilter, setPage, clear, activeCount } = useVisitFilters();
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useVisitSearch(filters, page);

  const gates = useGates();
  const nom = useNomenclature();
  const flats = usePropertyNodes(
    { depth: nom.unitLevel?.depth ?? null },
    { enabled: nom.unitLevel != null },
  );

  const [exporting, setExporting] = useState<ExportProgress | null>(null);

  // Flats grouped by block, so a 400-flat township is navigable rather than one flat list.
  const flatOptions = flats.data;
  const flatsByBlock = useMemo(() => {
    const groups = new Map<string, { blockName: string; flats: { id: FlatId; number: string }[] }>();
    for (const flat of flatOptions ?? []) {
      const key = flat.containerName ?? '';
      const entry = groups.get(key) ?? { blockName: key, flats: [] };
      entry.flats.push({ id: flat.id, number: flat.code ?? flat.name });
      groups.set(key, entry);
    }
    return groups;
  }, [flatOptions]);

  const runExport = async () => {
    setExporting({ done: 0, total: 0 });
    try {
      const { csv, rows } = await exportVisitsCsv(endpoints, filters, setExporting);
      downloadCsv(csv, `gatecrash-visits-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(t('visits.export.done', { count: rows }));
    } catch (err) {
      if (err instanceof ExportTooLargeError) {
        toast.error(
          t('visits.export.action'),
          t('visits.export.tooMany', {
            count: err.total,
            cap: CLIENT_LIMITS.csvExportMaxRows,
          }),
        );
      } else {
        toast.error(t('visits.export.action'), errorMessage(err, t));
      }
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.security')}
        title={t('visits.title')}
        description={t('visits.subtitle')}
        actions={
          <Button
            variant="secondary"
            onClick={() => void runExport()}
            disabled={exporting !== null || !data || data.totalElements === 0}
            title={t('visits.export.note')}
          >
            {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
            {exporting
              ? t('visits.export.running', { done: exporting.done, total: exporting.total })
              : t('visits.export.action')}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label={t('visits.filters.status')}>
            {(props) => (
              <Select
                value={toAny(filters.status)}
                onValueChange={(v) => setFilter('status', fromAny(v) as VisitStatus | null)}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('visits.filters.anyStatus')}</SelectItem>
                  {VISIT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`status.visit.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('visits.filters.visitorType')}>
            {(props) => (
              <Select
                value={toAny(filters.visitorType)}
                onValueChange={(v) => setFilter('visitorType', fromAny(v) as VisitorType | null)}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('visits.filters.anyType')}</SelectItem>
                  {VISITOR_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`status.visitorType.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('visits.filters.meetSalesAgent')}>
            {(props) => (
              <Select
                value={filters.meetSalesAgent == null ? ANY_VALUE : String(filters.meetSalesAgent)}
                onValueChange={(v) =>
                  setFilter('meetSalesAgent', v === ANY_VALUE ? null : v === 'true')
                }
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('common.all')}</SelectItem>
                  <SelectItem value="true">{t('visits.filters.metSales')}</SelectItem>
                  <SelectItem value="false">{t('visits.filters.didNotMeetSales')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('visits.filters.gate')}>
            {(props) => (
              <Select
                value={toAny(filters.gateId)}
                onValueChange={(v) => setFilter('gateId', fromAny(v) as never)}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('visits.filters.anyGate')}</SelectItem>
                  {(gates.data ?? []).map((gate) => (
                    <SelectItem key={gate.id} value={gate.id}>
                      {gate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('visits.filters.flat')}>
            {(props) => (
              <Select
                value={toAny(filters.flatId)}
                onValueChange={(v) => setFilter('flatId', fromAny(v) as never)}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('visits.filters.anyFlat')}</SelectItem>
                  {/* SelectGroup, not a bare div: Radix requires it for SelectLabel. */}
                  {[...flatsByBlock.entries()].map(([blockId, group]) => (
                    <SelectGroup key={blockId}>
                      <SelectLabel>{group.blockName}</SelectLabel>
                      {group.flats.map((flat) => (
                        <SelectItem key={flat.id} value={flat.id}>
                          {flat.number}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {/* datetime-local emits a zone-less value; `datetimeLocalToOffset` stamps the browser's
              offset on, because Spring rejects a bare `2026-07-23` as TYPE_MISMATCH (§8.4). */}
          <Field label={t('visits.filters.from')}>
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={offsetToDatetimeLocal(filters.from)}
                onChange={(e) => setFilter('from', datetimeLocalToOffset(e.target.value))}
              />
            )}
          </Field>

          <Field label={t('visits.filters.to')}>
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={offsetToDatetimeLocal(filters.to)}
                onChange={(e) => setFilter('to', datetimeLocalToOffset(e.target.value))}
              />
            )}
          </Field>
        </div>

        {activeCount > 0 ? (
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={clear}>
              {t('common.clearAll')}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card>
        {isPending ? <LoadingState /> : null}

        {isError && !data ? (
          <ErrorState message={errorMessage(error, t)} onRetry={() => void refetch()} />
        ) : null}

        {data && data.content.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('visits.empty')} />
        ) : null}

        {data && data.content.length > 0 ? (
          <>
            {/* `isPlaceholderData` keeps the previous page visible while the next loads, so
                paging dims rather than flashing empty. */}
            <TableWrap className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('visits.columns.created')}</TH>
                    <TH>{t('visits.columns.visitor')}</TH>
                    <TH>{t('visits.columns.type')}</TH>
                    <TH>{t('visits.columns.gate')}</TH>
                    <TH>{t('visits.columns.destination')}</TH>
                    <TH>{t('visits.columns.status')}</TH>
                    <TH>{t('visits.columns.checkedIn')}</TH>
                    <TH>{t('visits.columns.checkedOut')}</TH>
                    <TH>{t('visits.columns.loggedBy')}</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.content.map((visit) => (
                    <VisitRow
                      key={visit.id}
                      visit={visit}
                      onOpen={() => navigate(`/visits/${visit.id}${window.location.search}`)}
                    />
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <Pagination page={data} onPageChange={setPage} />
          </>
        ) : null}
      </Card>

      <VisitDetailDrawer
        visitId={visitId ?? null}
        onClose={() => navigate(`/visits${window.location.search}`)}
      />
    </>
  );
}

function VisitRow({ visit, onOpen }: { visit: VisitResponse; onOpen: () => void }) {
  return (
    <TR
      data-clickable="true"
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(e) => {
        // A clickable row that only responds to a mouse is a row a keyboard user cannot open.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <TD className="whitespace-nowrap text-text-muted">{formatDateTime(visit.createdAt)}</TD>
      <TD>
        <span className="font-medium">{visit.visitorName}</span>
        {visit.visitorPhone ? (
          <span className="block text-xs text-text-muted">{visit.visitorPhone}</span>
        ) : null}
      </TD>
      <TD>
        <div className="flex flex-wrap gap-1">
          <VisitorTypeBadge type={visit.visitorType} />
          {visit.meetSalesAgent ? <MeetSalesBadge /> : null}
        </div>
      </TD>
      <TD className="whitespace-nowrap">{visit.gateName}</TD>
      <TD className="whitespace-nowrap">{visit.targetFlatNumber ?? visit.approverName ?? '—'}</TD>
      <TD>
        <VisitStatusBadge status={visit.status} />
      </TD>
      <TD className="whitespace-nowrap text-text-muted">{formatDateTime(visit.checkedInAt)}</TD>
      <TD className="whitespace-nowrap text-text-muted">{formatDateTime(visit.checkedOutAt)}</TD>
      <TD className="whitespace-nowrap text-text-muted">{visit.loggedByName}</TD>
    </TR>
  );
}
