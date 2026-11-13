import {
  PAGE_DEFAULTS,
  useResetPassword,
  useSetUserActive,
  useUpdateUser,
  useUsers,
  updateUserRequestSchema,
  type PageArgs,
  type UpdateUserRequest,
  type UserFilters,
  type UserResponse,
} from '@gatecrash/api';
import { USER_ROLES, canBeSales, formatDateTime, type UserId, type UserRole } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Plus, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { RoleBadge, SalesBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
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
import { CreateUserDialog, SalesCheckbox } from '@/features/users/create-user-dialog';
import { CredentialDialog } from '@/features/users/credential-dialog';
import { useDebounced } from '@/lib/use-debounced';
import { applyFieldErrors, errorMessage, toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

/**
 * Users — FRONTEND.md §8.7.
 *
 * Every account in the product is provisioned here; there is no self-signup anywhere. The create
 * flow is the important one, and its payoff — the one-time credential dialog — is deliberately
 * hard to dismiss by accident.
 */

interface Credentials {
  loginId: string;
  password: string;
  fullName: string;
  isReset: boolean;
}

export function UsersRoute() {
  const { t } = useTranslation();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [sales, setSales] = useState<boolean | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [page, setPage] = useState<PageArgs>({ page: 1, size: PAGE_DEFAULTS.users });

  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [editing, setEditing] = useState<UserResponse | null>(null);
  const [confirming, setConfirming] = useState<
    { kind: 'deactivate' | 'activate' | 'reset'; user: UserResponse } | null
  >(null);

  const debouncedSearch = useDebounced(search, 300);
  const filters: UserFilters = { role, sales, active, search: debouncedSearch || null };
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useUsers(filters, page);

  const setActiveMutation = useSetUserActive();
  const resetPassword = useResetPassword();

  const runConfirm = async () => {
    if (!confirming) return;
    const { kind, user } = confirming;
    try {
      if (kind === 'reset') {
        const result = await resetPassword.mutateAsync(user.id);
        setConfirming(null);
        // Straight into the hand-off dialog. `generatedPassword` exists in this variable and
        // in that component's props — nowhere else, ever (guardrail #3).
        setCredentials({
          loginId: result.loginId,
          password: result.generatedPassword,
          fullName: user.fullName,
          isReset: true,
        });
        return;
      }
      await setActiveMutation.mutateAsync({ id: user.id, active: kind === 'activate' });
      setConfirming(null);
    } catch (err) {
      setConfirming(null);
      toastError(err, t);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.people')}
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('users.create')}
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('common.search')}>
            {(props) => (
              <Input
                {...props}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage((p) => ({ ...p, page: 1 }));
                }}
                placeholder={t('users.searchPlaceholder')}
              />
            )}
          </Field>

          <Field label={t('users.filters.role')}>
            {(props) => (
              <Select
                value={toAny(role)}
                onValueChange={(v) => {
                  setRole(fromAny(v) as UserRole | null);
                  setPage((p) => ({ ...p, page: 1 }));
                }}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('users.filters.anyRole')}</SelectItem>
                  {USER_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`role.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('users.filters.team')}>
            {(props) => (
              <Select
                value={sales === null ? ANY_VALUE : String(sales)}
                onValueChange={(v) => {
                  setSales(v === ANY_VALUE ? null : v === 'true');
                  setPage((p) => ({ ...p, page: 1 }));
                }}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('common.all')}</SelectItem>
                  <SelectItem value="true">{t('users.filters.salesOnly')}</SelectItem>
                  <SelectItem value="false">{t('users.filters.notSales')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>

          <Field label={t('users.filters.status')}>
            {(props) => (
              <Select
                value={active === null ? ANY_VALUE : String(active)}
                onValueChange={(v) => {
                  setActive(v === ANY_VALUE ? null : v === 'true');
                  setPage((p) => ({ ...p, page: 1 }));
                }}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>{t('common.all')}</SelectItem>
                  <SelectItem value="true">{t('users.filters.active')}</SelectItem>
                  <SelectItem value="false">{t('users.filters.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        {isPending ? <LoadingState /> : null}
        {isError && !data ? (
          <ErrorState message={errorMessage(error, t)} onRetry={() => void refetch()} />
        ) : null}
        {data && data.content.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={t('users.empty')}
            action={
              <Button onClick={() => setCreating(true)}>
                <UserPlus aria-hidden />
                {t('users.create')}
              </Button>
            }
          />
        ) : null}

        {data && data.content.length > 0 ? (
          <>
            <TableWrap className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
              <Table>
                <THead>
                  <tr>
                    <TH>{t('users.columns.name')}</TH>
                    <TH>{t('users.columns.loginId')}</TH>
                    <TH>{t('users.columns.role')}</TH>
                    <TH>{t('users.columns.flat')}</TH>
                    <TH>{t('users.columns.contact')}</TH>
                    <TH>{t('users.columns.status')}</TH>
                    <TH>{t('users.columns.created')}</TH>
                    <TH className="w-10" />
                  </tr>
                </THead>
                <TBody>
                  {data.content.map((user) => (
                    <TR key={user.id}>
                      <TD className="font-medium">{user.fullName}</TD>
                      <TD className="font-credential text-sm">{user.loginId}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <RoleBadge role={user.role} />
                          {user.sales ? <SalesBadge /> : null}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap">
                        {user.flatNumber ? (
                          <>
                            {user.flatNumber}
                            <span className="block text-xs text-text-muted">{user.blockName}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </TD>
                      <TD className="text-text-muted">
                        {user.phone ?? '—'}
                        {user.email ? (
                          <span className="block truncate text-xs">{user.email}</span>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={user.active ? 'success' : 'muted'}>
                            {user.active ? t('users.active') : t('users.inactive')}
                          </Badge>
                          {user.mustResetPassword ? (
                            <Badge tone="warning">{t('users.mustReset')}</Badge>
                          ) : null}
                          {user.sales ? (
                            <Badge tone={user.onDuty ? 'info' : 'muted'}>
                              {user.onDuty ? t('users.onDuty') : t('users.offDuty')}
                            </Badge>
                          ) : null}
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap text-text-muted">
                        {formatDateTime(user.createdAt)}
                      </TD>
                      <TD>
                        <RowMenu
                          user={user}
                          onEdit={() => setEditing(user)}
                          onReset={() => setConfirming({ kind: 'reset', user })}
                          onToggleActive={() =>
                            setConfirming({
                              kind: user.active ? 'deactivate' : 'activate',
                              user,
                            })
                          }
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <Pagination page={data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} />
          </>
        ) : null}
      </Card>

      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(user) =>
          setCredentials({
            loginId: user.loginId,
            password: user.generatedPassword,
            fullName: user.fullName,
            isReset: false,
          })
        }
      />

      {credentials ? (
        <CredentialDialog
          open
          loginId={credentials.loginId}
          password={credentials.password}
          fullName={credentials.fullName}
          isReset={credentials.isReset}
          // Clearing the state is what actually destroys the password — it was never anywhere
          // else to begin with.
          onDismiss={() => setCredentials(null)}
        />
      ) : null}

      {editing ? <EditUserDialog user={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={
          confirming
            ? t(
                confirming.kind === 'reset'
                  ? 'users.resetTitle'
                  : confirming.kind === 'activate'
                    ? 'users.activateTitle'
                    : 'users.deactivateTitle',
                { name: confirming.user.fullName },
              )
            : ''
        }
        description={
          confirming
            ? t(
                confirming.kind === 'reset'
                  ? 'users.resetBody'
                  : confirming.kind === 'activate'
                    ? 'users.activateBody'
                    : 'users.deactivateBody',
              )
            : ''
        }
        confirmLabel={
          confirming
            ? t(
                confirming.kind === 'reset'
                  ? 'users.actions.resetPassword'
                  : confirming.kind === 'activate'
                    ? 'users.actions.activate'
                    : 'users.actions.deactivate',
              )
            : ''
        }
        destructive={confirming?.kind !== 'activate'}
        pending={setActiveMutation.isPending || resetPassword.isPending}
        onConfirm={() => void runConfirm()}
      />
    </>
  );
}

function RowMenu({
  user,
  onEdit,
  onReset,
  onToggleActive,
}: {
  user: UserResponse;
  onEdit: () => void;
  onReset: () => void;
  onToggleActive: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${t('common.filter')} ${user.fullName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Item
            onSelect={onEdit}
            className="cursor-default rounded-sm px-2 py-1.5 text-sm text-text outline-none data-[highlighted]:bg-surface-raised"
          >
            {t('users.actions.edit')}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={onReset}
            className="cursor-default rounded-sm px-2 py-1.5 text-sm text-text outline-none data-[highlighted]:bg-surface-raised"
          >
            {t('users.actions.resetPassword')}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={onToggleActive}
            className="cursor-default rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-raised"
          >
            <span className={user.active ? 'text-danger' : 'text-text'}>
              {user.active ? t('users.actions.deactivate') : t('users.actions.activate')}
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * `PATCH /admin/users/{id}` edits `fullName`, `phone`, `email` and — for admin and guard
 * accounts — sales-team membership.
 *
 * The body is built from exactly those fields. Sending back a spread of the row would include
 * `role`, `active` and `createdAt`, and Jackson's `fail-on-unknown-properties` would answer
 * `400 MALFORMED_BODY` (§4.3.1).
 */
function EditUserDialog({ user, onClose }: { user: UserResponse; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateUser();

  const form = useForm<UpdateUserRequest>({
    resolver: zodResolver(updateUserRequestSchema),
    defaultValues: {
      fullName: user.fullName,
      phone: user.phone ?? '',
      email: user.email ?? '',
      sales: user.sales,
    },
  });
  const salesAllowed = canBeSales(user.role);
  const sales = form.watch('sales') ?? false;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        id: user.id as UserId,
        body: {
          fullName: values.fullName?.trim(),
          phone: values.phone?.trim() || undefined,
          email: values.email?.trim() || undefined,
          // Sent only when it changed, so an edit to a phone number never touches duty state.
          ...(salesAllowed && values.sales !== undefined && values.sales !== user.sales
            ? { sales: values.sales }
            : {}),
        },
      });
      toast.success(t('users.edit.saved'));
      onClose();
    } catch (error) {
      const applied = applyFieldErrors(
        error,
        (name, err) => form.setError(name as keyof UpdateUserRequest, err),
        ['fullName', 'phone', 'email'],
      );
      if (!applied) toastError(error, t);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.edit.title', { name: user.fullName })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('users.form.fullName')} error={form.formState.errors.fullName?.message}>
            {(props) => <Input {...props} {...form.register('fullName')} />}
          </Field>
          <Field label={t('users.form.phone')} error={form.formState.errors.phone?.message}>
            {(props) => <Input {...props} {...form.register('phone')} type="tel" inputMode="tel" />}
          </Field>
          <Field label={t('users.form.email')} error={form.formState.errors.email?.message}>
            {(props) => <Input {...props} {...form.register('email')} type="email" />}
          </Field>
          {salesAllowed ? (
            <SalesCheckbox
              checked={sales}
              onCheckedChange={(checked) => form.setValue('sales', checked, { shouldDirty: true })}
            />
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
