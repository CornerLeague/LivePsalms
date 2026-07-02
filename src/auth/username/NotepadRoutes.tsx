import { Navigate, Outlet, useParams } from 'react-router-dom';
import { Notepad } from '@/components/sections/Notepad';
import { HeroLoadingOverlay } from '@/components/sections/HeroLoadingOverlay';
import { useUsernameGate } from './username-gate';
import { UsernameClaim } from './UsernameClaim';
import { normalizeUsername } from './username-rules';
import { NotepadProvider } from '@/notepad/context/NotepadProvider';
import { useAuthSession } from '@/auth/context/useAuthSession';

/**
 * While the username gate resolves (e.g. after a full page refresh on the
 * notes route), show the app's heartbeat loading animation rather than a bare
 * "Loading…" text screen, matching the loading visuals used everywhere else.
 */
function NotepadGateSpinner() {
  return <HeroLoadingOverlay active />;
}

/** /notebook/notes — legacy entry. Signed-out users stay here (local mode). */
export function LegacyNotepadRoute() {
  const gate = useUsernameGate();
  switch (gate.kind) {
    case 'loading':
      return <NotepadGateSpinner />;
    case 'signed-out':
      return <Notepad />;
    case 'needs-username':
      return <UsernameClaim />;
    case 'ready':
      return <Navigate to={`/notebook/u/${gate.username}`} replace />;
  }
}

/** /notebook/u/:username — private vanity editor, owner-only. */
export function VanityNotepadRoute() {
  const gate = useUsernameGate();
  const { username: param } = useParams();
  switch (gate.kind) {
    case 'loading':
      return <NotepadGateSpinner />;
    case 'signed-out':
      return <Navigate to="/notebook/notes" replace />;
    case 'needs-username':
      return <UsernameClaim />;
    case 'ready':
      return normalizeUsername(param ?? '') === gate.username ? (
        <Notepad />
      ) : (
        <Navigate to={`/notebook/u/${gate.username}`} replace />
      );
  }
}

/**
 * Layout route for /notebook/notes — hoists NotepadProvider above nested children
 * (journaling workspace + study workspace) so toggling between them does not
 * remount the notes brain. Signed-out users (local mode) get the provider;
 * signed-in users are redirected to their vanity URL.
 */
export function LocalNotepadLayout() {
  const gate = useUsernameGate();
  const { adapter } = useAuthSession();
  switch (gate.kind) {
    case 'loading':
      return <NotepadGateSpinner />;
    case 'needs-username':
      return <UsernameClaim />;
    case 'ready':
      return <Navigate to={`/notebook/u/${gate.username}`} replace />;
    case 'signed-out':
      return (
        <NotepadProvider adapter={adapter}>
          <Outlet />
        </NotepadProvider>
      );
  }
}

/**
 * Layout route for /notebook/u/:username — hoists NotepadProvider above nested
 * children (journaling workspace + study workspace). Owner-only; mismatched
 * username param redirects to the correct vanity URL.
 */
export function VanityNotepadLayout() {
  const gate = useUsernameGate();
  const { username: param } = useParams();
  const { adapter } = useAuthSession();
  switch (gate.kind) {
    case 'loading':
      return <NotepadGateSpinner />;
    case 'signed-out':
      return <Navigate to="/notebook/notes" replace />;
    case 'needs-username':
      return <UsernameClaim />;
    case 'ready':
      return normalizeUsername(param ?? '') === gate.username ? (
        <NotepadProvider adapter={adapter}>
          <Outlet />
        </NotepadProvider>
      ) : (
        <Navigate to={`/notebook/u/${gate.username}`} replace />
      );
  }
}
