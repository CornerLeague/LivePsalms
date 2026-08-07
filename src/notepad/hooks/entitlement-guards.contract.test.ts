// src/notepad/hooks/entitlement-guards.contract.test.ts
//
// CONTRACT SUITE over every `hasAccess` call site in `src/`, in the shape of
// `bible/prefs/single-instance.test.ts` (walk src, assert an invariant about
// call sites) and `onboarding/tour/anchors.contract.test.ts` (a registry that
// must stay exhaustive).
//
// ⚠️ WHY THIS EXISTS, rather than a behavioural test per surface.
//
// `hasAccess` short-circuits on the global promo — `if (promoActive) return
// true` — BEFORE it considers who is asking. That is correct for the question
// it answers ("does this feature exist for this session") and a trap for any
// caller gating an ACTION on it: while a promo runs it answers `true` for a
// signed-out visitor, who then presses the button and gets a request that 401s
// with no bearer token.
//
// It has shipped to readers twice:
//   · #120 — the Insights doors: "That didn't finish. Try again."
//   · EtymologyPanel — "Ask Lamplight about this verse", where pressing it put
//     nothing at all on screen.
//
// Both components already rendered the correct blocked affordance and could
// not reach it. **A behavioural test per surface cannot catch the third one,
// because the surface that bites next is the one nobody wrote a test for.**
// EtymologyPanel is the proof: it had a test file the whole time, and that file
// mocked `promoActive: false` — the defect's own precondition — so the branch
// was legislated away rather than checked.
//
// So this suite is deliberately STRUCTURAL. A new `hasAccess` call site fails
// it until somebody classifies the guard, which puts the question in front of
// the person adding the surface rather than the person debugging it later.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** How a call site keeps a signed-out reader away from a gated action. */
type Guard =
  /** Combines with `userId` via `entitledAndSignedIn`. Required for anything gating an ACTION. */
  | 'entitledAndSignedIn'
  /** Renders a sign-in path and returns BEFORE `hasAccess` is ever consulted. */
  | 'signed-in-early-return'
  /** Hands the value outward; the consumer null-checks `userId` itself. */
  | 'consumer-guards';

/**
 * Every file in `src/` that calls `hasAccess`, and how each is guarded.
 *
 * Exhaustive by test: a file that starts calling `hasAccess` and is not listed
 * here fails, and so does a listed file that stops.
 */
const CALL_SITES: Record<string, { guard: Guard; why: string }> = {
  'src/notepad/study/StudyWorkspace.tsx': {
    guard: 'entitledAndSignedIn',
    why: 'Gates the Insights generate action. Fixed by #120, via canGenerateInsights.',
  },
  'src/notepad/study/mobile/MobileStudyWorkspace.tsx': {
    guard: 'entitledAndSignedIn',
    why: 'The mobile twin of the above. #120 fixed both together.',
  },
  'src/notepad/study/lexicon/EtymologyPanel.tsx': {
    guard: 'entitledAndSignedIn',
    why: 'Gates "Ask Lamplight about this verse". Was the second live instance of the defect — #120 did not reach this surface.',
  },
  'src/notepad/bible/BibleStudyPane.tsx': {
    guard: 'signed-in-early-return',
    why: 'Returns <SignInGate /> for a null user before the entitlement branch runs, so the promo can never be consulted for a signed-out reader.',
  },
  'src/notepad/components/lamplight/LamplightTabPanel.tsx': {
    guard: 'signed-in-early-return',
    why: 'Same shape: a signed-out reader is turned away at the top of the component.',
  },
  'src/notepad/components/waymarks/waymarks-routes.tsx': {
    guard: 'consumer-guards',
    why: 'Returns `canAccess` alongside `userId` rather than gating anything itself; every consumer bails on a null userId. Folding the userId check in here would be wrong — this is the case that makes tightening `hasAccess` itself the wrong fix.',
  },
};

const HAS_ACCESS = /hasAccess\s*\(/;

/**
 * The named ways to combine `hasAccess` with a userId check.
 *
 * `canGenerateInsights` is trusted here only because the last test in this file
 * proves it delegates to the primitive rather than restating the rule — which
 * is the whole reason a second copy of `userId !== null && …` is not allowed to
 * exist. A wrapper nobody checks is just a longer way to write the bug.
 */
const GUARD_FNS = ['entitledAndSignedIn', 'canGenerateInsights'] as const;
const GUARDED = new RegExp(`(?:${GUARD_FNS.join('|')})\\s*\\(`);

/** The one file allowed to define the primitive's only wrapper. */
const WRAPPER_FILE = 'src/notepad/study/insights/doors.tsx';

/** Comments describe the trap constantly; only real calls count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const found = walk('src').filter((f) => HAS_ACCESS.test(stripComments(readFileSync(f, 'utf8'))));

describe('every hasAccess call site is classified', () => {
  it('the registry is exhaustive — a new surface fails until somebody classifies it', () => {
    // The whole point. If this fails on a file you just added: decide how a
    // SIGNED-OUT reader reaches it while a promo is running, then say so here.
    expect(found.map((f) => f.replace(/\\/g, '/')).sort()).toEqual(Object.keys(CALL_SITES).sort());
  });

  it('every entry carries a reason, not just a label', () => {
    for (const [file, { why }] of Object.entries(CALL_SITES)) {
      expect(why.length, `${file} needs a reason`).toBeGreaterThan(30);
    }
  });
});

describe('each guard is actually present in the file it is claimed for', () => {
  const entries = Object.entries(CALL_SITES);

  it.each(entries.filter(([, v]) => v.guard === 'entitledAndSignedIn'))(
    '%s combines hasAccess with a userId check',
    (file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(src).toMatch(GUARDED);
    },
  );

  it.each(entries.filter(([, v]) => v.guard === 'signed-in-early-return'))(
    '%s turns a signed-out reader away BEFORE it consults the entitlement',
    (file) => {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      const bail = lines.findIndex((l) => /if\s*\(\s*!user(Id)?\s*\)\s*return/.test(l));
      const gate = lines.findIndex((l) => HAS_ACCESS.test(l));
      expect(bail, `${file}: no signed-out early return found`).toBeGreaterThanOrEqual(0);
      // Ordering is the guard. A bail that runs after the gate guards nothing.
      expect(bail, `${file}: the early return must precede the hasAccess call`).toBeLessThan(gate);
    },
  );

  it.each(entries.filter(([, v]) => v.guard === 'consumer-guards'))(
    '%s hands userId out alongside the entitlement, so a consumer can guard',
    (file) => {
      const src = stripComments(readFileSync(file, 'utf8'));
      expect(src).toMatch(/userId/);
    },
  );
});

describe('the only wrapper is a wrapper, not a second copy of the rule', () => {
  it('canGenerateInsights delegates to entitledAndSignedIn', () => {
    // Two surfaces reach the rule through this name, so it is trusted by the
    // check above. It earns that by delegating — if it ever restates
    // `userId !== null && …` itself, there are two rules to keep in step and
    // the next fix lands on one of them.
    const src = stripComments(readFileSync(WRAPPER_FILE, 'utf8'));
    expect(src).toMatch(/entitledAndSignedIn\s*\(/);
  });
});

describe('the shape both live defects had', () => {
  it('⚠️ no file gates an action on hasAccess alone', () => {
    // `const canGenerate = hasAccess('inline')` is the literal line that shipped
    // twice. Banned outright: an action-shaped const must go through
    // entitledAndSignedIn, whatever else the file does.
    const offenders: string[] = [];
    for (const file of walk('src')) {
      const src = stripComments(readFileSync(file, 'utf8'));
      if (/const\s+can[A-Z]\w*\s*=\s*(?:\w+\.)?hasAccess\s*\(/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
