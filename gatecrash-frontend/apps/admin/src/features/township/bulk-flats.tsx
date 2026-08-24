import { useEndpoints } from '@gatecrash/api';
import { hasErrorCode } from '@gatecrash/api';
import type { BlockId } from '@gatecrash/core';
import { Loader2 } from 'lucide-react';
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
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

/**
 * Bulk flat creation — FRONTEND.md §8.8.
 *
 * The one quality-of-life feature worth building client-side: setting up a township means
 * creating hundreds of flats, and there is no bulk endpoint.
 *
 * **Sequential, not parallel.** Two reasons: it does not hammer the box with 40 simultaneous
 * inserts, and partial failure stays legible — the admin sees exactly which numbers landed,
 * which were skipped as duplicates, and which failed, rather than one aggregate "some errors".
 */

const MAX_PER_RUN = 200;

interface RowResult {
  number: string;
  outcome: 'created' | 'skipped' | 'failed';
  message?: string;
}

export function BulkFlatsDialog({
  open,
  onOpenChange,
  blockId,
  blockName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: BlockId;
  blockName: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const endpoints = useEndpoints();

  const [prefix, setPrefix] = useState('A-');
  const [from, setFrom] = useState('101');
  const [to, setTo] = useState('110');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[]>([]);

  const fromNum = Number(from);
  const toNum = Number(to);
  const valid =
    Number.isInteger(fromNum) && Number.isInteger(toNum) && fromNum >= 0 && toNum >= fromNum;
  const count = valid ? toNum - fromNum + 1 : 0;
  const tooMany = count > MAX_PER_RUN;

  // Zero-padding is preserved from the "from" field, so `001`–`010` stays three digits.
  const pad = from.length;
  const numbers = valid && !tooMany
    ? Array.from({ length: count }, (_, i) => `${prefix}${String(fromNum + i).padStart(pad, '0')}`)
    : [];

  const run = async () => {
    setRunning(true);
    setResults([]);
    for (const number of numbers) {
      try {
        await endpoints.township.createFlat({ blockId, number });
        setResults((prev) => [...prev, { number, outcome: 'created' }]);
      } catch (error) {
        // A duplicate is a 409, and re-running a range that partly exists is a completely
        // reasonable thing to do — so it is "skipped", not "failed".
        const skipped = hasErrorCode(error, 'CONFLICT', 'CONCURRENT_MODIFICATION');
        setResults((prev) => [
          ...prev,
          {
            number,
            outcome: skipped ? 'skipped' : 'failed',
            message: skipped ? undefined : errorMessage(error, t),
          },
        ]);
      }
    }
    setRunning(false);
    onDone();
  };

  const created = results.filter((r) => r.outcome === 'created').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const finished = !running && results.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('township.flats.range.title')}</DialogTitle>
          <DialogDescription>
            {blockName} — {t('township.flats.range.body')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <Field label={t('township.flats.range.prefix')} hint={t('township.flats.range.prefixHint')}>
            {(props) => (
              <Input
                {...props}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                disabled={running}
              />
            )}
          </Field>
          <Field label={t('township.flats.range.from')}>
            {(props) => (
              <Input
                {...props}
                value={from}
                inputMode="numeric"
                onChange={(e) => setFrom(e.target.value)}
                disabled={running}
              />
            )}
          </Field>
          <Field
            label={t('township.flats.range.to')}
            error={
              !valid
                ? t('township.flats.range.invalid')
                : tooMany
                  ? t('township.flats.range.tooMany', { max: MAX_PER_RUN })
                  : undefined
            }
          >
            {(props) => (
              <Input
                {...props}
                value={to}
                inputMode="numeric"
                onChange={(e) => setTo(e.target.value)}
                disabled={running}
              />
            )}
          </Field>
        </div>

        {numbers.length > 0 ? (
          <p className="text-sm text-text-muted">
            {t('township.flats.range.preview', {
              count: numbers.length,
              first: numbers[0],
              last: numbers[numbers.length - 1],
            })}
          </p>
        ) : null}

        {results.length > 0 ? (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {results.map((result) => (
              <div key={result.number} className="flex justify-between gap-2 text-sm">
                <span className="font-credential">{result.number}</span>
                <span
                  className={cn(
                    result.outcome === 'created' && 'text-success',
                    result.outcome === 'skipped' && 'text-text-muted',
                    result.outcome === 'failed' && 'text-danger',
                  )}
                >
                  {result.message ?? result.outcome}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {finished ? (
          <p className="text-sm text-text">
            {t('township.flats.range.done', { created, skipped, failed })}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
            {finished ? t('common.close') : t('common.cancel')}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={running || numbers.length === 0 || finished}
          >
            {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {running
              ? t('township.flats.range.running', { done: results.length, total: numbers.length })
              : t('township.flats.range.run', { count: numbers.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
