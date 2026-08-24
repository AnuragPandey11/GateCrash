import { currentPage, pageRange, type PageResponse } from '@gatecrash/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

/**
 * Server-side paginator.
 *
 * The 0-based ↔ 1-based conversion lives in `@gatecrash/api/pagination` and nowhere else (§4.4);
 * this component only ever speaks in 1-based page numbers.
 */
export function Pagination<T>({
  page,
  onPageChange,
  className,
}: {
  page: PageResponse<T>;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = currentPage(page);
  const { from, to } = pageRange(page);

  if (page.totalElements === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm text-text-muted">
        <p className="tabular-nums">
          {from}–{to} {t('common.of')} {page.totalElements}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page.first}
            onClick={() => onPageChange(current - 1)}
          >
            <ChevronLeft aria-hidden />
            {t('common.previous')}
          </Button>
          <span className="tabular-nums px-1">
            {current} {t('common.of')} {Math.max(1, page.totalPages)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page.last}
            onClick={() => onPageChange(current + 1)}
          >
            {t('common.next')}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
