import type { AccountProgress, AnonProgress } from './onboarding-types';
import { mergeAnonIntoAccount } from './merge-anon-progress';

export interface MergeDecisionInput {
  /** The provider's mergedRef latch, passed in: true once this instance merged. */
  alreadyMerged: boolean;
  authLoading: boolean;
  signedIn: boolean;
  /** Adapter present — the signed-in I/O path exists. */
  hasAdapter: boolean;
  /** The async account fetch has SETTLED (success OR failure). */
  accountLoaded: boolean;
  account: AccountProgress | null;
  anon: AnonProgress | null;
}

export type MergeDecision =
  // Gated; do nothing and do NOT latch.
  | { kind: 'idle' }
  // Upstream already merged; latch, no writes.
  | { kind: 'already-merged' }
  // Fold anon progress into the account; `next` is the value to persist.
  | { kind: 'merge'; next: AccountProgress };

/** Pure decision for the one-time anon -> account merge. Computes `next` by
 *  calling the merge rule; performs no I/O. The binding owns the dispatch. */
export function decideMerge(input: MergeDecisionInput): MergeDecision {
  if (input.alreadyMerged) return { kind: 'idle' };
  if (!input.signedIn || !input.hasAdapter) return { kind: 'idle' };
  if (input.authLoading) return { kind: 'idle' };
  // Wait for the async account load to settle. Until then `account` may be a
  // transient null, and merging against it would clobber a returning user's
  // real stored progress with a fresh default.
  if (!input.accountLoaded) return { kind: 'idle' };
  if (input.account?.merged === true) return { kind: 'already-merged' };
  return { kind: 'merge', next: mergeAnonIntoAccount(input.anon, input.account) };
}
