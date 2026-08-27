import { useSetOccupancy, type PropertyNodeResponse } from '@gatecrash/api';
import { hasErrorCode } from '@gatecrash/api';
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

/**
 * How many people live in one unit.
 *
 * The number counts *people*, not accounts. A four-person household typically has one login — the
 * owner's — so deriving the headcount from resident accounts would report that household as one
 * person, and the township's occupancy as a quarter of what it is. That is why the field exists at
 * all, and why the copy says "including anyone without an app account".
 *
 * The server refuses a figure below the unit's active resident accounts
 * (`409 OCCUPANCY_BELOW_RESIDENTS`), which is surfaced inline against the field rather than as a
 * toast: it is a correction to what was just typed, and the fix is in the input the admin is
 * already looking at.
 */
export function OccupancyDialog({
  node,
  unitLabel,
  onClose,
}: {
  node: PropertyNodeResponse;
  unitLabel: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setOccupancy = useSetOccupancy();
  const [value, setValue] = useState(String(node.declaredOccupancy));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 64;

  const save = async () => {
    if (!valid) return;
    setFieldError(null);
    try {
      await setOccupancy.mutateAsync({ id: node.id, declaredOccupancy: parsed });
      onClose();
    } catch (error) {
      if (hasErrorCode(error, 'OCCUPANCY_BELOW_RESIDENTS')) {
        setFieldError(
          t('township.occupancyDialog.belowResidents', {
            level: unitLabel.toLowerCase(),
            count: node.residentAccounts,
          }),
        );
        return;
      }
      toast.error(t('township.node.setOccupancy'), errorMessage(error, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('township.occupancyDialog.title', { name: node.code ?? node.name })}
          </DialogTitle>
          <DialogDescription>{t('township.occupancyDialog.body')}</DialogDescription>
        </DialogHeader>

        <Field
          label={t('township.occupancyDialog.declared')}
          error={fieldError ?? undefined}
          hint={t('township.node.residents', { count: node.residentAccounts })}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              min={0}
              max={64}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(null);
              }}
            />
          )}
        </Field>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={!valid || setOccupancy.isPending}>
            {setOccupancy.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
