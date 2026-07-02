import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAccountProfile } from '@/auth/context/useAccountProfile';
import { UsernameSetup } from './UsernameSetup';
import { generateUsername } from './username-generate';

const MAX_SKIP_ATTEMPTS = 5;

/** Wires the presentational picker to AccountProfile + navigation. */
export function UsernameClaim() {
  const { account } = useAccountProfile();
  const navigate = useNavigate();
  const skipInFlight = useRef(false);
  const [skipping, setSkipping] = useState(false);

  function goToNotepad(username: string) {
    navigate(`/notebook/u/${username}`, { replace: true });
  }

  async function handleSkip() {
    if (skipInFlight.current) return;
    skipInFlight.current = true;
    setSkipping(true);
    try {
      for (let attempt = 0; attempt < MAX_SKIP_ATTEMPTS; attempt++) {
        const candidate = generateUsername();
        const result = await account.setUsername(candidate);
        if (result.ok) {
          toast.success(`We picked @${candidate} for you — change it anytime in Settings.`);
          goToNotepad(candidate);
          return;
        }
        if (result.reason !== 'taken') break; // 'invalid' shouldn't happen; stop retrying
      }
      toast.error('Could not pick a username automatically. Please choose one.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      skipInFlight.current = false;
      setSkipping(false);
    }
  }

  return (
    <UsernameSetup
      checkAvailable={account.checkUsernameAvailable}
      claim={account.setUsername}
      onClaimed={goToNotepad}
      onSkip={handleSkip}
      skipping={skipping}
    />
  );
}
