import type { PropertyNodeResponse } from '@gatecrash/api';
import type { PropertyNodeId, PropertyNodeKind } from '@gatecrash/core';
import { describe, expect, it } from 'vitest';
import {
  breadcrumb,
  buildTree,
  checkStates,
  coveredUnits,
  normalize,
  toggle,
} from './node-selection';

/**
 * Tower A (floors 1, 2; two flats each) and Tower B (floor 1; one flat). Ids are readable on
 * purpose — the assertions are about structure, and "A2-02" says which flat it is.
 */
function node(
  id: string,
  parentId: string | null,
  depth: number,
  kind: PropertyNodeKind,
  extra: Partial<PropertyNodeResponse> = {},
): PropertyNodeResponse {
  return {
    id: id as PropertyNodeId,
    parentId: parentId as PropertyNodeId | null,
    depth,
    kind,
    name: id,
    declaredOccupancy: 0,
    residentAccounts: kind === 'UNIT' ? 1 : 0,
    childCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

const tree = buildTree([
  node('A', null, 0, 'BUILDING'),
  node('A2', 'A', 1, 'FLOOR', { levelNumber: 2 }),
  node('A1', 'A', 1, 'FLOOR', { levelNumber: 1 }),
  node('A1-01', 'A1', 2, 'UNIT', { code: 'A-101' }),
  node('A1-02', 'A1', 2, 'UNIT', { code: 'A-102' }),
  node('A2-01', 'A2', 2, 'UNIT', { code: 'A-201' }),
  node('A2-02', 'A2', 2, 'UNIT', { code: 'A-202' }),
  node('B', null, 0, 'BUILDING'),
  node('B1', 'B', 1, 'FLOOR', { levelNumber: 1 }),
  node('B1-01', 'B1', 2, 'UNIT', { code: 'B-101' }),
]);

const ids = (...values: string[]) => values as PropertyNodeId[];
const sorted = (values: readonly string[]) => [...values].sort();

describe('buildTree', () => {
  it('orders floors by storey, labels units by code, and rolls up unit counts', () => {
    expect(tree.byId.get('A' as PropertyNodeId)?.children).toEqual(ids('A1', 'A2'));
    expect(tree.byId.get('A1-01' as PropertyNodeId)?.label).toBe('A-101');
    expect(tree.byId.get('A' as PropertyNodeId)?.unitCount).toBe(4);
    expect(tree.byId.get('B' as PropertyNodeId)?.residentAccounts).toBe(1);
  });

  it('builds a readable breadcrumb', () => {
    expect(breadcrumb(tree, 'A2-02' as PropertyNodeId)).toBe('A › A2 › A-202');
  });
});

describe('toggle', () => {
  it('stores a whole building as one id', () => {
    expect(toggle(tree, [], 'A' as PropertyNodeId)).toEqual(ids('A'));
  });

  it('collapses every child being ticked into the parent', () => {
    let selection = toggle(tree, [], 'A1-01' as PropertyNodeId);
    selection = toggle(tree, selection, 'A1-02' as PropertyNodeId);
    expect(selection).toEqual(ids('A1'));

    selection = toggle(tree, selection, 'A2' as PropertyNodeId);
    expect(selection).toEqual(ids('A'));
  });

  it('expands a ticked building when one flat inside it is unticked', () => {
    const selection = toggle(tree, ids('A'), 'A2-02' as PropertyNodeId);
    // Floor 1 stays whole; on floor 2 only the other flat remains.
    expect(sorted(selection)).toEqual(sorted(ids('A1', 'A2-01')));
  });

  it('ticking a building absorbs anything already ticked inside it', () => {
    expect(toggle(tree, ids('A1-01', 'B1-01'), 'A' as PropertyNodeId).sort()).toEqual(ids('A', 'B'));
  });

  it('unticking a directly ticked node removes it', () => {
    expect(toggle(tree, ids('A', 'B1-01'), 'B' as PropertyNodeId)).toEqual(ids('A'));
  });
});

describe('normalize', () => {
  it('drops ids covered by a ticked ancestor and ids it does not know', () => {
    expect(normalize(tree, ids('A', 'A1-01', 'ghost'))).toEqual(ids('A'));
  });
});

describe('checkStates', () => {
  it('distinguishes ticked, covered-by-ancestor, partially-ticked and untouched', () => {
    const state = checkStates(tree, new Set(ids('A1')));
    expect(state('A1' as PropertyNodeId)).toBe('checked');
    expect(state('A1-01' as PropertyNodeId)).toBe('implied');
    expect(state('A' as PropertyNodeId)).toBe('partial');
    expect(state('B' as PropertyNodeId)).toBe('none');
  });
});

describe('coveredUnits', () => {
  it('counts every unit a selection reaches', () => {
    expect(coveredUnits(tree, ids('A1', 'B'))).toBe(3);
  });
});
