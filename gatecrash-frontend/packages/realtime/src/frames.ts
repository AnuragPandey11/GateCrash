import type { GateId, NotificationId, VisitId, VisitStatus, VisitorType } from '@gatecrash/core';

/**
 * What the backend actually publishes — FRONTEND.md §6.1, read off `RealtimeEvents.java` and
 * `NotificationDispatcher`.
 *
 * Every frame carries a `type` discriminator, so consumers switch on it and TypeScript narrows.
 *
 * The important property, and the one that shapes every screen: **frames carry display text and
 * ids only** — no phone numbers, no photo URLs, no vehicle numbers. A card rendered purely from a
 * frame is therefore incomplete *by design*; opening it fetches `GET /visits/{id}`. That is not
 * an oversight to work around, it is the socket deliberately not being a second copy of the API.
 */

export interface VisitRequestedFrame {
  type: 'VISIT_REQUESTED';
  visitId: VisitId;
  gateId: GateId;
  gateName: string;
  visitorName: string;
  visitorType: VisitorType;
  flatNumber: string | null;
  createdAt: string;
}

export interface VisitDecidedFrame {
  type: 'VISIT_DECIDED';
  visitId: VisitId;
  gateId: GateId;
  status: VisitStatus;
  visitorName: string;
  decidedByName: string;
  decidedAt: string;
}

export interface VisitExpiredFrame {
  type: 'VISIT_EXPIRED';
  visitId: VisitId;
  gateId: GateId;
  visitorName: string;
}

export interface OccupancyChangedFrame {
  type: 'OCCUPANCY_CHANGED';
  visitId: VisitId;
  status: VisitStatus;
  visitorName: string;
  gateName: string;
  insideCount: number;
  at: string;
}

/**
 * Sent as a plain string map by `NotificationDispatcher`, not a typed record — so every value
 * arrives as a string even where it reads like a number. Parse, do not assume (§7.1).
 */
export interface AnnouncementFrame {
  type: 'ANNOUNCEMENT';
  notificationId: NotificationId;
  title: string;
  body: string;
}

export type RealtimeFrame =
  | VisitRequestedFrame
  | VisitDecidedFrame
  | VisitExpiredFrame
  | OccupancyChangedFrame
  | AnnouncementFrame;

export type RealtimeFrameType = RealtimeFrame['type'];

const FRAME_TYPES: readonly RealtimeFrameType[] = [
  'VISIT_REQUESTED',
  'VISIT_DECIDED',
  'VISIT_EXPIRED',
  'OCCUPANCY_CHANGED',
  'ANNOUNCEMENT',
];

/**
 * Parse a STOMP message body into a frame, or `null`.
 *
 * A frame that does not parse is dropped rather than thrown: the socket is an accelerant, and
 * one malformed message must not take down a connection the whole gate console depends on.
 * Postgres remains the source of truth and the next reconciliation fetch will correct the screen.
 */
export function parseFrame(body: string): RealtimeFrame | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !FRAME_TYPES.includes(type as RealtimeFrameType)) return null;
  return value as RealtimeFrame;
}

export function isVisitFrame(
  frame: RealtimeFrame,
): frame is VisitRequestedFrame | VisitDecidedFrame | VisitExpiredFrame {
  return (
    frame.type === 'VISIT_REQUESTED' ||
    frame.type === 'VISIT_DECIDED' ||
    frame.type === 'VISIT_EXPIRED'
  );
}
