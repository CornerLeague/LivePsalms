import type { Note } from '../types';
import type { GraphEdge, GraphNode, Reference, ScriptureNode } from './types';

function refToGraphEdge(ref: Reference): GraphEdge {
  let type: GraphEdge['type'];
  if (ref.type === 'scripture-reference') type = 'scripture_reference';
  else if (ref.type === 'cross-reference') type = 'cross_reference';
  else type = 'explicit';
  return {
    id: ref.id,
    source: ref.source,
    target: ref.target,
    type,
    weight: ref.weight,
    createdAt: ref.createdAt,
  };
}

export function projectGraph(
  notes: Note[],
  references: Reference[],
  scriptureNodes: ScriptureNode[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const weightSums = new Map<string, number>();
  const nodesWithEdges = new Set<string>();
  for (const ref of references) {
    weightSums.set(ref.source, (weightSums.get(ref.source) ?? 0) + ref.weight);
    weightSums.set(ref.target, (weightSums.get(ref.target) ?? 0) + ref.weight);
    nodesWithEdges.add(ref.source);
    nodesWithEdges.add(ref.target);
  }

  const nodes: GraphNode[] = notes.map((note) => ({
    id: note.id,
    type: note.type,
    title: note.title,
    weight: weightSums.get(note.id) ?? 0,
    tags: note.tags,
    scriptureText: '',
    scriptureTranslation: '',
    folderId: note.folderId,
  }));

  for (const sn of scriptureNodes) {
    if (!nodesWithEdges.has(sn.id)) continue;
    nodes.push({
      id: sn.id,
      type: 'scripture',
      title: `${sn.book} ${sn.chapter}:${sn.verseStart}${sn.verseEnd ? `-${sn.verseEnd}` : ''}`,
      weight: weightSums.get(sn.id) ?? 0,
      tags: [],
      scriptureText: sn.text,
      scriptureTranslation: sn.translation,
    });
  }

  const edges = references.map(refToGraphEdge);
  return { nodes, edges };
}
