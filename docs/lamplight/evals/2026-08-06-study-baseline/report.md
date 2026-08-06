# Lamplight eval — study-baseline

**FAIL** · 2 passed, 2 failed · 0 scripture violation(s) · $0.1146

| Artifact | Runs | Tokens in | Tokens out | Cost |
|---|---:|---:|---:|---:|
| study-chat | 4 | 14029 | 1482 | $0.1146 |

## Failures

- **study-psalm-27** (study-chat)
  - generation: pipeline returned validators_failed · citation:unknown_verse cited verse "psa 27:4-6" is not in the retrieved passages
- **study-romans-9** (study-chat)
  - must_not_contain: clearly teaches

> **Cost above excludes failed generations.** The pipeline reports zero tokens on a `validators_failed` outcome, so a failing run costs real money that this table shows as $0. Read the failure count, not the total, when a run is red.

## What this run does not prove

A green run means the deterministic checks passed. It does NOT mean the prose is good: register — "does this sound like Lamplight?" — is not machine-checkable. Read the snapshots.
