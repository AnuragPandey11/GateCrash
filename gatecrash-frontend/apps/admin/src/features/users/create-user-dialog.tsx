import {
  createUserRequestSchema,
  useCreateUser,
  useFlats,
  type CreateUserRequest,
  type CreatedUserResponse,
} from '@gatecrash/api';
import { PROVISIONABLE_ROLES, type UserRole } from '@gatecrash/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
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
  const flats = useFlats();
  const create = useCreateUser();

  const form = useForm<CreateUserRequest>({
    resolver: zodResolver(createUserRequestSchema),
    defaultValues: { role: 'RESIDENT', fullName: '', loginId: '', phone: '', email: '' },
  });

  const role = form.watch('role');
  const isResident = role === 'RESIDENT';

  const flatsByBlock = useMemo(() => {
    const groups = new Map<string, { name: string; flats: { id: string; number: string }[] }>();
    for (const flat of flats.data ?? []) {
      const group = groups.get(flat.blockId) ?? { name: flat.blockName, flats: [] };
      group.flats.push({ id: flat.id, number: flat.number });
      groups.set(flat.blockId, group);
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
                onValueChange={(value) => form.setValue('role', value as UserRole)}
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
