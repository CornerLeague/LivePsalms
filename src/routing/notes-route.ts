// src/routing/notes-route.ts
/**
 * True for the notes *workspace index* routes only — the local `/notebook/notes`
 * and a vanity `/notebook/u/:username` (with no further segment) — where
 * NotepadWorkspace mounts and the relocated NotesMenu now provides site
 * navigation. Deliberately excludes the `/study` children, `/reflections`
 * (+ detail), the `/notebook` landing, and everything else, so the mobile
 * bottom dock is suppressed on exactly (and only) the notes workspace.
 *
 * Trailing slashes are stripped first: React Router v7 renders the same
 * workspace at `/notebook/notes/` and `/notebook/u/:username/` (matchPath's
 * end anchor ignores trailing slashes), so those variants must be treated as
 * the index too — otherwise the suppressed dock reappears over the tab bar.
 */
export function isNotesWorkspaceIndexPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized === '/notebook/notes' || /^\/notebook\/u\/[^/]+$/.test(normalized);
}

/**
 * True for the Study workspace routes — `/notebook/notes/study` and the vanity
 * `/notebook/u/:username/study`.
 *
 * On mobile these own the bottom edge with their own StudyTabBar
 * (Study / Reader / Context), so the site's MobileBottomDock floats on top of
 * it — the same tab-bar/pill collision the notes index already suppresses. Site
 * nav stays reachable exactly as it is on desktop Study: the header logo goes
 * home, and the Journal toggle returns to the workspace that owns the
 * NotesMenu.
 *
 * Trailing slashes are stripped first, for the same reason as above.
 */
export function isStudyWorkspacePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '');
  return (
    normalized === '/notebook/notes/study' ||
    /^\/notebook\/u\/[^/]+\/study$/.test(normalized)
  );
}
