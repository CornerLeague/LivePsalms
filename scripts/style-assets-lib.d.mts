// Types for style-assets-lib.mjs.
//
// The implementation stays plain ESM because `build-style-assets.mjs` runs it
// directly under node with no build step. This file exists so its TEST — which
// is TypeScript, and is now inside the typecheck — sees real types instead of
// an implicit `any` that swallows every parameter downstream.

/** The folder categories the asset pipeline knows how to place. */
export declare const IN_SCOPE_CATEGORIES: readonly string[];

export type StyleCategory = 'highlight' | 'shape' | 'arrow' | 'bubble' | 'squiggle' | 'line';

export interface ManifestEntry {
  id: string;
  category: StyleCategory;
  thumbUrl: string;
  displayUrl: string;
  aspectRatio: number;
}

/**
 * Map a source-folder path (relative to the Notes Styles root, forward-slashed)
 * to a category, or `null` when the folder is out of scope.
 */
export declare function categorize(folderPath: string): StyleCategory | null;

/** A filesystem-safe, unique id from a filename and optional category prefix. */
export declare function slugify(filename: string, category?: string): string;

export declare function buildManifestEntry(args: {
  id: string;
  category: StyleCategory;
  width: number;
  height: number;
}): ManifestEntry;

/** The generated `.ts` manifest module, as a string. */
export declare function renderManifestModule(assets: ManifestEntry[]): string;
