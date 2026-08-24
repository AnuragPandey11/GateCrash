import { describe, expect, it } from 'vitest';
import { ApiException } from '../errors';
import {
  loginResponseSchema,
  meResponseSchema,
  redeemPassResponseSchema,
  visitResponseSchema,
} from './responses';
import { parseResponse } from './parse';

/**
 * Boundary parsing — FRONTEND.md §4.2 and §12's "contract" row.
 *
 * The payloads below are the shapes the **running backend** actually produces, not the shapes
 * Appendix B describes. The difference matters: the server runs with
 * `spring.jackson.default-property-inclusion: non_null`, so a null field is *omitted from the
 * JSON entirely*. A schema written from the spec alone would reject every one of these.
 */

describe('MeResponse', () => {
  it('parses an admin, whose flat fields the server omits entirely', () => {
    // Copied verbatim from `GET /auth/me` against a local backend: no flatId, no flatNumber,
    // no blockName — not present as null, simply absent.
    const fromServer = {
      id: '5c7f9e3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
      loginId: 'admin',
      fullName: 'Bootstrap Admin',
      role: 'ADMIN',
      mustResetPassword: true,
      onDuty: false,
    };

    const me = parseResponse(meResponseSchema, fromServer, 'session');

    // Normalised to null, so callers deal with one shape rather than "missing or null".
    expect(me.flatId).toBeNull();
    expect(me.flatNumber).toBeNull();
    expect(me.blockName).toBeNull();
    expect(me.mustResetPassword).toBe(true);
  });

  it('parses a resident, where the same fields are present', () => {
    const me = parseResponse(
      meResponseSchema,
      {
        id: '5c7f9e3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
        loginId: 'A-101-1',
        fullName: 'Ravi Kumar',
        role: 'RESIDENT',
        mustResetPassword: false,
        onDuty: false,
        flatId: '77777777-7777-4777-8777-777777777777',
        flatNumber: 'A-101',
        blockName: 'Block A',
      },
      'session',
    );

    expect(me.flatNumber).toBe('A-101');
  });

  it('rejects a role the client does not know', () => {
    // A new Postgres enum value shipped without a client release. Failing loudly beats routing
    // someone into a navigator that does not exist.
    expect(() =>
      parseResponse(
        meResponseSchema,
        { id: '5c7f9e3a-1b2c-4d5e-8f90-1a2b3c4d5e6f', loginId: 'x', fullName: 'x', role: 'JANITOR', mustResetPassword: false, onDuty: false },
        'session',
      ),
    ).toThrow(ApiException);
  });
});

describe('LoginResponse', () => {
  it('parses the live shape', () => {
    const login = parseResponse(
      loginResponseSchema,
      {
        accessToken: 'a.b.c',
        refreshToken: 'opaque',
        tokenType: 'Bearer',
        expiresInSeconds: 1800,
        mustResetPassword: true,
        role: 'ADMIN',
        userId: '5c7f9e3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
        fullName: 'Bootstrap Admin',
      },
      'login response',
    );

    expect(login.expiresInSeconds).toBe(1800);
    expect(login.mustResetPassword).toBe(true);
  });

  it('fails loudly if the token field is renamed', () => {
    // The whole reason this payload is parsed: a silent rename here produces a client that
    // sends `Bearer undefined` on every request.
    expect(() =>
      parseResponse(
        loginResponseSchema,
        { token: 'a.b.c', refreshToken: 'r', tokenType: 'Bearer', expiresInSeconds: 1, mustResetPassword: false, role: 'ADMIN', userId: '5c7f9e3a-1b2c-4d5e-8f90-1a2b3c4d5e6f', fullName: 'x' },
        'login response',
      ),
    ).toThrow(/unexpected login response/i);
  });
});

describe('VisitResponse', () => {
  const minimal = {
    id: '88888888-8888-4888-8888-888888888888',
    gateId: '55555555-5555-4555-8555-555555555555',
    gateName: 'Main Gate',
    visitorName: 'Anjali Desai',
    visitorType: 'GUEST',
    status: 'PENDING',
    loggedByName: 'Gate Guard 1',
    createdAt: '2026-07-23T14:30:00+05:30',
  };

  it('parses a visit with every optional field omitted', () => {
    const visit = parseResponse(visitResponseSchema, minimal, 'visit');

    // A pending walk-in with no phone, no vehicle and no photo is the *common* case at a gate.
    expect(visit.visitorPhone).toBeNull();
    expect(visit.vehicleNo).toBeNull();
    expect(visit.photoUrl).toBeNull();
    expect(visit.decidedAt).toBeNull();
    expect(visit.checkedInAt).toBeNull();
    expect(visit.checkedOutAt).toBeNull();
    expect(visit.preApprovalId).toBeNull();
  });

  it('keeps the fields that are present', () => {
    const visit = parseResponse(
      visitResponseSchema,
      {
        ...minimal,
        status: 'CHECKED_IN',
        visitorPhone: '+919876543210',
        vehicleNo: 'MH12AB1234',
        approverKind: 'RESIDENT',
        approverName: 'Ravi Kumar',
        targetFlatNumber: 'A-101',
        decidedAt: '2026-07-23T14:31:12+05:30',
        checkedInAt: '2026-07-23T14:32:04+05:30',
      },
      'visit',
    );

    expect(visit.status).toBe('CHECKED_IN');
    expect(visit.approverKind).toBe('RESIDENT');
    expect(visit.checkedInAt).toBe('2026-07-23T14:32:04+05:30');
  });

  it('rejects a status outside the FSM', () => {
    expect(() => parseResponse(visitResponseSchema, { ...minimal, status: 'MAYBE' }, 'visit')).toThrow(
      ApiException,
    );
  });

  it('names the offending field in the error, so drift is diagnosable', () => {
    try {
      parseResponse(visitResponseSchema, { ...minimal, status: 'MAYBE' }, 'visit');
      expect.unreachable();
    } catch (error) {
      expect((error as ApiException).message).toContain('status');
      expect((error as ApiException).code).toBe('CONTRACT_VIOLATION');
    }
  });
});

describe('RedeemPassResponse', () => {
  it('parses the nested visit, which arrives already CHECKED_IN', () => {
    const result = parseResponse(
      redeemPassResponseSchema,
      {
        passId: '99999999-9999-4999-8999-999999999999',
        remainingUses: 2,
        visit: {
          id: '88888888-8888-4888-8888-888888888888',
          gateId: '55555555-5555-4555-8555-555555555555',
          gateName: 'Main Gate',
          visitorName: 'Anjali Desai',
          visitorType: 'GUEST',
          status: 'CHECKED_IN',
          loggedByName: 'Gate Guard 1',
          createdAt: '2026-07-23T14:30:00+05:30',
          checkedInAt: '2026-07-23T14:30:00+05:30',
        },
      },
      'pass redemption',
    );

    // Redemption is the fast path: no approval wait at all (§9.3).
    expect(result.visit.status).toBe('CHECKED_IN');
    expect(result.remainingUses).toBe(2);
  });
});
