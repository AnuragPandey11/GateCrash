import {
  NOTIF_STATUS_META,
  PASS_STATUS_META,
  ROLE_META,
  VISITOR_TYPE_META,
  VISIT_STATUS_META,
  type NotifStatus,
  type PassStatus,
  type StatusMeta,
  type UserRole,
  type VisitStatus,
  type VisitorType,
} from '@gatecrash/core';
import {
  Ban,
  Briefcase,
  Check,
  ClockAlert,
  Clock,
  Handshake,
  House,
  LogIn,
  LogOut,
  Package,
  Send,
  Shield,
  ShieldCheck,
  Ticket,
  TicketCheck,
  TriangleAlert,
  User,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from './ui/badge';

/**
 * The one place a status becomes pixels — FRONTEND.md §10.2.
 *
 * Label, tone and icon all come from `@gatecrash/core`, so "Denied" is "Denied" on all six
 * screens it appears on, and changing the vocabulary is a one-file change shared with mobile.
 */

const ICONS: Record<string, LucideIcon> = {
  clock: Clock,
  'clock-alert': ClockAlert,
  check: Check,
  x: X,
  'log-in': LogIn,
  'log-out': LogOut,
  ticket: Ticket,
  'ticket-check': TicketCheck,
  ban: Ban,
  user: User,
  package: Package,
  wrench: Wrench,
  briefcase: Briefcase,
  send: Send,
  'triangle-alert': TriangleAlert,
  shield: Shield,
  'shield-check': ShieldCheck,
  house: House,
  handshake: Handshake,
};

function MetaBadge({ meta }: { meta: StatusMeta }) {
  const { t } = useTranslation();
  const Icon = ICONS[meta.icon];
  return (
    <Badge tone={meta.tone} icon={Icon ? <Icon className="size-3" aria-hidden /> : null}>
      {t(meta.labelKey as 'status.visit.PENDING', meta.label)}
    </Badge>
  );
}

export const VisitStatusBadge = ({ status }: { status: VisitStatus }) => (
  <MetaBadge meta={VISIT_STATUS_META[status]} />
);

export const VisitorTypeBadge = ({ type }: { type: VisitorType }) => (
  <MetaBadge meta={VISITOR_TYPE_META[type]} />
);

export const PassStatusBadge = ({ status }: { status: PassStatus }) => (
  <MetaBadge meta={PASS_STATUS_META[status]} />
);

export const NotifStatusBadge = ({ status }: { status: NotifStatus }) => (
  <MetaBadge meta={NOTIF_STATUS_META[status]} />
);

export const RoleBadge = ({ role }: { role: UserRole }) => <MetaBadge meta={ROLE_META[role]} />;
