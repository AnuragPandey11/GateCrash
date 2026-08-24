import {
  useBlocks,
  useCreateBlock,
  useCreateFlat,
  useCreateGate,
  useDeleteBlock,
  useDeleteFlat,
  useDeleteGate,
  useFlats,
  useGates,
} from '@gatecrash/api';
import { asId, formatDateTime, type BlockId, type FlatId, type GateId } from '@gatecrash/core';
import * as Tabs from '@radix-ui/react-tabs';
import { Building2, DoorOpen, Home, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import {
  ANY_VALUE,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  fromAny,
  toAny,
} from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { BulkFlatsDialog } from '@/features/township/bulk-flats';
import { conflictMessage, errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';

/**
 * Township — FRONTEND.md §8.8.
 *
 * Create and delete only; the backend has no update endpoints for blocks, flats or gates.
 *
 * A delete that is blocked by a foreign key comes back as `409 CONFLICT`, and each tab translates
 * that into the specific reason ("this flat has residents or visit history") rather than showing
 * "Error 409" — §11.2's rule that a conflict is a first-class outcome, not a crash.
 */
export function TownshipRoute() {
  const { t } = useTranslation();

  return (
    <>
      <PageHeader title={t('township.title')} description={t('township.subtitle')} />
      <Tabs.Root defaultValue="blocks">
        <Tabs.List className="mb-4 flex gap-1 border-b border-border">
          {(['blocks', 'flats', 'gates'] as const).map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {t(`township.tabs.${tab}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="blocks">
          <BlocksTab />
        </Tabs.Content>
        <Tabs.Content value="flats">
          <FlatsTab />
        </Tabs.Content>
        <Tabs.Content value="gates">
          <GatesTab />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

/** The shared "type a name, press Add" row every tab starts with. */
function AddRow({
  label,
  value,
  onChange,
  onSubmit,
  pending,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  children?: ReactNode;
}) {
  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="w-56"
      />
      <Button type="submit" disabled={pending || value.trim().length === 0}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
        {label}
      </Button>
    </form>
  );
}

function BlocksTab() {
  const { t } = useTranslation();
  const blocks = useBlocks();
  const create = useCreateBlock();
  const remove = useDeleteBlock();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<{ id: BlockId; name: string } | null>(null);

  const add = async () => {
    try {
      await create.mutateAsync(name.trim());
      setName('');
    } catch (error) {
      toast.error(t('township.blocks.add'), errorMessage(error, t));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleting(null);
      toast.error(t('common.delete'), conflictMessage(error, t('township.blocks.inUse'), t));
    }
  };

  return (
    <>
      <AddRow
        label={t('township.blocks.add')}
        value={name}
        onChange={setName}
        onSubmit={() => void add()}
        pending={create.isPending}
      />

      <Card>
        {blocks.isPending ? <LoadingState /> : null}
        {blocks.isError ? (
          <ErrorState
            message={errorMessage(blocks.error, t)}
            onRetry={() => void blocks.refetch()}
          />
        ) : null}
        {blocks.data?.length === 0 ? (
          <EmptyState icon={Building2} title={t('township.blocks.empty')} />
        ) : null}

        {blocks.data && blocks.data.length > 0 ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('township.blocks.name')}</TH>
                  <TH>{t('township.tabs.flats')}</TH>
                  <TH>{t('users.columns.created')}</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <TBody>
                {blocks.data.map((block) => (
                  <TR key={block.id}>
                    <TD className="font-medium">{block.name}</TD>
                    <TD className="text-text-muted">
                      {t('township.blocks.flatCount', { count: block.flatCount })}
                    </TD>
                    <TD className="text-text-muted">{formatDateTime(block.createdAt)}</TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('common.delete')}
                        onClick={() => setDeleting({ id: block.id, name: block.name })}
                      >
                        <Trash2 className="text-danger" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t('township.blocks.deleteTitle', { name: deleting.name }) : ''}
        description={t('township.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function FlatsTab() {
  const { t } = useTranslation();
  const blocks = useBlocks();
  const [blockId, setBlockId] = useState<BlockId | null>(null);
  const flats = useFlats(blockId);
  const create = useCreateFlat();
  const remove = useDeleteFlat();

  const [number, setNumber] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: FlatId; name: string } | null>(null);

  const selectedBlock = blocks.data?.find((b) => b.id === blockId) ?? null;

  const add = async () => {
    if (!blockId) return;
    try {
      await create.mutateAsync({ blockId, number: number.trim() });
      setNumber('');
    } catch (error) {
      toast.error(t('township.flats.add'), errorMessage(error, t));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleting(null);
      toast.error(t('common.delete'), conflictMessage(error, t('township.flats.inUse'), t));
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Select
            value={toAny(blockId)}
            onValueChange={(v) => setBlockId(fromAny(v) ? asId.block(fromAny(v) as string) : null)}
          >
            <SelectTrigger aria-label={t('township.flats.block')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>{t('common.all')}</SelectItem>
              {(blocks.data ?? []).map((block) => (
                <SelectItem key={block.id} value={block.id}>
                  {block.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder={t('township.flats.number')}
          aria-label={t('township.flats.number')}
          className="w-40"
          disabled={!blockId}
        />
        <Button
          onClick={() => void add()}
          disabled={!blockId || create.isPending || number.trim().length === 0}
        >
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {t('township.flats.add')}
        </Button>
        {/* Bulk creation needs a specific block — "all blocks" has no meaning for a range. */}
        <Button variant="secondary" onClick={() => setBulkOpen(true)} disabled={!blockId}>
          {t('township.flats.addRange')}
        </Button>
      </div>

      <Card>
        {flats.isPending ? <LoadingState /> : null}
        {flats.isError ? (
          <ErrorState message={errorMessage(flats.error, t)} onRetry={() => void flats.refetch()} />
        ) : null}
        {flats.data?.length === 0 ? (
          <EmptyState icon={Home} title={t('township.flats.empty')} />
        ) : null}

        {flats.data && flats.data.length > 0 ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('township.flats.number')}</TH>
                  <TH>{t('township.flats.block')}</TH>
                  <TH>{t('users.columns.created')}</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <TBody>
                {flats.data.map((flat) => (
                  <TR key={flat.id}>
                    <TD className="font-medium">{flat.number}</TD>
                    <TD className="text-text-muted">{flat.blockName}</TD>
                    <TD className="text-text-muted">{formatDateTime(flat.createdAt)}</TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('common.delete')}
                        onClick={() => setDeleting({ id: flat.id, name: flat.number })}
                      >
                        <Trash2 className="text-danger" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>

      {blockId && selectedBlock ? (
        <BulkFlatsDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          blockId={blockId}
          blockName={selectedBlock.name}
          onDone={() => void flats.refetch()}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t('township.flats.deleteTitle', { name: deleting.name }) : ''}
        description={t('township.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

function GatesTab() {
  const { t } = useTranslation();
  const gates = useGates();
  const create = useCreateGate();
  const remove = useDeleteGate();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<{ id: GateId; name: string } | null>(null);

  const add = async () => {
    try {
      await create.mutateAsync(name.trim());
      setName('');
    } catch (error) {
      toast.error(t('township.gates.add'), errorMessage(error, t));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleting(null);
      toast.error(t('common.delete'), conflictMessage(error, t('township.gates.inUse'), t));
    }
  };

  return (
    <>
      <AddRow
        label={t('township.gates.add')}
        value={name}
        onChange={setName}
        onSubmit={() => void add()}
        pending={create.isPending}
      />

      <Card>
        {gates.isPending ? <LoadingState /> : null}
        {gates.isError ? (
          <ErrorState message={errorMessage(gates.error, t)} onRetry={() => void gates.refetch()} />
        ) : null}
        {gates.data?.length === 0 ? (
          // A township with no gates cannot log a visit at all, so the empty state says why.
          <EmptyState icon={DoorOpen} title={t('township.gates.empty')} />
        ) : null}

        {gates.data && gates.data.length > 0 ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('township.gates.name')}</TH>
                  <TH>{t('users.columns.created')}</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <TBody>
                {gates.data.map((gate) => (
                  <TR key={gate.id}>
                    <TD className="font-medium">{gate.name}</TD>
                    <TD className="text-text-muted">{formatDateTime(gate.createdAt)}</TD>
                    <TD>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('common.delete')}
                        onClick={() => setDeleting({ id: gate.id, name: gate.name })}
                      >
                        <Trash2 className="text-danger" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t('township.gates.deleteTitle', { name: deleting.name }) : ''}
        description={t('township.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
