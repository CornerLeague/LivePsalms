import type { GraphNode } from './types';

/**
 * Graph "categories" are folder-based. Every node maps to exactly one category
 * id, which the filter chips in GraphPane toggle:
 *
 *   - scripture verse nodes → the synthetic `SCRIPTURE_CATEGORY`
 *   - notes inside a folder  → that folder's id
 *   - notes at root / orphaned (folder deleted) → `UNFILED_CATEGORY`
 *
 * GraphPane normalizes orphaned folder ids to `UNFILED_CATEGORY` before handing
 * nodes to the view, so this stays a pure lookup with no folder-existence check.
 */
export const SCRIPTURE_CATEGORY = 'scripture';
export const UNFILED_CATEGORY = 'root';

export function graphNodeCategory(
  node: Pick<GraphNode, 'type' | 'folderId'>,
): string {
  if (node.type === 'scripture') return SCRIPTURE_CATEGORY;
  const folderId = node.folderId;
  return folderId && folderId !== UNFILED_CATEGORY ? folderId : UNFILED_CATEGORY;
}
