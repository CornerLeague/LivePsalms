import { useState } from 'react';
import type { FormEvent } from 'react';
import { normalizeUsername, validateUsername } from './username-rules';
import type { UsernameClaimResult } from './username-rules';
import { useUsernameAvailability } from './useUsernameAvailability';

export interface UsernameSetupProps {
  checkAvailable: (name: string) => Promise<boolean>;
  claim: (name: string) => Promise<UsernameClaimResult>;
  onClaimed: (username: string) => void;
  onSkip?: () => void | Promise<void>;
  /** Drives the skip button's busy/disabled state while the skip flow runs. */
  skipping?: boolean;
  debounceMs?: number;
}

export function UsernameSetup({ checkAvailable, claim, onClaimed, onSkip, skipping, debounceMs = 300 }: UsernameSetupProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const normalized = normalizeUsername(value);
  const format = validateUsername(value);

  const { status: availability, markTaken } = useUsernameAvailability({
    checkAvailable,
    name: normalized,
    eligible: format.valid,
    debounceMs,
  });

  const canSubmit =
    format.valid && !submitting && availability !== 'taken' && availability !== 'checking';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await claim(normalized);
    setSubmitting(false);
    if (result.ok) {
      onClaimed(normalized);
      return;
    }
    if (result.reason === 'taken') {
      markTaken();
      setSubmitError('That username was just taken. Try another.');
    } else {
      setSubmitError('That username isn’t valid.');
    }
  }

  const status = (() => {
    if (!value) return null;
    if (!format.valid) return format.reason;
    if (availability === 'checking') return 'Checking…';
    if (availability === 'available') return 'Available';
    if (availability === 'taken') return 'Taken';
    return null;
  })();

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Choose your username</h1>
          <p className="text-sm text-mersi-dark/60">
            This is your private notepad address — you can share notes from it later.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="username" className="text-sm font-medium">
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
            style={{ background: 'var(--plaster)', color: 'var(--deep-umber)' }}
          />
          {status && <p className="text-sm text-mersi-dark/70">{status}</p>}
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-md bg-mersi-dark px-4 py-2 text-white disabled:opacity-50"
        >
          Claim username
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={() => onSkip()}
            disabled={submitting || skipping}
            aria-busy={skipping || undefined}
            className="w-full rounded-md px-4 py-2 text-sm text-mersi-dark/60 hover:text-mersi-dark disabled:opacity-50"
          >
            {skipping ? 'Setting up…' : 'Skip for now'}
          </button>
        )}
      </form>
    </div>
  );
}
