import type { PropertyNodeResponse } from '@gatecrash/api';
import type { PropertyNodeId, PropertyNodeKind } from '@gatecrash/core';

/**
 * Selection over the property tree, for the notification audience picker.
 *
 * Pure functions, no React: the rules here are the part worth testing, and the picker component
 * only renders what they compute.
 *
 * **What a selected id means.** The server's `NODES` audience mode reads every id as "every
 * resident anywhere beneath this node" (`AudienceResolver`). So the selection is kept in its most
 * compact equivalent form, and that is also what gets sent:
 *
 *  - Ticking a tower stores the tower, never its 200 flats.
 *  - Ticking every floor of a tower one by one collapses into the tower.
 *  - Unticking one flat inside a ticked tower *expands* the tower into everything except that
 *    flat — its other floors whole, and that flat's floor-mates individually.
 *
 * The compact form keeps a building-wide blast to one id (well inside the 2000-id cap), and it
 * means the rule describes intent: "Tower A" rather than a list that happened to match it.
 */

export interface TreeNode {
  id: PropertyNodeId;
  parentId: PropertyNodeId | null;
  depth: number;
  kind: PropertyNodeKind;
  /** Units show their code ("A-1401"); everything else its name ("Tower A", "Floor 14"). */
  label: string;
  /** Ordered for display: floors by storey, everything else naturally ("A-2" before "A-10"). */
  children: PropertyNodeId[];
  /** UNIT nodes at or beneath this one. */
  unitCount: number;
  /** Units only: accounts that can actually receive a notification. */
  residentAccounts: number;
}

export interface Tree {
  byId: Map<PropertyNodeId, TreeNode>;
  roots: PropertyNodeId[];
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function buildTree(nodes: readonly PropertyNodeResponse[]): Tree {
  const byId = new Map<PropertyNodeId, TreeNode>();
  const levelNumber = new Map<PropertyNodeId, number | null>();

  for (const node of nodes) {
    byId.set(node.id, {
      id: node.id,
      parentId: node.parentId ?? null,
      depth: node.depth,
      kind: node.kind,
      label: node.kind === 'UNIT' ? (node.code ?? node.name) : node.name,
      children: [],
      unitCount: node.kind === 'UNIT' ? 1 : 0,
      residentAccounts: node.kind === 'UNIT' ? node.residentAccounts : 0,
    });
    levelNumber.set(node.id, node.levelNumber ?? null);
  }

  const roots: PropertyNodeId[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node.id);
    else roots.push(node.id);
  }

  const order = (a: PropertyNodeId, b: PropertyNodeId) => {
    const la = levelNumber.get(a);
    const lb = levelNumber.get(b);
    if (la != null && lb != null && la !== lb) return la - lb;
    return natural.compare(byId.get(a)!.label, byId.get(b)!.label);
  };
  for (const node of byId.values()) node.children.sort(order);
  roots.sort(order);

  // Unit counts roll up deepest-first, so each parent sums already-final children.
  const deepestFirst = [...byId.values()].sort((a, b) => b.depth - a.depth);
  for (const node of deepestFirst) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (parent) {
      parent.unitCount += node.unitCount;
      parent.residentAccounts += node.residentAccounts;
    }
  }

  return { byId, roots };
}

/** Root first, the node itself excluded. */
export function ancestorsOf(tree: Tree, id: PropertyNodeId): PropertyNodeId[] {
  const chain: PropertyNodeId[] = [];
  let current = tree.byId.get(id)?.parentId ?? null;
  while (current) {
    chain.unshift(current);
    current = tree.byId.get(current)?.parentId ?? null;
  }
  return chain;
}

/** "Tower A › Floor 14 › A-1401" — for the summary chips and the search results. */
export function breadcrumb(tree: Tree, id: PropertyNodeId): string {
  return [...ancestorsOf(tree, id), id]
    .map((nodeId) => tree.byId.get(nodeId)?.label ?? '?')
    .join(' › ');
}

export type CheckState = 'checked' | 'implied' | 'partial' | 'none';

/**
 * Everything the picker needs to draw one checkbox, precomputed once per selection:
 *
 *  - `checked`  this node is in the selection itself;
 *  - `implied`  an ancestor is, so this node is covered without being listed;
 *  - `partial`  something beneath it is selected, but not all of it.
 */
export function checkStates(tree: Tree, selected: ReadonlySet<PropertyNodeId>) {
  const partial = new Set<PropertyNodeId>();
  for (const id of selected) {
    for (const ancestor of ancestorsOf(tree, id)) partial.add(ancestor);
  }
  return (id: PropertyNodeId): CheckState => {
    if (selected.has(id)) return 'checked';
    if (ancestorsOf(tree, id).some((a) => selected.has(a))) return 'implied';
    if (partial.has(id)) return 'partial';
    return 'none';
  };
}

/**
 * Bring a selection to its canonical form: drop anything already covered by a selected ancestor,
 * then collapse every node whose children are all selected into the node itself, repeatedly, so a
 * tower ticked floor by floor ends up as the tower.
 */
export function normalize(tree: Tree, ids: Iterable<PropertyNodeId>): PropertyNodeId[] {
  const set = new Set<PropertyNodeId>([...ids].filter((id) => tree.byId.has(id)));

  for (const id of [...set]) {
    if (ancestorsOf(tree, id).some((a) => set.has(a))) set.delete(id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) {
      const parentId = tree.byId.get(id)?.parentId;
      if (!parentId || set.has(parentId)) continue;
      const siblings = tree.byId.get(parentId)?.children ?? [];
      if (siblings.length > 0 && siblings.every((s) => set.has(s))) {
        for (const s of siblings) set.delete(s);
        set.add(parentId);
        changed = true;
      }
    }
  }

  return [...set];
}

/** Tick or untick one node, returning the new canonical selection. */
export function toggle(
  tree: Tree,
  current: readonly PropertyNodeId[],
  id: PropertyNodeId,
): PropertyNodeId[] {
  // Canonicalise first: a selection that reached here un-collapsed (a stored rule, a building that
  // gained or lost units since) must toggle the same way the picker displays it.
  const set = new Set(normalize(tree, current));

  if (set.has(id)) {
    set.delete(id);
    return normalize(tree, set);
  }

  const chain = ancestorsOf(tree, id);
  const coveringIndex = chain.findIndex((a) => set.has(a));
  if (coveringIndex >= 0) {
    // Unticking something covered by a ticked ancestor: replace the ancestor with everything
    // beneath it *except* the path down to this node, level by level.
    set.delete(chain[coveringIndex]!);
    const path = [...chain.slice(coveringIndex), id];
    for (let i = 0; i < path.length - 1; i += 1) {
      const next = path[i + 1];
      for (const child of tree.byId.get(path[i]!)?.children ?? []) {
        if (child !== next) set.add(child);
      }
    }
    return normalize(tree, set);
  }

  set.add(id);
  return normalize(tree, set);
}

/** How many units a selection reaches — what the summary line reports before the server preview lands. */
export function coveredUnits(tree: Tree, selected: Iterable<PropertyNodeId>): number {
  let total = 0;
  for (const id of selected) total += tree.byId.get(id)?.unitCount ?? 0;
  return total;
}
