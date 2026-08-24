import { createHandlers } from '@gatecrash/api/mocks';
import { setupServer } from 'msw/node';

/**
 * The MSW server, built from the handlers in `packages/api` — §12.
 *
 * Shared with (eventually) the mobile app rather than duplicated, so a contract change breaks
 * one set of mocks and one test run, not two that drift apart.
 */
export const TEST_API_URL = 'http://localhost:8080';

export const server = setupServer(...createHandlers(TEST_API_URL));
