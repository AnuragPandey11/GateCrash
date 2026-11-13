import {
  useCreateGate,
  useCreatePropertyNode,
  useDeleteGate,
  useDeletePropertyNode,
  useGates,
  usePropertyNodes,
  type PropertyNodeResponse,
} from '@gatecrash/api';
import { asId, formatDateTime, type GateId, type PropertyNodeId } from '@gatecrash/core';
import * as Tabs from '@radix-ui/react-tabs';
import { Building2, DoorOpen, Home, Layers, Loader2, Plus, Trash2, Users } from 'lucide-react';
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
import { BulkNodesDialog } from '@/features/property/bulk-nodes';
import { LevelsCard } from '@/features/property/levels-card';
import { OccupancyDialog } from '@/features/property/occupancy-dialog';
import { useNomenclature } from '@/features/property/use-nomenclature';
import { conflictMessage, errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';

/**
 * Property structure — FRONTEND.md §8.8.
 *
 * **The tab strip is data, not markup.** It comes from `GET /admin/property/profile`, so a villa
 * community renders Clusters | Villas | Gates and a high-rise renders Towers | Floors | Flats |
 * Gates, out of exactly this component. That is the whole point of the level definitions: the panel
 * is tailored per developer without a per-developer build.
 *
 * Every tab below depth 0 needs a parent chosen before it can list or create anything, because
 * "all the floors in the project" is not a thing anyone files a unit into.
 *
 * A delete blocked by a foreign key comes back as `409 CONFLICT`, and each tab translates it into
 * the specific reason ("this villa has residents or visit history") rather than showing "Error 409"
 * — §11.2's rule that a conflict is a first-class outcome, not a crash.
 */
export function TownshipRoute() {
  const { t } = useTranslation();
  const nom = useNomenclature();

  if (nom.isPending) {
    return (
      <>
        <PageHeader
        eyebrow={t('pageEyebrow.property')} title={t('township.title')} description={t('township.subtitle')} />
        <Card>
          <LoadingState />
        </Card>
      </>
    );
  }

  if (nom.isError) {
    return (
      <>
        <PageHeader
        eyebrow={t('pageEyebrow.property')} title={t('township.title')} description={t('township.subtitle')} />
        <Card>
          <ErrorState message={errorMessage(nom.error, t)} onRetry={() => void nom.refetch()} />
        </Card>
      </>
    );
  }

  const firstTab = nom.levels[0] ? `level-${nom.levels[0].depth}` : 'gates';

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.property')} title={t('township.title')} description={t('township.subtitle')} />
      <Tabs.Root defaultValue={firstTab}>
        <Tabs.List className="mb-4 flex flex-wrap gap-1 border-b border-border">
          {nom.levels.map((level) => (
            <Tabs.Trigger
              key={level.depth}
              value={`level-${level.depth}`}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {level.plural}
            </Tabs.Trigger>
          ))}
          <Tabs.Trigger
            value="gates"
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            {t('township.tabs.gates')}
          </Tabs.Trigger>
          <Tabs.Trigger
            value="levels"
            className="-mb-px ml-auto border-b-2 border-transparent px-3 py-2 text-sm font-medium text-text-muted data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            {t('township.levels.title')}
          </Tabs.Trigger>
        </Tabs.List>

        {nom.levels.map((level) => (
          <Tabs.Content key={level.depth} value={`level-${level.depth}`}>
            <LevelTab depth={level.depth} />
          </Tabs.Content>
        ))}

        <Tabs.Content value="gates">
          <GatesTab />
        </Tabs.Content>
        <Tabs.Content value="levels">
          <LevelsCard />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

/** Icon per structural kind — the one place a `kind` legitimately drives presentation. */
function iconFor(kind: string) {
  if (kind === 'UNIT') return Home;
  if (kind === 'FLOOR') return Layers;
  return Building2;
}

/**
 * One level of the tree. Depth 0 lists roots; anything deeper first asks which parent, because a
 * floor belongs to a specific tower and creating one without saying which is meaningless.
 */
function LevelTab({ depth }: { depth: number }) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  const words = nom.words(depth);

  const level = nom.at(depth);
  const parentLevel = nom.at(depth - 1);
  const isRoot = depth === 0;
  const isUnit = level?.kind === 'UNIT';
  const isFloor = level?.kind === 'FLOOR';

  const [parentId, setParentId] = useState<PropertyNodeId | null>(null);
  const parents = usePropertyNodes({ depth: depth - 1 }, { enabled: !isRoot });
  const nodes = usePropertyNodes(
    isRoot ? { depth: 0 } : { parentId },
    { enabled: isRoot || parentId !== null },
  );

  const create = useCreatePropertyNode();
  const remove = useDeletePropertyNode();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [storey, setStorey] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [occupancyFor, setOccupancyFor] = useState<PropertyNodeResponse | null>(null);
  const [deleting, setDeleting] = useState<{ id: PropertyNodeId; name: string } | null>(null);

  const selectedParent = parents.data?.find((p) => p.id === parentId) ?? null;
  const canSubmit =
    name.trim().length > 0 && (isRoot || parentId !== null) && (!isFloor || storey.trim() !== '');

  const add = async () => {
    if (!canSubmit) return;
    try {
      await create.mutateAsync({
        parentId: isRoot ? null : parentId,
        name: name.trim(),
        ...(isUnit && code.trim() ? { code: code.trim() } : {}),
        ...(isFloor ? { levelNumber: Number(storey) } : {}),
      });
      setName('');
      setCode('');
      setStorey('');
    } catch (error) {
      toast.error(t('township.node.add', words), errorMessage(error, t));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleting(null);
      // A unit is blocked by residents; anything else by the things filed inside it. Different
      // causes, different fixes, so they get different sentences.
      const reason = isUnit
        ? t('township.node.occupied', words)
        : t('township.node.notEmpty', words);
      toast.error(t('common.delete'), conflictMessage(error, reason, t));
    }
  };

  const Icon = iconFor(level?.kind ?? 'BUILDING');

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {!isRoot ? (
          <div className="w-56">
            <Select
              value={toAny(parentId)}
              onValueChange={(v) =>
                setParentId(fromAny(v) ? asId.propertyNode(fromAny(v) as string) : null)
              }
            >
              <SelectTrigger aria-label={parentLevel?.singular ?? ''}>
                <SelectValue placeholder={parentLevel?.singular ?? ''} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>{parentLevel?.singular ?? ''}</SelectItem>
                {(parents.data ?? []).map((parent) => (
                  <SelectItem key={parent.id} value={parent.id}>
                    {parent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('township.node.name', words)}
          aria-label={t('township.node.name', words)}
          className="w-44"
          disabled={!isRoot && parentId === null}
        />

        {/* A unit's code defaults to its name server-side, so this stays optional. */}
        {isUnit ? (
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('township.node.code', words)}
            aria-label={t('township.node.code', words)}
            className="w-36"
            disabled={parentId === null}
          />
        ) : null}

        {isFloor ? (
          <Input
            type="number"
            value={storey}
            onChange={(e) => setStorey(e.target.value)}
            placeholder={t('township.node.storey')}
            aria-label={t('township.node.storey')}
            className="w-28"
            disabled={parentId === null}
          />
        ) : null}

        <Button onClick={() => void add()} disabled={!canSubmit || create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {t('township.node.add', words)}
        </Button>

        {/* Bulk generation fills a specific parent — "all towers" has no meaning for a range. */}
        {!isRoot && !isFloor ? (
          <Button
            variant="secondary"
            onClick={() => setBulkOpen(true)}
            disabled={parentId === null}
          >
            {t('township.bulk.add', words)}
          </Button>
        ) : null}
      </div>

      <Card>
        {nodes.isPending && (isRoot || parentId !== null) ? <LoadingState /> : null}
        {nodes.isError ? (
          <ErrorState message={errorMessage(nodes.error, t)} onRetry={() => void nodes.refetch()} />
        ) : null}

        {!isRoot && parentId === null ? (
          <EmptyState
            icon={Icon}
            title={t('township.node.emptyFirst', {
              ...words,
              levels: words.levels,
              children: words.levels,
            })}
          />
        ) : null}

        {nodes.data?.length === 0 && (isRoot || parentId !== null) ? (
          <EmptyState
            icon={Icon}
            title={
              isRoot
                ? t('township.node.empty', words)
                : t('township.node.emptyChild', {
                    ...words,
                    parent: selectedParent?.name ?? '',
                  })
            }
          />
        ) : null}

        {nodes.data && nodes.data.length > 0 ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH>{t('township.node.name', words)}</TH>
                  {isUnit ? <TH>{t('township.node.code', words)}</TH> : null}
                  {isFloor ? <TH>{t('township.node.storey')}</TH> : null}
                  {isUnit ? <TH>{t('township.node.occupancy')}</TH> : null}
                  {!isUnit ? <TH>{nom.childPlural(depth)}</TH> : null}
                  <TH>{t('users.columns.created')}</TH>
                  <TH className="w-20" />
                </tr>
              </THead>
              <TBody>
                {nodes.data.map((node) => (
                  <TR key={node.id}>
                    <TD className="font-medium">{node.name}</TD>
                    {isUnit ? <TD className="text-text-muted">{node.code}</TD> : null}
                    {isFloor ? <TD className="text-text-muted">{node.levelNumber}</TD> : null}
                    {isUnit ? (
                      <TD className="text-text-muted">
                        {/* Declared headcount first, logins second: the gap between them is how
                            many residents cannot yet be notified of anything. */}
                        {node.declaredOccupancy}
                        <span className="ml-2 text-xs">
                          {t('township.node.residents', { count: node.residentAccounts })}
                        </span>
                      </TD>
                    ) : null}
                    {!isUnit ? (
                      <TD className="text-text-muted">
                        {t('township.node.childCount', {
                          count: node.childCount,
                          level: nom.singular(depth + 1),
                          levels: nom.plural(depth + 1),
                        })}
                      </TD>
                    ) : null}
                    <TD className="text-text-muted">{formatDateTime(node.createdAt)}</TD>
                    <TD>
                      <div className="flex gap-1">
                        {isUnit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('township.node.setOccupancy')}
                            onClick={() => setOccupancyFor(node)}
                          >
                            <Users />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('common.delete')}
                          onClick={() => setDeleting({ id: node.id, name: node.name })}
                        >
                          <Trash2 className="text-danger" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : null}
      </Card>

      {parentId && selectedParent ? (
        <BulkNodesDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          parentId={parentId}
          parentName={selectedParent.name}
          depth={depth}
        />
      ) : null}

      {occupancyFor ? (
        <OccupancyDialog
          node={occupancyFor}
          unitLabel={nom.unitLevel?.singular ?? ''}
          onClose={() => setOccupancyFor(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t('township.node.deleteTitle', { name: deleting.name }) : ''}
        description={t('township.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

/** The shared "type a name, press Add" row. Gates are the only structure left that needs it. */
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
