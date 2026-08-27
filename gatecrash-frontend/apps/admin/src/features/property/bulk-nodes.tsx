import { useBulkCreateNodes } from '@gatecrash/api';
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
import { errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { useNomenclature } from './use-nomenclature';

/**
 * Expands a code pattern exactly as `PropertyService.expand` does on the server.
 *
 * Duplicated deliberately and kept trivially small: the preview is only worth showing if it is the
 * truth, and a preview computed by different rules than the generator is worse than none. If the
 * server's expansion ever grows a rule, this has to grow the same one.
 */
export function expandPattern(
  pattern: string,
  buildingName: string,
  storey: number | null,
  unit: number,
  digits: number,
): string {
  return pattern
    .replace(/\{building\}/g, buildingName)
    .replace(/\{floor\}/g, storey === null ? '' : String(storey))
    .replace(/\{unit\}/g, String(unit).padStart(digits, '0'))
    .trim();
}

/**
 * Bulk structure generation — FRONTEND.md §8.8.
 *
 * Replaces the old client-side loop. That version fired one request per flat because there was no
 * bulk endpoint, and it wore its partial-failure reporting as a feature: the admin got a list of
 * which numbers landed, which were skipped and which failed.
 *
 * `POST /admin/property/nodes/bulk` makes that reporting unnecessary rather than merely cheaper —
 * the whole generation is one transaction, so there is no partial state to report. Either the tower
 * exists as specified or nothing was created, and a half-built tower whose extent the admin has to
 * reconstruct from a results table is exactly the outcome worth designing out.
 *
 * Whether floors are generated is read from the township's levels, not asked: a villa community has
 * no floors to generate, and offering the field would invite a request the server must refuse.
 */
export function BulkNodesDialog({
  open,
  onOpenChange,
  parentId,
  parentName,
  depth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string;
  parentName: string;
  /** Depth of the level being filled — its children are what gets generated. */
  depth: number;
}) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  const bulk = useBulkCreateNodes();

  // The level immediately below the parent decides the shape of this dialog: if it is the floor
  // level we ask for a range of storeys, otherwise the units hang directly off the parent.
  const childLevel = nom.at(depth + 1);
  const parentLevelLabel = nom.at(depth)?.singular ?? '';
  const generatingFloors = childLevel?.kind === 'FLOOR';
  const unitWords = {
    level: nom.unitLevel?.singular ?? '',
    levels: nom.unitLevel?.plural ?? '',
  };

  const [fromFloor, setFromFloor] = useState('1');
  const [toFloor, setToFloor] = useState('10');
  const [perFloor, setPerFloor] = useState('4');
  const [pattern, setPattern] = useState(generatingFloors ? 'A-{floor}{unit}' : 'A-{unit}');
  const [digits, setDigits] = useState('2');

  const from = Number(fromFloor);
  const to = Number(toFloor);
  const count = Number(perFloor);
  const floorsValid = !generatingFloors || (Number.isInteger(from) && Number.isInteger(to) && to >= from);
  const valid =
    floorsValid && Number.isInteger(count) && count >= 1 && count <= 50 && pattern.trim().length > 0;

  const floorCount = generatingFloors && floorsValid ? to - from + 1 : 0;
  const unitCount = valid ? (generatingFloors ? floorCount : 1) * count : 0;

  /** First three codes, then the last, so both ends of the range are visible. */
  const sampleCodes = (() => {
    if (!valid) return '';
    const digitCount = Number(digits) || 2;
    const firstStorey = generatingFloors ? from : null;
    const lastStorey = generatingFloors ? to : null;
    const shown: string[] = [];
    for (let u = 1; u <= Math.min(count, 3); u++) {
      shown.push(expandPattern(pattern.trim(), parentName, firstStorey, u, digitCount));
    }
    const last = expandPattern(pattern.trim(), parentName, lastStorey, count, digitCount);
    return unitCount > shown.length
      ? t('township.bulk.previewMore', { codes: shown.join(', '), last })
      : shown.join(', ');
  })();

  const run = async () => {
    if (!valid) return;
    try {
      const result = await bulk.mutateAsync({
        buildingId: parentId,
        ...(generatingFloors ? { fromFloor: from, toFloor: to } : {}),
        unitsPerFloor: count,
        codePattern: pattern.trim(),
        unitDigits: Number(digits) || 2,
      });
      toast.success(
        t('township.bulk.add', unitWords),
        t('township.bulk.done', {
          floors: result.floorsCreated,
          units: result.unitsCreated,
          levels: unitWords.levels,
        }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(t('township.bulk.add', unitWords), errorMessage(error, t));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('township.bulk.title', { levels: unitWords.levels, parent: parentName })}
          </DialogTitle>
          <DialogDescription>{t('township.bulk.body')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {generatingFloors ? (
            <div className="flex gap-3">
              <Field label={t('township.bulk.from')} className="flex-1">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    value={fromFloor}
                    onChange={(e) => setFromFloor(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('township.bulk.to')} className="flex-1">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    value={toFloor}
                    onChange={(e) => setToFloor(e.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}

          <Field
            label={
              generatingFloors
                ? t('township.bulk.perFloor', unitWords)
                : t('township.bulk.count', unitWords)
            }
            hint={
              generatingFloors
                ? t('township.bulk.countHintFloors')
                : t('township.bulk.countHint', { parent: parentName })
            }
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                value={perFloor}
                onChange={(e) => setPerFloor(e.target.value)}
              />
            )}
          </Field>

          {/* A floorless project has no {floor} to interpolate, so it is not offered one. */}
          <Field
            label={t('township.bulk.pattern')}
            hint={
              generatingFloors
                ? t('township.bulk.patternHintFloors')
                : t('township.bulk.patternHint', {
                    parentLevel: (parentLevelLabel || '').toLowerCase(),
                    example: expandPattern('{building}-{unit}', parentName, null, 1, 2),
                  })
            }
          >
            {(props) => (
              <Input {...props} value={pattern} onChange={(e) => setPattern(e.target.value)} />
            )}
          </Field>

          <Field label={t('township.bulk.digits')} hint={t('township.bulk.digitsHint')}>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                max={4}
                value={digits}
                onChange={(e) => setDigits(e.target.value)}
              />
            )}
          </Field>

          {valid ? (
            <div className="space-y-1 rounded-md border border-border bg-surface-muted p-2">
              <p className="text-sm text-text-muted">
                {generatingFloors
                  ? t('township.bulk.preview', {
                      floors: floorCount,
                      units: unitCount,
                      levels: unitWords.levels,
                    })
                  : t('township.bulk.previewFlat', {
                      units: unitCount,
                      levels: unitWords.levels,
                    })}
              </p>
              {/* The codes themselves. "Will create 4 villas" does not tell anyone whether they are
                  about to get A-01 or A-1, and the code is the unit's addressable identity. */}
              <p className="font-credential text-sm text-text">{sampleCodes}</p>
              <p className="text-xs text-text-muted">{t('township.bulk.codeIsIdentity')}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void run()} disabled={!valid || bulk.isPending}>
            {bulk.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {bulk.isPending ? t('township.bulk.running') : t('township.bulk.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
