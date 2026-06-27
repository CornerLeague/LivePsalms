// src/notepad/components/NotepadAuthControls.tsx
// The auth cluster shared by the Journal toolbar (NotepadToolbar) and the Study
// header (StudyWorkspace): a SIGN IN button when logged out, and the tier badge
// + avatar dropdown (Profile / Sign Out) when logged in. Extracted so both pages
// behave identically.
import { useNavigate } from 'react-router-dom';
import { LogIn, User } from 'lucide-react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import { useUserTier } from '../hooks/useUserTier';
import { TierBadge } from './TierBadge';
import { LevelUpModal } from './LevelUpModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const btnClass =
  'flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer';

export function NotepadAuthControls() {
  const navigate = useNavigate();
  const { user, loading: authLoading, session } = useAuthSession();
  const { profile } = useAccountProfile();
  const { currentTier, showLevelUp, levelUpTier, dismissLevelUp } = useUserTier(
    profile?.highestNoteCount ?? 0
  );

  return (
    <>
      {authLoading ? (
        <div className="w-8 h-8" />
      ) : user ? (
        <div className="flex items-center gap-1">
          <TierBadge tier={currentTier} noteCount={profile?.noteCount ?? 0} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`${btnClass} w-8 h-8 rounded-full overflow-hidden`}>
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ fontFamily: 'Outfit, sans-serif', minWidth: 140 }}>
              <DropdownMenuItem onClick={() => navigate('/profile')} style={{ fontSize: 12 }}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  await session.signOut();
                  navigate('/notepad');
                }}
                style={{ fontSize: 12 }}
              >
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <button
          onClick={() => navigate('/login')}
          className={`${btnClass} flex items-center gap-1.5 px-3 h-8`}
          style={{ fontFamily: 'Outfit, sans-serif' }}
        >
          <LogIn className="w-3.5 h-3.5" style={{ color: 'var(--deep-umber)' }} />
          <span
            className="text-[10px] font-medium tracking-wider"
            style={{ color: 'var(--deep-umber)' }}
          >
            SIGN IN
          </span>
        </button>
      )}

      <LevelUpModal open={showLevelUp} tier={levelUpTier} onDismiss={dismissLevelUp} />
    </>
  );
}
