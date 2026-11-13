import {
  createUserRequestSchema,
  useCreateUser,
  usePropertyNodes,
  type CreateUserRequest,
  type CreatedUserResponse,
} from '@gatecrash/api';
import { PROVISIONABLE_ROLES, canBeSales, type UserRole } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applyFieldErrors, toastError } from '@/lib/errors';
import { useNomenclature } from '@/features/property/use-nomenclature';

/**
 * Account provisioning — FRONTEND.md §8.7.
 *
 * The role selector drives the form, because the backend derives a resident's login id from
 * their flat (`A-101-1`, `A-101-2`) and ignores any `loginId` sent for one. Showing the field
 * anyway would invite an admin to type something that is silently discarded.
 */
export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: CreatedUserResponse) => void;
}) {
  const { t } = useTranslation();
  // Depth is read from the level set rather than hardcoded: a resident lives at the addressable
  // level, which is depth 1 in a Block -> Flat project and depth 2 in Tower -> Floor -> Flat.
  const nom = useNomenclature();
  const flats = usePropertyNodes(
    { depth: nom.unitLevel?.depth ?? null },
    { enabled: nom.unitLevel != null },
  );
  const create = useCreateUser();

  const form = useForm<CreateUserRequest>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: { role: 'RESIDENT', fullName: '', loginId: '', phone: '', email: '', sales: false },
  });

  const role = form.watch('role');
  const isResident = role === 'RESIDENT';
  const salesAllowed = canBeSales(role);
  const sales = form.watch('sales') ?? false;

  const flatsByBlock = useMemo(() => {
    const groups = new Map<string, { name: string; flats: { id: string; number: string }[] }>();
    for (const flat of flats.data ?? []) {
      const key = flat.containerName ?? '';
      const group = groups.get(key) ?? { name: key, flats: [] };
      group.flats.push({ id: flat.id, number: flat.code ?? flat.name });
      groups.set(key, group);
    }
    return groups;
  }, [flats.data]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      // The body is built explicitly, field by field — never a spread. Jackson runs with
      // `fail-on-unknown-properties` and rejects anything it does not recognise (§4.3.1).
      const created = await create.mutateAsync({
        role: values.role,
        fullName: values.fullName.trim(),
        ...(isResident ? { flatId: values.flatId } : { loginId: values.loginId?.trim() }),
        ...(values.phone ? { phone: values.phone.trim() } : {}),
        ...(values.email ? { email: values.email.trim() } : {}),
        // Only ever sent as true, and only for a role allowed to carry it.
        ...(canBeSales(values.role) && values.sales ? { sales: true } : {}),
      });
      form.reset();
      onOpenChange(false);
      // Straight to the hand-off dialog: the password is in this callback's argument and must
      // reach the screen before anything can drop it (§8.7).
      onCreated(created);
    } catch (error) {
      const applied = applyFieldErrors(
        error,
        (name, err) => form.setError(name as keyof CreateUserRequest, err),
        ['loginId', 'fullName', 'phone', 'email', 'flatId', 'role'],
      );
      if (!applied) toastError(error, t);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.form.title')}</DialogTitle>
          <DialogDescription>{t('users.subtitle')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('users.form.role')} required>
            {(props) => (
              <Select
                value={role}
                onValueChange={(value) => {
                  form.setValue('role', value as UserRole);
                  // A resident cannot be on the sales team; clear the tick rather than send it.
                  if (!canBeSales(value as UserRole)) form.setValue('sales', false);
                }}
              >
                <SelectTrigger {...props}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* ADMIN and SUPER_ADMIN are absent on purpose: only a super admin appoints a
                      township's administrator, and a SUPER_ADMIN belongs to no township at all. */}
                  {PROVISIONABLE_ROLES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`role.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {isResident ? (
            <Field
              label={t('users.form.flat')}
              hint={t('users.form.flatHint')}
              error={form.formState.errors.flatId?.message}
              required
            >
              {(props) => (
                <Select
                  value={form.watch('flatId') ?? ''}
                  onValueChange={(value) => form.setValue('flatId', value)}
                >
                  <SelectTrigger {...props}>
                    <SelectValue placeholder={t('users.form.flatPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* SelectGroup, not a bare div: Radix requires it for SelectLabel, and it
                        is what gives a screen reader the "Block A, 12 items" grouping. */}
                    {[...flatsByBlock.entries()].map(([blockId, group]) => (
                      <SelectGroup key={blockId}>
                        <SelectLabel>{group.name}</SelectLabel>
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
          ) : (
            <Field
              label={t('users.form.loginId')}
              hint={t('users.form.loginIdHint')}
              error={form.formState.errors.loginId?.message}
              required
            >
              {(props) => (
                <Input {...props} {...form.register('loginId')} spellCheck={false} autoCapitalize="none" />
              )}
            </Field>
          )}

          <Field
            label={t('users.form.fullName')}
            error={form.formState.errors.fullName?.message}
            required
          >
            {(props) => <Input {...props} {...form.register('fullName')} />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('users.form.phone')} error={form.formState.errors.phone?.message}>
              {(props) => <Input {...props} {...form.register('phone')} type="tel" inputMode="tel" />}
            </Field>
            <Field label={t('users.form.email')} error={form.formState.errors.email?.message}>
              {(props) => <Input {...props} {...form.register('email')} type="email" />}
            </Field>
          </div>

          {salesAllowed ? (
            <SalesCheckbox
              checked={sales}
              onCheckedChange={(checked) => form.setValue('sales', checked)}
            />
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {create.isPending ? t('users.form.submitting') : t('users.form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "Is Sales" tick-box. Sales is not a role: it marks an admin or guard account as part of the
 * sales team, which is what lets them go on duty and be the person a "Meet Sales Agent" visitor
 * is routed to.
 */
export function SalesCheckbox({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={t('users.form.isSales')}
        className="mt-0.5"
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-text">{t('users.form.isSales')}</span>
        <span className="block text-xs text-text-muted">{t('users.form.isSalesHint')}</span>
      </span>
    </label>
  );
}
