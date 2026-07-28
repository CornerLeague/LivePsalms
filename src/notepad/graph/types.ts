export interface Reference {
  id: string;
  source: string;      // note id or scripture id
  target: string;
  type: 'explicit' | 'scripture-reference' | 'cross-reference';
  weight: number;
  createdAt: string;
}

export interface ScriptureNode {
  id: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
  translation: string;
  text: string;
  createdAt: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'explicit' | 'scripture_reference' | 'cross_reference';
  weight: number;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  type: 'general' | 'devotion' | 'sermon' | 'theme' | 'scripture';
  title: string;
  weight: number;
  tags: string[];
  scriptureText: string;
  scriptureTranslation: string;
  /**
   * Folder the note lives in. Drives the graph's folder-based category filter.
   * Note nodes carry their `folderId`; scripture nodes leave it undefined (they
   * belong to the synthetic `scripture` category instead).
   */
  folderId?: string;
  /**
   * Resolved render color (concrete CSS color, not a var). When set it overrides
   * the type palette so note nodes can be tinted by their folder's color; left
   * undefined for nodes that should keep their theme-aware type color.
   */
  color?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export type AdjacencyList = Map<string, {
  outgoing: GraphEdge[];
  incoming: GraphEdge[];
}>;
