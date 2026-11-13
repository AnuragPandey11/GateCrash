import {
  PAGE_DEFAULTS,
  useAddTownshipAdmin,
  useRemoveTownshipAdmin,
  useTownshipAdmins,
  useTownshipLifecycle,
  useTownships,
  type PageArgs,
  type TownshipResponse,
} from '@gatecrash/api';
import {
  formatDateTime,
  type TownshipId,
  type UserId,
} from '@gatecrash/core';
import { Building2, Check, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { OnboardingWizard } from '@/features/platform/onboarding-wizard';
import { CredentialDialog } from '@/features/users/credential-dialog';
import { errorMessage, toastError } from '@/lib/errors';
import { useSessionStore } from '@/lib/session';
import { toast } from '@/lib/toast';

/**
 * The platform console — FRONTEND.md §16 phase F5b.
 *
 * Two jobs, and the second one is what makes the rest of the app work for a super admin at all:
 *
 *  1. The township lifecycle — onboard, suspend, archive, restore, and appoint administrators.
 *  2. **Selecting the township to act inside.** A `SUPER_ADMIN` belongs to none, so every
 *     township-scoped endpoint answers `422 TOWNSHIP_CONTEXT_REQUIRED` until one is chosen. The
 *     router sends an operator here first for exactly that reason; picking one writes
 *     `actingTownshipId`, which `ApiClient` turns into the `X-Township-Id` header on every
 *     subsequent request.
 *
 * Archiving is the one action here that takes a whole community offline in a single request, so it
 * is the one place in this app that asks for typed confirmation rather than a second click. The
 * rule elsewhere (`ConfirmDialog`) is that typing trains people to type without reading — the
 * exception earns itself when a mis-clicked row locks out every resident and guard in a township.
 */
export function TownshipsRoute() {
  const { t } = useTranslation();
  const [page, setPage] = useState<PageArgs>({ page: 1, size: PAGE_DEFAULTS.users });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<TownshipId | null>(null);
  const [credentials, setCredentials] = useState<{
    loginId: string;
    password: string;
    fullName: string;
    townshipCode: string;
  } | null>(null);

  const actingTownshipId = useSessionStore((s) => s.actingTownshipId);
  const setActingTownship = useSessionStore((s) => s.setActingTownship);

  const query = useTownships(page, includeArchived);
  const lifecycle = useTownshipLifecycle();

  const rows = query.data?.content ?? [];

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.platform')}
        title={t('townships.title')}
        description={t('townships.subtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setIncludeArchived((v) => !v);
                setPage((p) => ({ ...p, page: 1 }));
              }}
            >
              {includeArchived ? t('townships.hideArchived') : t('townships.showArchived')}
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('townships.create')}
            </Button>
          </>
        }
      />

      <Card>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t('townships.empty')}
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                {t('townships.create')}
              </Button>
            }
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>{t('townships.code')}</TH>
                  <TH>{t('townships.name')}</TH>
                  <TH>{t('townships.status')}</TH>
                  <TH>{t('townships.admins')}</TH>
                  <TH>{t('townships.users')}</TH>
                  <TH>{t('townships.createdAt')}</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {rows.map((township) => (
                  <TownshipRow
                    key={township.id}
                    township={township}
                    isActing={township.id === actingTownshipId}
                    isExpanded={township.id === expanded}
                    onToggleAdmins={() =>
                      setExpanded((current) => (current === township.id ? null : township.id))
                    }
                    onSelect={() => {
                      setActingTownship(township.id);
                      toast.show({
                        title: t('townships.acting') + ': ' + township.name,
                        tone: 'info',
                      });
                    }}
                    lifecycle={lifecycle}
                    onCredentials={setCredentials}
                  />
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
        {query.data ? (
          <Pagination
            page={query.data}
            onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))}
          />
        ) : null}
      </Card>

      {creating ? (
        <OnboardingWizard
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setCredentials(created);
          }}
        />
      ) : null}

      {credentials ? (
        <CredentialDialog
          open
          loginId={credentials.loginId}
          password={credentials.password}
          fullName={credentials.fullName}
          townshipCode={credentials.townshipCode}
          onDismiss={() => setCredentials(null)}
        />
      ) : null}
    </>
  );
}

type Lifecycle = ReturnType<typeof useTownshipLifecycle>;

function TownshipRow({
  township,
  isActing,
  isExpanded,
  onToggleAdmins,
  onSelect,
  lifecycle,
  onCredentials,
}: {
  township: TownshipResponse;
  isActing: boolean;
  isExpanded: boolean;
  onToggleAdmins: () => void;
  onSelect: () => void;
  lifecycle: Lifecycle;
  onCredentials: (c: {
    loginId: string;
    password: string;
    fullName: string;
    townshipCode: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<'suspend' | 'restore' | null>(null);
  const [archiving, setArchiving] = useState(false);

  const archived = township.status === 'ARCHIVED';

  return (
    <>
      <TR>
        <TD>
          <code className="font-credential text-text">{township.code}</code>
        </TD>
        <TD>{township.name}</TD>
        <TD>
          <Badge
            tone={
              township.status === 'ACTIVE'
                ? 'success'
                : township.status === 'SUSPENDED'
                  ? 'warning'
                  : 'muted'
            }
          >
            {t(`townships.status_${township.status}`)}
          </Badge>
        </TD>
        <TD>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-text"
            onClick={onToggleAdmins}
          >
            {township.activeAdminCount}
          </button>
        </TD>
        <TD>{township.activeUserCount}</TD>
        <TD className="whitespace-nowrap text-text-muted">{formatDateTime(township.createdAt)}</TD>
        <TD className="text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Acting inside an archived township is refused by the server (409), so the control
                is not offered — an operator has to restore it first, which is the honest order. */}
            {archived ? null : isActing ? (
              <Badge tone="info">
                <Check aria-hidden className="size-3" />
                {t('townships.selected')}
              </Badge>
            ) : (
              <Button variant="secondary" size="sm" onClick={onSelect}>
                {t('townships.select')}
              </Button>
            )}

            {township.status === 'ACTIVE' ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirming('suspend')}>
                {t('townships.suspend')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming('restore')}>
                {t('townships.restore')}
              </Button>
            )}

            {archived ? null : (
              <Button variant="ghost" size="sm" onClick={() => setArchiving(true)}>
                {t('townships.archive')}
              </Button>
            )}
          </div>
        </TD>
      </TR>

      {isExpanded ? (
        <TR>
          <TD colSpan={7} className="bg-surface-raised">
            <TownshipAdmins township={township} onCredentials={onCredentials} />
          </TD>
        </TR>
      ) : null}

      <ConfirmDialog
        open={confirming === 'suspend'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('townships.suspendConfirmTitle')}
        description={t('townships.suspendConfirmBody', { name: township.name })}
        confirmLabel={t('townships.suspend')}
        destructive
        pending={lifecycle.suspend.isPending}
        onConfirm={() => {
          lifecycle.suspend.mutate(township.id, {
            onSuccess: () => setConfirming(null),
            onError: (error) => toastError(error, t),
          });
        }}
      />

      <ConfirmDialog
        open={confirming === 'restore'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t('townships.restoreConfirmTitle')}
        description={t('townships.restoreConfirmBody', { name: township.name })}
        confirmLabel={t('townships.restore')}
        pending={lifecycle.restore.isPending}
        onConfirm={() => {
          lifecycle.restore.mutate(township.id, {
            onSuccess: () => setConfirming(null),
            onError: (error) => toastError(error, t),
          });
        }}
      />

      {archiving ? (
        <ArchiveTownshipDialog
          township={township}
          lifecycle={lifecycle}
          onClose={() => setArchiving(false)}
        />
      ) : null}
    </>
  );
}

/**
 * The one typed-confirmation dialog in the app.
 *
 * The server requires the township's own code in the body, so this mirrors a real backend check
 * rather than inventing client-side friction — and it states plainly that history is kept and the
 * action reverses, because "Archive" next to a red button reads as "Delete" to everyone.
 */
function ArchiveTownshipDialog({
  township,
  lifecycle,
  onClose,
}: {
  township: TownshipResponse;
  lifecycle: Lifecycle;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toUpperCase() === township.code.toUpperCase();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('townships.archiveConfirmTitle', { code: township.code })}</DialogTitle>
          <DialogDescription>
            {t('townships.archiveConfirmBody', { name: township.name })}
          </DialogDescription>
        </DialogHeader>

        <Field
          label={t('townships.archiveConfirmLabel', { code: township.code })}
          error={typed && !matches ? t('townships.archiveConfirmMismatch') : undefined}
        >
          {(props) => (
            <Input
              {...props}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="uppercase"
            />
          )}
        </Field>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!matches || lifecycle.archive.isPending}
            onClick={() => {
              lifecycle.archive.mutate(
                { id: township.id, confirmCode: typed.trim() },
                { onSuccess: onClose, onError: (error) => toastError(error, t) },
              );
            }}
          >
            {t('townships.archive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TownshipAdmins({
  township,
  onCredentials,
}: {
  township: TownshipResponse;
  onCredentials: (c: {
    loginId: string;
    password: string;
    fullName: string;
    townshipCode: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const query = useTownshipAdmins(township.id);
  const add = useAddTownshipAdmin();
  const remove = useRemoveTownshipAdmin();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<UserId | null>(null);
  const [loginId, setLoginId] = useState('');
  const [fullName, setFullName] = useState('');

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <ShieldCheck aria-hidden className="size-4" />
          {t('townships.adminsTitle', { name: township.name })}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          {t('townships.addAdmin')}
        </Button>
      </div>

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, t)} onRetry={() => void query.refetch()} />
      ) : (
        <ul className="space-y-1">
          {(query.data ?? []).map((admin) => (
            <li
              key={admin.id}
              className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2"
            >
              <span className="text-sm text-text">
                <code className="font-credential">{admin.loginId}</code> — {admin.fullName}
              </span>
              <span className="flex items-center gap-2">
                {admin.active ? null : <Badge tone="muted">{t('users.inactive')}</Badge>}
                {admin.active ? (
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(admin.id)}>
                    {t('townships.removeAdmin')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onOpenChange={(open) => !open && setAdding(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('townships.addAdmin')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('townships.form.adminLoginId')} required>
              {(props) => (
                <Input
                  {...props}
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  spellCheck={false}
                  autoCapitalize="none"
                />
              )}
            </Field>
            <Field label={t('townships.form.adminFullName')} required>
              {(props) => (
                <Input
                  {...props}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!loginId.trim() || !fullName.trim() || add.isPending}
              onClick={() => {
                add.mutate(
                  {
                    id: township.id,
                    body: { loginId: loginId.trim(), fullName: fullName.trim() },
                  },
                  {
                    onSuccess: (created) => {
                      setAdding(false);
                      setLoginId('');
                      setFullName('');
                      // Straight into the one-time dialog: this password exists nowhere else.
                      onCredentials({
                        loginId: created.loginId,
                        password: created.generatedPassword,
                        fullName: created.fullName,
                        townshipCode: township.code,
                      });
                    },
                    onError: (error) => toastError(error, t),
                  },
                );
              }}
            >
              {t('townships.addAdmin')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('townships.removeAdminConfirmTitle')}
        description={t('townships.removeAdminConfirmBody')}
        confirmLabel={t('townships.removeAdmin')}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(
            { id: township.id, userId: removing },
            {
              onSuccess: () => setRemoving(null),
              // The server refuses the last active admin (409 LAST_TOWNSHIP_ADMIN); surfacing that
              // message verbatim tells the operator exactly what to do about it.
              onError: (error) => toastError(error, t),
            },
          );
        }}
      />
    </div>
  );
}

