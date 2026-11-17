import { useAudienceUsers, type AudienceUser } from '@gatecrash/api';
import type { AudienceRule, UserRole } from '@gatecrash/core';
import { ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/** The groups, in the order shown. SUPER_ADMIN belongs to no township and is never listed. */
const GROUPS = ['RESIDENT', 'GUARD', 'ADMIN'] as const satisfies readonly UserRole[];

type Tick = boolean | 'indeterminate';

const tick = (selected: number, total: number): Tick =>
  total > 0 && selected === total ? true : selected > 0 ? 'indeterminate' : false;

/**
 * "Everyone": every active account of the township, grouped by who they are. Nothing is ticked to
 * begin with and the groups start folded — the admin opens a group with its arrow and ticks
 * people, a whole group, or Select all. Ticking everyone sends the rule as ALL; anything less is
 * USERS (exactly these people), so the stored rule says what was meant.
 */
export function PeoplePicker({ rule, onChange }: { rule: AudienceRule; onChange: (rule: AudienceRule) => void }) {
  const { t } = useTranslation();
  const people = useAudienceUsers(true);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<UserRole>>(new Set());

  const all = useMemo(() => people.data ?? [], [people.data]);
  const selected = useMemo(
    () => (rule.mode === 'ALL' ? new Set(all.map((p) => p.id)) : new Set(rule.userIds ?? [])),
    [rule.mode, rule.userIds, all],
  );

  const emit = (next: Set<string>) =>
    onChange(all.length > 0 && next.size === all.length ? { mode: 'ALL' } : { mode: 'USERS', userIds: [...next] });

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    emit(next);
  };

  const toggleGroup = (role: UserRole) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const q = query.trim().toLowerCase();
  const visible = (p: AudienceUser) =>
    !q ||
    p.fullName.toLowerCase().includes(q) ||
    p.loginId.toLowerCase().includes(q) ||
    (p.unitCode ?? '').toLowerCase().includes(q);

  if (people.isPending) return <LoadingState />;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-text">
          <Checkbox
            checked={tick(selected.size, all.length)}
            onCheckedChange={() => setMany(all.map((p) => p.id), selected.size !== all.length)}
            aria-label={t('notifications.people.selectAll')}
          />
          {t('notifications.people.selectAll')}
          <span className="font-normal text-text-muted">
            {t('notifications.people.selectedOf', { selected: selected.size, total: all.length })}
          </span>
        </label>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('notifications.people.search')}
            aria-label={t('notifications.people.search')}
            className="pl-9"
          />
        </div>
      </div>

      <div className="scroll-panel max-h-[26rem] overflow-y-auto rounded-[12px] border border-border">
        {GROUPS.map((role) => {
          const members = all.filter((p) => p.role === role);
          if (members.length === 0) return null;
          const shown = members.filter(visible);
          // A search hides groups with no match and opens the ones that have one.
          if (q && shown.length === 0) return null;
          const open = expanded.has(role) || Boolean(q);
          const picked = members.filter((p) => selected.has(p.id)).length;
          const label = t(`notifications.people.group.${role}`);
          const listId = `people-group-${role}`;
          return (
            <section key={role} className="border-b border-border/60 last:border-b-0">
              <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface px-3 py-2.5">
                <Checkbox
                  checked={tick(picked, members.length)}
                  onCheckedChange={() => setMany(members.map((p) => p.id), picked !== members.length)}
                  aria-label={label}
                />
                <button
                  type="button"
                  onClick={() => toggleGroup(role)}
                  aria-expanded={open}
                  aria-controls={listId}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] text-left"
                >
                  <span className="text-xs font-semibold text-text">{label}</span>
                  <span className="text-xs text-text-muted">
                    {picked}/{members.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      'ml-auto size-4 shrink-0 text-text-muted transition-transform duration-200',
                      open && 'rotate-180',
                    )}
                    aria-hidden
                  />
                  <span className="sr-only">
                    {open ? t('notifications.people.collapse') : t('notifications.people.expand')}
                  </span>
                </button>
              </div>
              {open ? (
                <ul id={listId} className="grid gap-0.5 px-2 pb-2 animate-fade-in sm:grid-cols-2">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-sm transition-colors hover:bg-surface-raised',
                          !selected.has(p.id) && 'text-text-muted',
                        )}
                      >
                        <Checkbox
                          checked={selected.has(p.id)}
                          onCheckedChange={(v) => setMany([p.id], v === true)}
                          aria-label={p.fullName}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-text">{p.fullName}</span>
                          <span className="text-xs text-text-muted"> · {p.unitCode ?? p.loginId}</span>
                        </span>
                        {p.sales ? <Badge tone="info">{t('notifications.people.salesTag')}</Badge> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
        {q && all.filter(visible).length === 0 ? (
          <p className="px-3 py-4 text-sm text-text-muted">{t('notifications.picker.noMatches')}</p>
        ) : null}
      </div>
      <p className="text-xs text-text-muted">{t('notifications.people.noAccounts')}</p>
    </div>
  );
}
