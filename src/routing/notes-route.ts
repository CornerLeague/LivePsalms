// src/routing/notes-route.ts
/**
 * True for the notes *workspace index* routes only — the local `/notebook/notes`
 * and a vanity `/notebook/u/:username` (with no further segment) — where
 * NotepadWorkspace mounts and the relocated NotesMenu now provides site
 * navigation. Deliberately excludes the `/study` children, `/reflections`
 * (+ detail), the `/notebook` landing, and everything else, so the mobile
 * bottom dock is suppressed on exactly (and only) the notes workspace.
 */
export function isNotesWorkspaceIndexPath(pathname: string): boolean {
  return pathname === '/notebook/notes' || /^\/notebook\/u\/[^/]+$/.test(pathname);
}
