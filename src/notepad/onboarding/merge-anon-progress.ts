import type { AccountProgress, AnonProgress } from './onboarding-types';
import { defaultAccountProgress } from './onboarding-types';

/** One-time idempotent merge of anonymous progress into the account.
 *  Returns the same reference unchanged when account.merged is already true. */
export function mergeAnonIntoAccount(
  anon: AnonProgress | null,
  account: AccountProgress | null,
): AccountProgress {
  if (account?.merged) return account;

  const base = account ?? defaultAccountProgress();
  const next: AccountProgress = {
    ...base,
    items: { ...base.items },
    studyDates: [...base.studyDates],
    merged: true,
  };

  const anonFirstNote = anon?.items['write-first-note'];
  if (anonFirstNote) {
    if (next.items['first-study-note'] == null) next.items['first-study-note'] = anonFirstNote;
    if (next.guidedNote === 'pending') next.guidedNote = 'skipped';
  }

  return next;
}
