import { describe, expect, it } from 'vitest';
import { expandPattern } from './bulk-nodes';

/**
 * The dialog previews the codes it is about to create. That is only worth showing if it is the
 * truth, so these cases are pinned against `PropertyService.expand` on the server — the same
 * patterns, the same expected output. A preview computed by different rules than the generator is
 * worse than no preview at all, because it is believed.
 *
 * The backend equivalents live in `PropertyTreeTest$Bulk`.
 */
describe('code pattern expansion', () => {
  it('pads the unit number to the requested width', () => {
    // Padding exists so codes sort correctly: unpadded, A-10 sorts before A-2.
    expect(expandPattern('A-{unit}', 'Rose Cluster', null, 1, 2)).toBe('A-01');
    expect(expandPattern('A-{unit}', 'Rose Cluster', null, 4, 2)).toBe('A-04');
    expect(expandPattern('A-{unit}', 'Rose Cluster', null, 4, 3)).toBe('A-004');
    expect(expandPattern('A-{unit}', 'Rose Cluster', null, 12, 1)).toBe('A-12');
  });

  it('matches the server for the floors example in the hint', () => {
    // "A-{floor}{unit}" over floors 1-3, 2 per floor -> A-101, A-102, A-201...
    expect(expandPattern('A-{floor}{unit}', 'Tower A', 1, 1, 2)).toBe('A-101');
    expect(expandPattern('A-{floor}{unit}', 'Tower A', 1, 2, 2)).toBe('A-102');
    expect(expandPattern('A-{floor}{unit}', 'Tower A', 2, 1, 2)).toBe('A-201');
    expect(expandPattern('A-{floor}{unit}', 'Tower A', 3, 2, 2)).toBe('A-302');
  });

  it('substitutes the parent name for {building}', () => {
    expect(expandPattern('{building}-{unit}', 'Rose Cluster', null, 1, 2)).toBe('Rose Cluster-01');
  });

  it('drops {floor} to nothing in a project with no floors', () => {
    // A villa project has no storeys. The server expands {floor} to an empty string rather than
    // erroring, so the preview has to agree — and the hint no longer suggests {floor} there.
    expect(expandPattern('A-{floor}{unit}', 'Rose Cluster', null, 3, 2)).toBe('A-03');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(expandPattern('{unit}-{unit}', 'X', null, 7, 2)).toBe('07-07');
  });

  it('trims, matching the server', () => {
    expect(expandPattern('  A-{unit}  ', 'X', null, 1, 2)).toBe('A-01');
  });
});
