/**
 * `@gatecrash/api` — the contract layer (FRONTEND.md §4).
 *
 * Everything in `apps/*` talks to the backend through this package and nothing else. The lint
 * rule `no-restricted-globals: fetch` outside this package is what keeps that true (§3).
 */

export { ApiClient, createApiClient, type ApiClientOptions, type RequestOptions } from './client';
export { CORRELATION_HEADER, correlationId } from './correlation';
export {
  ApiException,
  API_ERROR_CODES,
  CONTRACT_VIOLATION_CODE,
  NETWORK_ERROR_CODE,
  fieldErrorMap,
  hasErrorCode,
  isApiException,
  toApiException,
  type ApiErrorBody,
  type ApiErrorCode,
  type ApiFieldError,
} from './errors';
export {
  REFRESH_TOKEN_KEY,
  SessionExpired,
  SessionManager,
  createWebTokenStore,
  endsSession,
  isSessionExpired,
  type LoginResponseLike,
  type SessionEndReason,
  type SessionManagerOptions,
  type TokenStore,
  type Tokens,
} from './session';
export { logout, type LogoutOptions } from './logout';
export * from './pagination';
export * from './filters';
export * from './schemas';
export * from './endpoints';
export * from './queries';

// Branded ids originate in `@gatecrash/core` (see the note in `core/src/ids.ts`), re-exported
// here so the import path in §4.6 resolves.
export type {
  BlockId,
  DeviceId,
  FlatId,
  GateId,
  InboxItemId,
  NotificationId,
  PassId,
  PostId,
  QrToken,
  UserId,
  VisitId,
} from '@gatecrash/core';
