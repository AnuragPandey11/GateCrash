import type { UserRole } from '@gatecrash/core';
import {
  BadgeIndianRupee,
  Bell,
  BellRing,
  Inbox,
  Building2,
  DoorOpen,
  Dumbbell,
  Globe,
  Handshake,
  HardHat,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageSquare,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Ticket,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Who sees which screens — the one definition both the sidebar and the route table read, so a tab
 * can never appear without a route behind it, or a route exist with no way to reach it.
 *
 * This is navigation, never authorization (guardrail #4): every screen's API re-checks the role.
 */

export type NavKey =
  | 'nav.townships'
  | 'nav.occupancy'
  | 'nav.visits'
  | 'nav.notifications'
  | 'nav.community'
  | 'nav.users'
  | 'nav.township'
  | 'nav.helpdesk'
  | 'nav.amenities'
  | 'nav.moves'
  | 'nav.billing'
  | 'nav.gate'
  | 'nav.approvals'
  | 'nav.home'
  | 'nav.passes'
  | 'nav.bills'
  | 'nav.support'
  | 'nav.rules'
  | 'nav.helpers'
  | 'nav.staff'
  | 'nav.inbox'
  | 'nav.myInbox';

export type SectionKey =
  | 'nav.sectionPlatform'
  | 'nav.sectionTownship'
  | 'nav.sectionServices'
  | 'nav.sectionGate'
  | 'nav.sectionSales'
  | 'nav.sectionHome';

export interface NavItem {
  to: string;
  key: NavKey;
  icon: LucideIcon;
}

export interface NavSectionDef {
  key: SectionKey;
  items: NavItem[];
}

const OFFICE_TOWNSHIP: NavItem[] = [
  { to: '/occupancy', key: 'nav.occupancy', icon: LayoutDashboard },
  { to: '/visits', key: 'nav.visits', icon: ScrollText },
  { to: '/notifications', key: 'nav.notifications', icon: Megaphone },
  { to: '/inbox', key: 'nav.myInbox', icon: Inbox },
  { to: '/community', key: 'nav.community', icon: MessageSquare },
  { to: '/users', key: 'nav.users', icon: Users },
  { to: '/township', key: 'nav.township', icon: Building2 },
];

const OFFICE_SERVICES: NavItem[] = [
  { to: '/helpdesk', key: 'nav.helpdesk', icon: LifeBuoy },
  { to: '/amenities', key: 'nav.amenities', icon: Dumbbell },
  { to: '/moves', key: 'nav.moves', icon: Truck },
  { to: '/billing', key: 'nav.billing', icon: BadgeIndianRupee },
  { to: '/rules', key: 'nav.rules', icon: ShieldCheck },
  { to: '/staff', key: 'nav.staff', icon: HardHat },
];

const APPROVALS: NavItem = { to: '/approvals', key: 'nav.approvals', icon: Handshake };

export function navFor(input: {
  role: UserRole;
  sales: boolean;
  /** SUPER_ADMIN only: whether a township is selected to act inside. */
  townshipSelected: boolean;
}): NavSectionDef[] {
  const { role, sales, townshipSelected } = input;
  const salesSection: NavSectionDef[] = sales ? [{ key: 'nav.sectionSales', items: [APPROVALS] }] : [];

  switch (role) {
    case 'SUPER_ADMIN':
      return [
        { key: 'nav.sectionPlatform', items: [{ to: '/townships', key: 'nav.townships', icon: Globe }] },
        ...(townshipSelected
          ? [
              { key: 'nav.sectionTownship' as const, items: OFFICE_TOWNSHIP },
              { key: 'nav.sectionServices' as const, items: OFFICE_SERVICES },
            ]
          : []),
      ];
    case 'ADMIN':
      return [
        { key: 'nav.sectionTownship', items: OFFICE_TOWNSHIP },
        { key: 'nav.sectionServices', items: OFFICE_SERVICES },
        ...salesSection,
      ];
    case 'GUARD':
      return [
        {
          key: 'nav.sectionGate',
          items: [
            { to: '/gate', key: 'nav.gate', icon: DoorOpen },
            { to: '/visits', key: 'nav.visits', icon: ScrollText },
            { to: '/inbox', key: 'nav.inbox', icon: Bell },
            { to: '/community', key: 'nav.community', icon: MessageSquare },
          ],
        },
        ...salesSection,
      ];
    case 'RESIDENT':
      return [
        {
          key: 'nav.sectionHome',
          items: [
            { to: '/home', key: 'nav.home', icon: Home },
            { to: '/inbox', key: 'nav.inbox', icon: Bell },
            { to: '/passes', key: 'nav.passes', icon: Ticket },
            { to: '/community', key: 'nav.community', icon: MessageSquare },
          ],
        },
        {
          key: 'nav.sectionServices',
          items: [
            { to: '/bills', key: 'nav.bills', icon: ReceiptText },
            { to: '/support', key: 'nav.support', icon: LifeBuoy },
            { to: '/amenities', key: 'nav.amenities', icon: Dumbbell },
            { to: '/moves', key: 'nav.moves', icon: Truck },
            { to: '/rules', key: 'nav.rules', icon: ShieldCheck },
            { to: '/helpers', key: 'nav.helpers', icon: HardHat },
          ],
        },
      ];
  }
}

/** Where each role lands after sign-in. */
export function homeFor(role: UserRole, townshipSelected: boolean): string {
  switch (role) {
    case 'SUPER_ADMIN':
      return townshipSelected ? '/occupancy' : '/townships';
    case 'ADMIN':
      return '/occupancy';
    case 'GUARD':
      return '/gate';
    case 'RESIDENT':
      return '/home';
  }
}

/** Kept for any screen that wants to name the bell icon without importing lucide directly. */
export const ALERT_ICON = BellRing;
