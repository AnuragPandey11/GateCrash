import { useRenamePropertyLevel, type PropertyLevelResponse } from '@gatecrash/api';
import { asId } from '@gatecrash/core';
import { Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { useNomenclature } from './use-nomenclature';

/**
 * What this project calls each level of its structure.
 *
 * Renaming is offered here and reshaping is not, mirroring the API: `PUT /levels` is refused once
 * the tree holds anything (`409 PROPERTY_TREE_NOT_EMPTY`), because inserting a Floor level beneath
 * towers that already hold flats has no safe automatic answer to which floor each flat belongs on.
 * Renaming changes no rows at all, so it stays available — and it is precisely once a developer has
 * entered their structure that they notice the wording is wrong.
 *
 * The `kind` column is shown read-only and deliberately: it is what the system actually reasons
 * about, and seeing that "Villa" is a UNIT while "Cluster" is a GROUP is what explains why one of
 * them takes residents and the other does not.
 */
export function LevelsCard() {
  const { t } = useTranslation();
  const nom = useNomenclature();
  const [editing, setEditing] = useState<PropertyLevelResponse | null>(null);

  return (
    <>
      <Card className="p-4">
        <div className="mb-3">
          <h2 className="text-sm font-medium text-text">{t('township.levels.title')}</h2>
          <p className="text-sm text-text-muted">{t('township.levels.subtitle')}</p>
        </div>

        <p className="mb-3 text-xs text-text-muted">{t('township.levels.locked')}</p>

        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>{t('township.levels.depth')}</TH>
                <TH>{t('township.levels.singular')}</TH>
                <TH>{t('township.levels.plural')}</TH>
                <TH>{t('township.levels.kind')}</TH>
                <TH className="w-10" />
              </tr>
            </THead>
            <TBody>
              {nom.levels.map((level) => (
                <TR key={level.id}>
                  <TD className="text-text-muted">{level.depth}</TD>
                  <TD className="font-medium">{level.singular}</TD>
                  <TD className="text-text-muted">{level.plural}</TD>
                  <TD className="text-text-muted">{level.kind}</TD>
                  <TD>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('township.levels.rename')}
                      onClick={() => setEditing(level)}
                    >
                      <Pencil />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>

        <p className="mt-3 text-xs text-text-muted">
          {t('township.levels.projectType')}: {nom.propertyTypeLabel}
        </p>
      </Card>

      {editing ? <RenameDialog level={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RenameDialog({
  level,
  onClose,
}: {
  level: PropertyLevelResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rename = useRenamePropertyLevel();
  const [singular, setSingular] = useState(level.singular);
  const [plural, setPlural] = useState(level.plural);

  const valid = singular.trim().length > 0 && plural.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    try {
      await rename.mutateAsync({
        id: asId.propertyLevel(level.id),
        body: { singular: singular.trim(), plural: plural.trim() },
      });
      onClose();
    } catch (error) {
      toast.error(t('township.levels.rename'), errorMessage(error, t));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('township.levels.rename')}</DialogTitle>
          <DialogDescription>{t('township.levels.renameBody')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('township.levels.singular')}>
            {(props) => (
              <Input {...props} value={singular} onChange={(e) => setSingular(e.target.value)} />
            )}
          </Field>
          {/* Not derived by appending an "s": "Row House" pluralises to "Row Houses". */}
          <Field label={t('township.levels.plural')}>
            {(props) => (
              <Input {...props} value={plural} onChange={(e) => setPlural(e.target.value)} />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={!valid || rename.isPending}>
            {rename.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
