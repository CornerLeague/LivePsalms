import { Navigate, useLocation } from 'react-router-dom';

/**
 * Backward-compat redirect from the legacy `/notepad*` URLs to their
 * `/notebook*` equivalents. The user-facing route rename left old links
 * dangling — bookmarks, and critically the already-sent Supabase auth emails
 * whose `emailRedirectTo` pointed at `/notepad/notes` (see
 * `src/auth/session/auth-session.ts`).
 *
 * Registered on the three old paths (`/notepad`, `/notepad/notes`,
 * `/notepad/u/:username`), it swaps the leading `/notepad` segment for
 * `/notebook` and preserves everything else: the trailing path (e.g.
 * `/u/:username`), the query string (`?code=` — PKCE callback), and the hash
 * (`#access_token=` — implicit-flow callback), so the auth exchange still
 * completes after the redirect.
 */
export function NotepadCompatRedirect() {
  const { pathname, search, hash } = useLocation();
  return (
    <Navigate
      to={{ pathname: pathname.replace(/^\/notepad(?=\/|$)/, '/notebook'), search, hash }}
      replace
    />
  );
}
