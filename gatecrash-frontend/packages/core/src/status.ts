import type {
  NotifStatus,
  PassStatus,
  UserRole,
  VisitStatus,
  VisitorType,
} from './enums';

/**
 * The status vocabulary — FRONTEND.md §10.2.
 *
 * Visit statuses appear on six screens across two apps. Defining the label, the colour token and
 * the icon name once is what stops "Denied" on one screen and "Rejected" on another.
 *
 * `tone` is a design token name (§10.1), never a raw colour. `icon` is a lucide icon name, kept
 * as a string so this package stays free of any rendering dependency — mobile resolves the same
 * names against its own icon set.
 *
 * `labelKey` points into the i18n bundle; `label` is the English fallback for contexts with no
 * translator in scope (tests, CSV export, log lines).
 */

export type Tone =
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'pending'
  | 'muted'
  | 'primary';

export interface StatusMeta {
  readonly label: string;
  readonly labelKey: string;
  readonly tone: Tone;
  readonly icon: string;
}

export const VISIT_STATUS_META: Record<VisitStatus, StatusMeta> = {
  PENDING: {
    label: 'Waiting for approval',
    labelKey: 'status.visit.PENDING',
    tone: 'pending',
    icon: 'clock',
  },
  APPROVED: { label: 'Approved', labelKey: 'status.visit.APPROVED', tone: 'success', icon: 'check' },
  REJECTED: { label: 'Denied', labelKey: 'status.visit.REJECTED', tone: 'danger', icon: 'x' },
  EXPIRED: {
    label: 'No response',
    labelKey: 'status.visit.EXPIRED',
    tone: 'warning',
    icon: 'clock-alert',
  },
  CHECKED_IN: { label: 'Inside', labelKey: 'status.visit.CHECKED_IN', tone: 'info', icon: 'log-in' },
  CHECKED_OUT: {
    label: 'Left',
    labelKey: 'status.visit.CHECKED_OUT',
    tone: 'muted',
    icon: 'log-out',
  },
  LEFT_AT_GATE: {
    label: 'Parcel at gate',
    labelKey: 'status.visit.LEFT_AT_GATE',
    tone: 'warning',
    icon: 'package',
  },
  COLLECTED: {
    label: 'Parcel collected',
    labelKey: 'status.visit.COLLECTED',
    tone: 'muted',
    icon: 'ticket-check',
  },
};

export const PASS_STATUS_META: Record<PassStatus, StatusMeta> = {
  ACTIVE: { label: 'Active', labelKey: 'status.pass.ACTIVE', tone: 'success', icon: 'ticket' },
  REDEEMED: { label: 'Used', labelKey: 'status.pass.REDEEMED', tone: 'info', icon: 'ticket-check' },
  EXPIRED: { label: 'Expired', labelKey: 'status.pass.EXPIRED', tone: 'warning', icon: 'clock-alert' },
  REVOKED: { label: 'Revoked', labelKey: 'status.pass.REVOKED', tone: 'danger', icon: 'ban' },
};

export const VISITOR_TYPE_META: Record<VisitorType, StatusMeta> = {
  GUEST: { label: 'Guest', labelKey: 'status.visitorType.GUEST', tone: 'info', icon: 'user' },
  DELIVERY: {
    label: 'Delivery',
    labelKey: 'status.visitorType.DELIVERY',
    tone: 'warning',
    icon: 'package',
  },
  MAINTENANCE: {
    label: 'Maintenance',
    labelKey: 'status.visitorType.MAINTENANCE',
    tone: 'muted',
    icon: 'wrench',
  },
};

/** The sales-team badge — a flag on an ADMIN or GUARD account, shown beside the role. */
export const SALES_META: StatusMeta = {
  label: 'Sales',
  labelKey: 'users.salesBadge',
  tone: 'warning',
  icon: 'handshake',
};

export const NOTIF_STATUS_META: Record<NotifStatus, StatusMeta> = {
  QUEUED: { label: 'Queued', labelKey: 'status.notif.QUEUED', tone: 'pending', icon: 'clock' },
  SENT: { label: 'Sent', labelKey: 'status.notif.SENT', tone: 'success', icon: 'send' },
  FAILED: { label: 'Failed', labelKey: 'status.notif.FAILED', tone: 'danger', icon: 'triangle-alert' },
};

export const ROLE_META: Record<UserRole, StatusMeta> = {
  SUPER_ADMIN: {
    label: 'Super Admin',
    labelKey: 'role.SUPER_ADMIN',
    tone: 'danger',
    icon: 'shield-alert',
  },
  ADMIN: { label: 'Admin', labelKey: 'role.ADMIN', tone: 'primary', icon: 'shield' },
  GUARD: { label: 'Guard', labelKey: 'role.GUARD', tone: 'info', icon: 'shield-check' },
  RESIDENT: { label: 'Resident', labelKey: 'role.RESIDENT', tone: 'muted', icon: 'house' },
};
