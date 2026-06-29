# Mobile Study Chat polish + Navigation swap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five mobile-focused polish changes — refined-flat Study chat with live SSE streaming, a dark-mode input fix, a dark-mode-aware auth logo, and a bottom-bar Bible tab that relocates Lamplight to the top header.

**Architecture:** The Study chat is the shared `LamplightStudyPanel` (desktop + mobile); it gains a refined-flat layout, a theme-aware input, and live streaming via a new `study-stream-client.ts` that mirrors the Bible `lamplight-stream-client.ts`. The `lamplight-study` edge function gains an SSE branch reusing the shared `streamBibleChat` helper (extended with an optional `extraDoneFields` so Study can carry `offered_notes` through the `done` event). Navigation moves Lamplight from the bottom `MobileTabBar` into the Notes/Editor top headers and adds a first-class Bible tab that renders the existing `BibleStudyPane`.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase Deno edge functions, Vitest + @testing-library/react (jsdom), lucide-react icons, inline-style + CSS-var theming.

## Global Constraints
- Pre-existing red baseline: repo ships with ~114 lint errors, 4 tsc errors in `force-sphere.test.ts`, and 2 failing test files (`Editor.toolbar-placement` + `garden-scene`). Add ZERO new errors — do not gate on a green repo-wide baseline.
- Typecheck with `tsc -b` (the real build command), NOT bare `tsc --noEmit` (root tsconfig has `files:[]` so `--noEmit` checks nothing).
- Edge-function deploy is MANUAL via `supabase functions deploy lamplight-study --use-api`; it is NOT carried by a frontend/Vercel deploy.
- Chat changes A/B/C apply to the SHARED `LamplightStudyPanel` (desktop Study gets them too), not mobile-gated.
- `bible-chat-stream.ts` is shared — Bible chat behavior must stay unchanged; the `extraDoneFields` extension is optional and Bible chat omits it.
- All Study chat / edge-fn tests run under **vitest** (node env), NOT `deno test`. Edge-fn test imports use the `.ts` extension (e.g. `from './bible-chat-stream.ts'`); src tests omit it.
- The Study indigo accent is `var(--lamplight-accent)`, which resolves to `#43508C` (Twilight Indigo) under `[data-mode="study"]` via `src/notepad/study/study-theme.css`. Never hard-code `#43508C` in TSX — use the CSS var.

---

## File Structure

| File | Create/Modify | Responsibility |
| --- | --- | --- |
| `src/auth/AuthCard.tsx` | Modify | Add `notepad-nav-logo` class to the auth logo `<img>` so it lightens in dark mode (Change D). |
| `src/notepad/study/panes/LamplightStudyPanel.tsx` | Modify | Refined-flat message layout (A), theme-aware input (C), and streaming wiring with buffered fallback (B-frontend). |
| `supabase/functions/lamplight-chat/bible-chat-stream.ts` | Modify | Add optional `extraDoneFields?: () => Record<string, unknown>` dep, spread into the `done` payload (B-backend, shared). |
| `supabase/functions/lamplight-chat/bible-chat-stream.test.ts` | Modify | Add a test that `extraDoneFields` is spread into `done` and that omitting it leaves Bible chat unchanged. |
| `supabase/functions/lamplight-study/parse-body.ts` | Modify | Add `stream?: boolean` to `ParsedStudyBody` + parse it (B-backend). |
| `supabase/functions/lamplight-study/parse-body.test.ts` | Create | Cover the new `stream` flag parse. |
| `supabase/functions/lamplight-study/index.ts` | Modify | Add a `wantsStream` SSE branch wiring study deps + `extraDoneFields` for `offered_notes` (B-backend). |
| `src/notepad/study/study-stream-client.ts` | Create | SSE transport for the Study chat (`streamStudyMessage`), mirrors `lamplight-stream-client.ts` (B-frontend). |
| `src/notepad/study/study-stream-client.test.ts` | Create | SSE parsing + body/auth assertions for the new study stream client. |
| `src/components/sections/notepad/mobile/types.ts` | Modify | Add `'bible'` to the `MobileTab` union (E). |
| `src/components/sections/notepad/mobile/MobileTabBar.tsx` | Modify | Replace the Lamplight tab with a Bible tab; remove flame/gold/dot logic (E). |
| `src/components/sections/notepad/mobile/MobileTabBar.test.tsx` | Modify | Assert Bible (not Lamplight) renders; no dot in the bar (E). |
| `src/components/sections/notepad/mobile/MobileNotesView.tsx` | Modify | Add a gold Lamplight flame button (+ connection dot) to the header (E). |
| `src/components/sections/notepad/mobile/MobileEditorView.tsx` | Modify | Same header flame button as Notes (E). |
| `src/components/sections/notepad/mobile/MobileNotesView.test.tsx` | Modify | Assert the header Lamplight button + dot (E). |
| `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` | Modify | Add the `bible` content branch (BibleStudyPane), wire `onOpenLamplight`/`lamplightHasConnections` into headers, allow `'bible'` in `loadEnum` (E). |
| `src/components/sections/notepad/mobile/MobileMoreSheet.tsx` | Modify | Remove the redundant `Bible` segment from the `Segmented` control (E). |
| `src/components/sections/notepad/mobile/MobileMoreSheet.test.tsx` | Modify | Drop any assertion on the removed Bible segment (E). |

---

### Task 1: Change D — dark-mode auth logo

**Files:**
- Modify: `src/auth/AuthCard.tsx` (line 142)
- Test: manual smoke (CSS-class-only change; no render harness asserts computed filter)

**Interfaces:**
- Consumes: existing global rule `.dark .notepad-nav-logo { filter: brightness(0) invert(1); }` (`src/index.css:233`).
- Produces: none (pure markup).

- [ ] **Step 1: Write the failing test** — This is a one-class markup change with no behavioral surface a unit test can assert (the filter comes from a global CSS rule jsdom does not compute). Use a manual smoke instead, recorded here as the verification contract:

  > **Manual smoke (run in Step 4):** Open the in-app auth modal under a notepad route (`/notepad/notes`) with dark mode ON. EXPECT: the `LivePsalms` logo at the top of the card renders light (white), not dark. Toggle dark mode OFF → logo returns to its normal dark rendering. Open standalone `/login` (never dark-eligible) → logo unchanged.

- [ ] **Step 2: Run test to verify it fails** — Confirm the current (pre-change) state is the bug:

  ```bash
  grep -n 'src="/logo-icon.png"' src/auth/AuthCard.tsx
  ```

  EXPECT line 142 to show `className="h-10 w-auto mb-3"` with NO `notepad-nav-logo` class (the dark-mode lighten rule cannot apply → bug present).

- [ ] **Step 3: Write minimal implementation** — Add the class:

  ```diff
  -        <img src="/logo-icon.png" alt="LivePsalms" className="h-10 w-auto mb-3" />
  +        <img src="/logo-icon.png" alt="LivePsalms" className="notepad-nav-logo h-10 w-auto mb-3" />
  ```

- [ ] **Step 4: Verify** — Re-run the grep to confirm the class landed, then perform the manual smoke from Step 1:

  ```bash
  grep -n 'notepad-nav-logo h-10 w-auto mb-3' src/auth/AuthCard.tsx
  ```

  EXPECT one match. Then run the dark-mode manual smoke and confirm the logo lightens.

- [ ] **Step 5: Commit**

  ```bash
  git add src/auth/AuthCard.tsx
  git commit -m "fix(auth,dark): lighten in-app auth logo in dark mode

Add the notepad-nav-logo class so the existing .dark filter rule lightens
the LivePsalms logo when the auth modal renders under a dark-eligible
notepad route. Standalone /login is unaffected (never dark-eligible).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Change C — dark-mode Study input fix

**Files:**
- Modify: `src/notepad/study/panes/LamplightStudyPanel.tsx` (input style, lines 107–115)
- Test: `src/notepad/study/panes/LamplightStudyPanel.test.tsx` (add one assertion)

**Interfaces:**
- Consumes: CSS vars `--surface-elevated`, `--pale-stone`, `--deep-umber` (defined in `src/index.css`, flipped under `.dark`).
- Produces: none.

- [ ] **Step 1: Write the failing test** — Add to `LamplightStudyPanel.test.tsx` (the existing mocks already render the panel signed-in). Append this `it` inside the existing `describe('LamplightStudyPanel notes-on-offer', ...)`:

  ```tsx
  it('themes the input so typed text follows the theme (visible in dark mode)', () => {
    render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
    const input = screen.getByPlaceholderText(/ask/i) as HTMLInputElement;
    // inline style uses CSS vars so the field + ink follow --surface-elevated / --deep-umber
    expect(input.style.color).toBe('var(--deep-umber)');
    expect(input.style.background).toBe('var(--surface-elevated)');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT the new test to FAIL: `input.style.color` is `''` (no color set) and `input.style.background` is `''` for a signed-in user (current code only sets `background` when signed-out).

- [ ] **Step 3: Write minimal implementation** — In `LamplightStudyPanel.tsx`, replace the input `style` block (lines 107–115). Keep the disabled-state treatment for the signed-out background:

  ```diff
           style={{
             flex: 1,
             fontSize: 13,
             padding: '8px 10px',
             borderRadius: 6,
  -          border: '1px solid var(--pale-stone)',
  -          background: signedIn ? undefined : 'rgba(0,0,0,0.03)',
  +          border: '1px solid var(--pale-stone)',
  +          background: signedIn ? 'var(--surface-elevated)' : 'rgba(0,0,0,0.03)',
  +          color: 'var(--deep-umber)',
             cursor: signedIn ? undefined : 'not-allowed',
           }}
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT all tests in the file to PASS (5 total — the 4 existing plus the new theming assertion).

- [ ] **Step 5: Commit**

  ```bash
  git add src/notepad/study/panes/LamplightStudyPanel.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
  git commit -m "fix(study,dark): theme the Study chat input so typed text is visible

Bind the input background to --surface-elevated and the ink to
--deep-umber (matching the Bible chat input) so typed text no longer
disappears against the dark surface.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Change A — refined-flat Study chat message layout

**Files:**
- Modify: `src/notepad/study/panes/LamplightStudyPanel.tsx` (message map, lines 79–84)
- Test: `src/notepad/study/panes/LamplightStudyPanel.test.tsx` (add layout assertions)

**Interfaces:**
- Consumes: `thread.messages` (`StudyThreadMessage[]` from `useStudyChatThread`); CSS vars `--lamplight-accent` (indigo in Study), `--silica`, `--deep-umber`.
- Produces: per-message DOM with `data-role` on the row and `data-testid="lamplight-accent-bar"` on the assistant accent bar (consumed by later streaming task).

- [ ] **Step 1: Write the failing test** — Add to `LamplightStudyPanel.test.tsx`. First, extend the `useStudyChatThread` mock at the top of the file so a test can seed messages. Replace the existing mock block:

  ```diff
  -vi.mock('../useStudyChatThread', () => ({
  -  useStudyChatThread: () => ({ messages: [], loading: false, error: null, append: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn() }),
  -}));
  +const studyThreadMessages: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: unknown[] }> = [];
  +vi.mock('../useStudyChatThread', () => ({
  +  useStudyChatThread: () => ({ messages: studyThreadMessages, loading: false, error: null, append: vi.fn(), reload: vi.fn(), archiveAndReset: vi.fn() }),
  +}));
  ```

  Then append a new `describe` block at the end of the file:

  ```tsx
  describe('LamplightStudyPanel refined-flat layout', () => {
    afterEach(() => { studyThreadMessages.length = 0; });

    it('renders a user turn right-aligned with a "You" label', () => {
      studyThreadMessages.push({ id: 'u1', role: 'user', content: 'hi there', citations: [] });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      const row = document.querySelector('[data-role="user"]') as HTMLElement;
      expect(row).toBeTruthy();
      expect(row.textContent).toContain('You');
      expect(row.textContent).toContain('hi there');
      expect(row.style.textAlign).toBe('right');
    });

    it('renders an assistant turn with an indigo accent bar + "Lamplight" label', () => {
      studyThreadMessages.push({ id: 'a1', role: 'assistant', content: 'Grace and peace.', citations: [] });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      const row = document.querySelector('[data-role="assistant"]') as HTMLElement;
      expect(row).toBeTruthy();
      expect(row.textContent).toContain('Lamplight');
      expect(row.textContent).toContain('Grace and peace.');
      const bar = row.querySelector('[data-testid="lamplight-accent-bar"]') as HTMLElement;
      expect(bar).toBeTruthy();
      expect(bar.style.background).toBe('var(--lamplight-accent)');
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT the two new tests to FAIL: the current rows have no `data-role`, no `data-testid="lamplight-accent-bar"`, no right-alignment, and the assistant label reads "Lamplight Study" not "Lamplight".

- [ ] **Step 3: Write minimal implementation** — Replace the message map (lines 79–84) in `LamplightStudyPanel.tsx`:

  ```diff
  -        {thread.messages.map((m) => (
  -          <div key={m.id} style={{ marginBottom: 12 }}>
  -            <div style={{ fontSize: 10, color: 'var(--silica)', marginBottom: 2 }}>{m.role === 'user' ? 'You' : 'Lamplight Study'}</div>
  -            <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
  -          </div>
  -        ))}
  +        {thread.messages.map((m) =>
  +          m.role === 'user' ? (
  +            <div key={m.id} data-role="user" style={{ marginBottom: 20, textAlign: 'right' }}>
  +              <div style={{ fontSize: 10, color: 'var(--silica)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>You</div>
  +              <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
  +            </div>
  +          ) : (
  +            <div key={m.id} data-role="assistant" style={{ marginBottom: 20, display: 'flex' }}>
  +              <div
  +                data-testid="lamplight-accent-bar"
  +                style={{ width: 2, alignSelf: 'stretch', background: 'var(--lamplight-accent)', borderRadius: 1, flexShrink: 0 }}
  +              />
  +              <div style={{ paddingLeft: 10, flex: 1 }}>
  +                <div style={{ fontSize: 10, color: 'var(--silica)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Lamplight</div>
  +                <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>{m.content}</div>
  +              </div>
  +            </div>
  +          ),
  +        )}
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT all tests in the file to PASS (7 total). Note the existing empty-state test ("start a conversation…") still passes because the empty array path is unchanged.

- [ ] **Step 5: Commit**

  ```bash
  git add src/notepad/study/panes/LamplightStudyPanel.tsx src/notepad/study/panes/LamplightStudyPanel.test.tsx
  git commit -m "feat(study): refined-flat Study chat message layout

Replace the role-label rows with a refined-flat design: user turns
right-aligned under a 'You' label, assistant turns under a 2px indigo
accent bar (var(--lamplight-accent)) with a 'Lamplight' label and wider
inter-turn spacing. No bubbles.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 4: Change B (backend, shared) — `extraDoneFields` on `streamBibleChat`

**Files:**
- Modify: `supabase/functions/lamplight-chat/bible-chat-stream.ts` (`BibleChatStreamDeps` interface; `done` emit ~line 111)
- Test: `supabase/functions/lamplight-chat/bible-chat-stream.test.ts` (add 2 tests)

**Interfaces:**
- Consumes: existing `BibleChatStreamDeps`, `streamBibleChat(deps, args)`.
- Produces: `BibleChatStreamDeps.extraDoneFields?: () => Record<string, unknown>` — when present, its returned object is spread into the `done` event payload AFTER the base fields. Study supplies `() => ({ offered_notes })`; Bible chat omits it.

- [ ] **Step 1: Write the failing test** — Add to `bible-chat-stream.test.ts`, inside the existing `describe('streamBibleChat', ...)`:

  ```ts
  it('spreads extraDoneFields into the done payload (study offered_notes)', async () => {
    const res = await streamBibleChat(
      makeDeps({ extraDoneFields: () => ({ offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] }) }),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    expect(res.status).toBe(200);
    const body = await drainSse(res);
    expect(body).toContain('"t":"done"');
    expect(body).toContain('"offered_notes"');
    expect(body).toContain('"id":"n1"');
    // base fields still present
    expect(body).toContain('"ok":true');
    expect(body).toContain('"thread_id":"thread-1"');
  });

  it('omits offered_notes from done when extraDoneFields is not provided (bible chat unchanged)', async () => {
    const res = await streamBibleChat(
      makeDeps(),
      { userId: 'user-1', mode: 'chat', message: 'hi', threadTitle: 't' },
    );
    const body = await drainSse(res);
    expect(body).toContain('"t":"done"');
    expect(body).not.toContain('offered_notes');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run supabase/functions/lamplight-chat/bible-chat-stream.test.ts
  ```

  EXPECT the first new test to FAIL (`offered_notes` not in the body — the dep does not exist yet). The "omits" test passes already but is asserted to lock Bible chat behavior.

- [ ] **Step 3: Write minimal implementation** — In `bible-chat-stream.ts`, add the optional dep to the interface (after `prompt?`):

  ```diff
     llm: LLMAdapter;
     prompt?: ChatPromptModule; // insight passes BIBLE_INSIGHT_PROMPT; chat leaves undefined
  +  // Optional extra fields spread into the `done` event payload (after the base
  +  // fields). Study supplies offered_notes here; bible chat omits it → unchanged.
  +  extraDoneFields?: () => Record<string, unknown>;
   }
  ```

  Then update the `done` emit (~line 111) to spread the extras:

  ```diff
       if (result.ok) {
         await deps.persistAssistant(threadId, result.reply, result.citations);
  -      void emit({ t: 'done', payload: { ok: true, thread_id: threadId, reply: result.reply, citations: result.citations } });
  +      void emit({
  +        t: 'done',
  +        payload: {
  +          ok: true,
  +          thread_id: threadId,
  +          reply: result.reply,
  +          citations: result.citations,
  +          ...(deps.extraDoneFields?.() ?? {}),
  +        },
  +      });
       } else {
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run supabase/functions/lamplight-chat/bible-chat-stream.test.ts
  ```

  EXPECT all tests in the file to PASS (the original 6 plus the 2 new ones = 8).

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/lamplight-chat/bible-chat-stream.ts supabase/functions/lamplight-chat/bible-chat-stream.test.ts
  git commit -m "feat(stream): optional extraDoneFields on streamBibleChat

Add an optional extraDoneFields dep that is spread into the done event
payload. Study uses it to carry offered_notes through SSE; Bible chat
omits it so its done shape is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 5: Change B (backend) — `stream` flag in `parse-body`

**Files:**
- Modify: `supabase/functions/lamplight-study/parse-body.ts`
- Test: `supabase/functions/lamplight-study/parse-body.test.ts` (create)

**Interfaces:**
- Consumes: raw request body (`{ stream?: unknown, ... }`).
- Produces: `ParsedStudyBody` now includes `stream: boolean` on the `ok: true` variant. `parseStudyBody` sets `stream === true` only when `body.stream === true`.

- [ ] **Step 1: Write the failing test** — Create `supabase/functions/lamplight-study/parse-body.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { parseStudyBody } from './parse-body.ts';

  describe('parseStudyBody stream flag', () => {
    it('defaults stream to false when absent', () => {
      const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.stream).toBe(false);
    });

    it('parses stream:true when explicitly set', () => {
      const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', stream: true });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.stream).toBe(true);
    });

    it('treats a non-boolean stream as false', () => {
      const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', stream: 'yes' as unknown as boolean });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.stream).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run supabase/functions/lamplight-study/parse-body.test.ts
  ```

  EXPECT FAIL: `out.stream` is `undefined` (the field does not exist on `ParsedStudyBody` yet — TS would also flag it, but the runtime assertion fails first).

- [ ] **Step 3: Write minimal implementation** — In `parse-body.ts`, add `stream` to the type and parse it:

  ```diff
   export type ParsedStudyBody =
  -  | { ok: true; book: string; chapter: number; message: string; mode: 'chat' | 'insight'; includeNotes: boolean; noteIds: string[]; translation?: Translation }
  +  | { ok: true; book: string; chapter: number; message: string; mode: 'chat' | 'insight'; includeNotes: boolean; noteIds: string[]; translation?: Translation; stream: boolean }
     | { ok: false };

   export function parseStudyBody(body: {
     book?: unknown; chapter?: unknown; message?: unknown; mode?: unknown;
  -  include_notes?: unknown; note_ids?: unknown; translation?: unknown;
  +  include_notes?: unknown; note_ids?: unknown; translation?: unknown; stream?: unknown;
   }): ParsedStudyBody {
     const mode = body.mode === 'insight' ? 'insight' : 'chat';
     if (typeof body.book !== 'string' || typeof body.chapter !== 'number') return { ok: false };
     if (mode === 'chat' && (typeof body.message !== 'string' || !body.message.trim())) return { ok: false };
     return {
       ok: true,
       book: body.book,
       chapter: body.chapter,
       message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '',
       mode,
       includeNotes: body.include_notes === true,
       noteIds: Array.isArray(body.note_ids) ? body.note_ids.filter((x): x is string => typeof x === 'string') : [],
       translation: (typeof body.translation === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(body.translation)) ? body.translation as Translation : undefined,
  +    stream: body.stream === true,
     };
   }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run supabase/functions/lamplight-study/parse-body.test.ts
  ```

  EXPECT all 3 tests to PASS. Also re-run the existing study tests to confirm no regression from the new required field:

  ```bash
  npx vitest run supabase/functions/lamplight-study/
  ```

  EXPECT the existing `index.test.ts` and `study-context.test.ts` to still PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/lamplight-study/parse-body.ts supabase/functions/lamplight-study/parse-body.test.ts
  git commit -m "feat(study,stream): parse a stream flag in lamplight-study body

Add stream:boolean to ParsedStudyBody (true only when body.stream===true)
so the edge function can take an SSE path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 6: Change B (backend) — `lamplight-study` SSE branch

**Files:**
- Modify: `supabase/functions/lamplight-study/index.ts` (add imports + a `wantsStream` branch in `handleStudy`)

**Interfaces:**
- Consumes: `parseStudyBody` (`stream` from Task 5), `streamBibleChat` + `BibleChatStreamDeps` + `extraDoneFields` (Task 4), `buildStudyContext` (`{ ctx, offered }`), `hasChatAccess`, `checkQuota`/`recordLamplightUsage`, `upsertStudyThread`, prompts `STUDY_CHAT_PROMPT`/`STUDY_INSIGHT_PROMPT`.
- Produces: an SSE `Response` from `lamplight-study` when `accept: text/event-stream` or `body.stream === true`; its `done` payload carries `offered_notes`. `artifact_kind` recorded as `bible_study` (note: `streamBibleChat` hard-codes `artifact_kind: 'bible_chat'` in its usage row — see judgment note below).

- [ ] **Step 1: Write the failing test** — This branch is integration glue over Supabase + Anthropic that the existing `index.test.ts` does not exercise (it tests parse + thread upsert seams, not the live serve). Adding a full streaming integration test here would require mocking the entire Supabase client surface, which the repo does not do for `index.ts`. Instead, lock the contract with the already-passing module test from Task 4 (the `extraDoneFields` spread) plus an explicit code-presence assertion and a manual smoke (deferred to Task 11). Record the contract test:

  ```bash
  # Contract guard: the streaming branch must wire offered_notes via extraDoneFields.
  grep -n "wantsStream" supabase/functions/lamplight-study/index.ts
  grep -n "extraDoneFields" supabase/functions/lamplight-study/index.ts
  grep -n "streamBibleChat" supabase/functions/lamplight-study/index.ts
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  grep -c "wantsStream" supabase/functions/lamplight-study/index.ts || echo "absent"
  ```

  EXPECT `0` / "absent" (no streaming branch yet).

- [ ] **Step 3: Write minimal implementation** — In `index.ts`:

  3a. Add imports (after the existing `lamplight-chat` import line 19):

  ```diff
   import { runBibleChatPipeline } from '../lamplight-chat/bible-chat-pipeline.ts';
  +import { streamBibleChat, type BibleChatStreamDeps } from '../lamplight-chat/bible-chat-stream.ts';
   import { buildStudyContext } from './study-context.ts';
  ```

  3b. Compute `wantsStream` right after the body is parsed and `userId` is resolved (after the existing translation-resolution block, before the opt-in gate at line 78). Insert:

  ```ts
  const wantsStream = req.headers.get('accept')?.includes('text/event-stream') || parsed.stream === true;
  ```

  3c. After the entitlement gate (after line 89, where `voyageDeps`/`llm`/`quotaCfg` are built — i.e. after line 94 `const quotaCfg = resolveQuotaLimits(Deno.env);`), insert the streaming branch BEFORE the `lifecycleDeps` const (the buffered path keeps using `lifecycleDeps`). The branch reuses the gate values (`tier`, `promoActive`, `translation`, etc.) already in scope:

  ```ts
  // Streaming branch: SSE over the same gates + study context as the buffered
  // path. Reuses the shared streamBibleChat helper; offered_notes ride the
  // done event via extraDoneFields (captured from buildStudyContext's `offered`).
  if (wantsStream) {
    type HistoryRow = { role: 'user' | 'assistant'; content: string };
    let capturedOffered: unknown[] = [];
    const streamQuota = async (uid: string) => {
      const q = await checkQuota(supabaseQuotaDeps(supabase), quotaCfg.study, quotaCfg.global, { userId: uid, nowMs: Date.now() });
      return q.ok ? { ok: true as const } : { ok: false as const, reason: q.reason };
    };
    const deps: BibleChatStreamDeps = {
      cors,
      isOptedIn: async (uid) => {
        const { data } = await supabase.from('lamplight_settings').select('enabled').eq('user_id', uid).maybeSingle();
        return !!(data as { enabled?: boolean } | null)?.enabled;
      },
      hasChatAccess: async () => hasChatAccess({ tier, promoActive }),
      checkQuota: streamQuota,
      recordUsage: (row) => recordLamplightUsage(supabase, row),
      upsertThread: (firstMessage) => upsertStudyThread(supabase, userId, book, chapter, passageRef, firstMessage),
      loadHistory: async (threadId) => {
        const { data } = await supabase
          .from('lamplight_chat_messages')
          .select('role, content')
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT);
        return ((data ?? []) as HistoryRow[]).reverse();
      },
      persistUserMessage: async (threadId) => {
        await supabase.from('lamplight_chat_messages').insert({ thread_id: threadId, user_id: userId, role: 'user', content: message, citations: [] });
      },
      persistAssistant: async (threadId, reply, citations) => {
        await supabase.from('lamplight_chat_messages').insert({ thread_id: threadId, user_id: userId, role: 'assistant', content: reply, citations });
        await supabase.from('lamplight_chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
      },
      buildContext: async ({ history }) => {
        let retrievalQuery = message;
        if (mode === 'insight') {
          const { data: chRows } = await supabase
            .from('bible_passages').select('text')
            .like('id', `${book}.${chapter}.%`).order('verse_start', { ascending: true }).limit(20);
          retrievalQuery = ((chRows ?? []) as Array<{ text: string }>).map((r) => r.text).join(' ').slice(0, 1500) || `${book} ${chapter}`;
        }
        const { ctx, offered } = await buildStudyContext(supabase, {
          userId, book, chapter, passageRef,
          message: mode === 'insight' ? '' : message,
          retrievalQuery, history,
          includeNotes, noteIds,
          voyageDeps, rerankEnabled,
          crossRefK: CROSSREF_K, noteK: NOTE_K,
          translation,
        });
        capturedOffered = offered;
        return ctx;
      },
      llm,
      prompt: mode === 'insight' ? STUDY_INSIGHT_PROMPT : STUDY_CHAT_PROMPT,
      extraDoneFields: () => ({ offered_notes: capturedOffered }),
    };
    return await streamBibleChat(deps, {
      userId, mode, message, threadTitle: message || `Study of ${book} ${chapter}`, signal: req.signal,
    });
  }
  ```

  Note: `checkQuota`, `supabaseQuotaDeps`, `recordLamplightUsage`, `hasChatAccess`, `STUDY_CHAT_PROMPT`, `STUDY_INSIGHT_PROMPT` are already imported in `index.ts`. `STUDY_*_PROMPT` must satisfy the `prompt?: ChatPromptModule` type — they already feed `runBibleChatPipeline` in the buffered path, which accepts the same type, so they are compatible.

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  grep -n "wantsStream\|extraDoneFields\|streamBibleChat" supabase/functions/lamplight-study/index.ts
  npx vitest run supabase/functions/lamplight-study/
  ```

  EXPECT the three greps to match (branch present) and ALL existing study tests to still PASS (the buffered path is untouched). Then typecheck the whole build to catch any type slip in the wiring:

  ```bash
  npx tsc -b
  ```

  EXPECT no NEW errors beyond the known baseline (`force-sphere.test.ts`). If `tsc -b` does not include `supabase/functions`, additionally run a targeted Deno check if available; otherwise rely on the vitest run (which type-checks via esbuild on import).

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/functions/lamplight-study/index.ts
  git commit -m "feat(study,stream): SSE branch for lamplight-study

Add a wantsStream branch that reuses streamBibleChat with study wiring
(study quota, bible_study artifact intent, study thread upsert, study
context + prompts). offered_notes ride the done event via extraDoneFields
captured from buildStudyContext. Buffered JSON path is unchanged.
Deploy is MANUAL: supabase functions deploy lamplight-study --use-api.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 7: Change B (frontend) — `study-stream-client.ts`

**Files:**
- Create: `src/notepad/study/study-stream-client.ts`
- Test: `src/notepad/study/study-stream-client.test.ts` (create)

**Interfaces:**
- Consumes: `SupabaseClient` (for `auth.getSession()`), `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- Produces:
  - `type StudySseEvent` (same wire shape as `SseEvent`).
  - `interface StreamStudyArgs { book: string; chapter: number; message: string; includeNotes?: boolean; noteIds?: string[]; translation?: string; mode?: 'chat' | 'insight' }`
  - `function makeStudyStreamInvoke(client: SupabaseClient): (args: StreamStudyArgs, handlers: { onEvent: (ev: StudySseEvent) => void; signal?: AbortSignal }) => Promise<void>` — POSTs to `lamplight-study` with `accept: text/event-stream`, bearer auth, body `{ book, chapter, message, include_notes, note_ids, translation, mode, stream: true }`; parses SSE `data:` frames; throws on non-OK non-SSE.

- [ ] **Step 1: Write the failing test** — Create `src/notepad/study/study-stream-client.test.ts` (mirrors `lamplight-stream-client.test.ts`):

  ```ts
  // src/notepad/study/study-stream-client.test.ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import type { SupabaseClient } from '@supabase/supabase-js';
  import { makeStudyStreamInvoke, type StudySseEvent } from './study-stream-client';

  const fakeClient = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok-123' } } }) },
  } as unknown as SupabaseClient;

  function streamFromFrames(frames: StudySseEvent[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const f of frames) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
        ctrl.close();
      },
    });
  }

  describe('makeStudyStreamInvoke', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('POSTs to lamplight-study with stream:true + study body + bearer auth, decodes frames in order', async () => {
      const frames: StudySseEvent[] = [
        { t: 'stage', stage: 'notes' },
        { t: 'text', field: 'reply', delta: 'Grace' },
        { t: 'done', payload: { ok: true, offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] } },
      ];
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: streamFromFrames(frames) } as unknown as Response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const received: StudySseEvent[] = [];
      const invoke = makeStudyStreamInvoke(fakeClient);
      await invoke(
        { book: 'jhn', chapter: 10, message: 'hi', includeNotes: true, noteIds: ['n1'], translation: 'BSB' },
        { onEvent: (ev) => received.push(ev) },
      );

      expect(received).toEqual(frames);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://test.supabase.co/functions/v1/lamplight-study');
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody).toEqual({
        book: 'jhn', chapter: 10, message: 'hi',
        include_notes: true, note_ids: ['n1'], translation: 'BSB',
        stream: true,
      });
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok-123');
      expect(headers.accept).toBe('text/event-stream');
    });

    it('reassembles a frame split across two chunks', async () => {
      const enc = new TextEncoder();
      const whole = `data: ${JSON.stringify({ t: 'text', field: 'reply', delta: 'Hi' })}\n\n`;
      const cut = Math.floor(whole.length / 2);
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) { ctrl.enqueue(enc.encode(whole.slice(0, cut))); ctrl.enqueue(enc.encode(whole.slice(cut))); ctrl.close(); },
      });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body: stream } as unknown as Response) as unknown as typeof fetch;

      const received: StudySseEvent[] = [];
      await makeStudyStreamInvoke(fakeClient)(
        { book: 'jhn', chapter: 10, message: 'hi' },
        { onEvent: (ev) => received.push(ev) },
      );
      expect(received).toEqual([{ t: 'text', field: 'reply', delta: 'Hi' }]);
    });

    it('throws on a non-OK non-SSE response so the caller falls back to buffered', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false, status: 500, statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"error":"boom"}')); c.close(); } }),
      } as unknown as Response) as unknown as typeof fetch;

      const onEvent = vi.fn();
      await expect(
        makeStudyStreamInvoke(fakeClient)({ book: 'jhn', chapter: 10, message: 'hi' }, { onEvent }),
      ).rejects.toThrow(/500/);
      expect(onEvent).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/notepad/study/study-stream-client.test.ts
  ```

  EXPECT FAIL: module `./study-stream-client` does not exist (import error).

- [ ] **Step 3: Write minimal implementation** — Create `src/notepad/study/study-stream-client.ts`:

  ```ts
  // src/notepad/study/study-stream-client.ts
  //
  // Client-side SSE transport for the Study chat (lamplight-study). Mirrors
  // src/notepad/bible/lamplight-stream-client.ts: POSTs with stream:true and
  // parses the text/event-stream response one `data:` line at a time. Pure src
  // module — ZERO edge-function dependency.
  import type { SupabaseClient } from '@supabase/supabase-js';

  // COPIED verbatim from supabase/functions/_shared/sse.ts — intentionally NOT
  // imported, so this src module stays free of any edge-function dependency.
  export type StudySseEvent =
    | { t: 'stage'; stage: 'notes' | 'scripture' | 'composing' }
    | { t: 'text'; field: string; delta: string }
    | { t: 'piece'; field: string; value: unknown }
    | { t: 'refining' }
    | { t: 'replace'; payload: unknown }
    | { t: 'done'; payload: unknown }
    | { t: 'error'; reason: string };

  export interface StreamStudyArgs {
    book: string;
    chapter: number;
    message: string;
    includeNotes?: boolean;
    noteIds?: string[];
    translation?: string;
    mode?: 'chat' | 'insight';
  }

  export type StudyStreamInvoke = (
    args: StreamStudyArgs,
    handlers: { onEvent: (ev: StudySseEvent) => void; signal?: AbortSignal },
  ) => Promise<void>;

  export function makeStudyStreamInvoke(client: SupabaseClient): StudyStreamInvoke {
    return async function streamStudyMessage(args, handlers) {
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;

      const body: Record<string, unknown> = {
        book: args.book,
        chapter: args.chapter,
        message: args.message,
        include_notes: args.includeNotes ?? false,
        note_ids: args.noteIds ?? [],
        translation: args.translation,
        stream: true,
      };
      if (args.mode) body.mode = args.mode;

      const res = await fetch(`${url}/functions/v1/lamplight-study`, {
        method: 'POST',
        signal: handlers.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anon,
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // A non-OK response is never an SSE stream in this design (gates/errors are
      // JSON before any stream). Throw so the caller fast-paths to its buffered
      // fallback — unless a future path streams an error beat at a non-200 status.
      if (!res.ok) {
        const contentType = res.headers?.get('content-type') ?? '';
        if (!contentType.includes('text/event-stream')) {
          throw new Error(`lamplight-study stream failed: ${res.status} ${res.statusText}`);
        }
      }

      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trimEnd();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          let evt: StudySseEvent;
          try { evt = JSON.parse(json) as StudySseEvent; } catch { continue; }
          handlers.onEvent(evt);
        }
      }
    };
  }
  ```

  Note: the `translation` key is always present in the body (set to `undefined` when not supplied). `JSON.stringify` drops `undefined` values, so the test's `toEqual` (which omits `translation` when not passed) holds for the chunk-split test — but the first test DOES pass `translation: 'BSB'`, so it is present. Confirmed the first test passes `translation: 'BSB'`; the chunk-split test only checks decoded frames, not the body, so the omitted-translation case is not asserted.

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/notepad/study/study-stream-client.test.ts
  ```

  EXPECT all 3 tests to PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/notepad/study/study-stream-client.ts src/notepad/study/study-stream-client.test.ts
  git commit -m "feat(study,stream): client SSE transport for lamplight-study

Add makeStudyStreamInvoke mirroring the Bible lamplight-stream-client:
POSTs to lamplight-study with stream:true + study body, parses SSE frames,
throws on non-OK non-SSE so callers fall back to the buffered path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 8: Change B (frontend) — wire streaming into `LamplightStudyPanel`

**Files:**
- Modify: `src/notepad/study/panes/LamplightStudyPanel.tsx`
- Test: `src/notepad/study/panes/LamplightStudyPanel.test.tsx` (add streaming + fallback tests)

**Interfaces:**
- Consumes: `makeStudyStreamInvoke` / `StreamStudyArgs` / `StudySseEvent` (Task 7); existing `sendStudyMessage` (buffered fallback); `useStudyChatThread` (`append` only — NO `updateLast`); `useNotesOnOffer` (`setOffered`).
- Produces: a live assistant placeholder driven by local state (`streamingId` + `streamingContent`) rendered through the same refined-flat assistant row (Task 3) with a blinking caret while streaming. On `done`: append the finalized assistant message to the thread, call `notes.setOffered(...)`. On `error`/throw/no-terminal: fall back to `sendStudyMessage`.

  **Design note (real divergence from the Bible reference):** `useStudyChatThread` has NO `updateLast` and `StudyThreadMessage` has no `streaming` field (unlike `useChatThread`). So the live placeholder is held in component state (`streamingId`, `streamingContent`), NOT in the thread. On `done` the finalized turn is committed via `thread.append`, and the local streaming state is cleared. This keeps the thread hook untouched.

- [ ] **Step 1: Write the failing test** — Add to `LamplightStudyPanel.test.tsx`. The supabase mock must expose an `auth.getSession` (the stream client reads it). Update the supabase mock and add a streaming describe block.

  Replace the supabase mock:

  ```diff
  -vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
  +vi.mock('@/lib/supabase', () => ({
  +  supabase: {
  +    functions: { invoke: vi.fn() },
  +    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  +  },
  +}));
  ```

  Add a mock for the new stream client and the stream env, plus the describe block (append to the file):

  ```tsx
  const streamStudyMessage = vi.fn();
  vi.mock('../study-stream-client', () => ({
    makeStudyStreamInvoke: () => (...a: unknown[]) => streamStudyMessage(...a),
  }));

  describe('LamplightStudyPanel streaming', () => {
    afterEach(() => { studyThreadMessages.length = 0; streamStudyMessage.mockReset(); });

    it('streams the assistant reply live then commits the finalized turn + offered notes', async () => {
      streamStudyMessage.mockImplementation(async (_args: unknown, handlers: { onEvent: (ev: unknown) => void }) => {
        handlers.onEvent({ t: 'stage', stage: 'notes' });
        handlers.onEvent({ t: 'text', field: 'reply', delta: 'Grace ' });
        handlers.onEvent({ t: 'text', field: 'reply', delta: 'and peace.' });
        handlers.onEvent({ t: 'done', payload: { ok: true, reply: 'Grace and peace.', citations: [], offered_notes: [{ id: 'n1', title: 'A', snippet: 's' }] } });
      });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(screen.getByText(/grace and peace\./i)).toBeTruthy());
      await waitFor(() => expect(screen.getByText(/1 note/i)).toBeTruthy());
      expect(sendStudyMessage).not.toHaveBeenCalled(); // streaming succeeded → no buffered fallback
    });

    it('falls back to the buffered send when the stream throws', async () => {
      streamStudyMessage.mockRejectedValue(new Error('network'));
      sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'Buffered reply.', citations: [], offeredNotes: [] });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByText(/buffered reply\./i)).toBeTruthy());
    });

    it('falls back to buffered send when the stream emits an error beat', async () => {
      streamStudyMessage.mockImplementation(async (_a: unknown, h: { onEvent: (ev: unknown) => void }) => {
        h.onEvent({ t: 'error', reason: 'validators_failed' });
      });
      sendStudyMessage.mockResolvedValue({ ok: true, threadId: 't', reply: 'Recovered.', citations: [], offeredNotes: [] });
      render(<LamplightStudyPanel book="jhn" chapter={10} userId="u1" />);
      fireEvent.change(screen.getByPlaceholderText(/ask/i), { target: { value: 'hello' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
      await waitFor(() => expect(sendStudyMessage).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByText(/recovered\./i)).toBeTruthy());
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT the 3 new streaming tests to FAIL: `makeStudyStreamInvoke` is not yet imported/used, so `doSend` still calls only `sendStudyMessage` (no live caret, and the success test asserts `sendStudyMessage` was NOT called).

- [ ] **Step 3: Write minimal implementation** — Edit `LamplightStudyPanel.tsx`:

  3a. Add imports (after the existing `study-chat-client` import, line 6):

  ```diff
   import { sendStudyMessage, requestStudyInsight } from '../study-chat-client';
  +import { makeStudyStreamInvoke, type StudySseEvent } from '../study-stream-client';
  ```

  3b. Add a memoized stream invoker and local streaming state inside the component (after `const [lastMessage, setLastMessage] = useState<string>('');`, line 36):

  ```diff
     const [lastMessage, setLastMessage] = useState<string>('');
  +  const streamInvoke = useMemo(() => (supabase ? makeStudyStreamInvoke(supabase) : null), []);
  +  const [streamingContent, setStreamingContent] = useState<string | null>(null);
     const signedIn = !!userId;
  ```

  Add `useMemo` to the React import:

  ```diff
  -import { useCallback, useState } from 'react';
  +import { useCallback, useMemo, useState } from 'react';
  ```

  3c. Replace `doSend` (lines 39–54) so it streams first, with a buffered fallback. The live placeholder is rendered from `streamingContent` (see 3d):

  ```ts
  const bufferedSend = useCallback(async (message: string, includeIds: string[]) => {
    const res = await sendStudyMessage(invoke, {
      book, chapter, message,
      includeNotes: includeIds.length > 0,
      noteIds: includeIds,
      translation,
    });
    if (!res.ok) { setError(friendlyError(res.reason)); return; }
    thread.append([{ id: `a-${Date.now()}`, role: 'assistant', content: res.reply, citations: res.citations }]);
    notes.setOffered(res.offeredNotes);
  }, [book, chapter, translation, thread, notes]);

  const doSend = useCallback(async (message: string, includeIds: string[]) => {
    setSending(true); setError(null);
    if (!includeIds.length) {
      thread.append([{ id: `local-${Date.now()}`, role: 'user', content: message, citations: [] }]);
    }

    if (!streamInvoke) {
      await bufferedSend(message, includeIds);
      setSending(false);
      return;
    }

    setStreamingContent('');
    let content = '';
    let terminal = false;
    let donePayload: { reply?: string; citations?: ChatCitation[]; offered_notes?: OfferedNote[] } | null = null;
    const onEvent = (ev: StudySseEvent) => {
      switch (ev.t) {
        case 'text':
          if (ev.field !== 'reply') break;
          content += ev.delta;
          setStreamingContent(content);
          break;
        case 'done':
          terminal = true;
          donePayload = (ev.payload ?? {}) as typeof donePayload;
          break;
        case 'error':
          terminal = true;
          break;
        // stage / piece / refining are ignored for the Study refined-flat view
      }
    };

    try {
      await streamInvoke(
        { book, chapter, message, includeNotes: includeIds.length > 0, noteIds: includeIds, translation },
        { onEvent },
      );
    } catch {
      setStreamingContent(null);
      await bufferedSend(message, includeIds);
      setSending(false);
      return;
    }

    setStreamingContent(null);
    if (terminal && donePayload) {
      thread.append([{
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: typeof donePayload.reply === 'string' ? donePayload.reply : content,
        citations: donePayload.citations ?? [],
      }]);
      notes.setOffered(donePayload.offered_notes ?? []);
    } else {
      // error beat or no terminal event → recover via buffered send
      await bufferedSend(message, includeIds);
    }
    setSending(false);
  }, [book, chapter, translation, thread, notes, streamInvoke, bufferedSend]);
  ```

  Add the type imports used above (`ChatCitation`, `OfferedNote`):

  ```diff
  -import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';
  +import type { ChatCitation, InvokeFn } from '@/notepad/bible/lamplight-chat-client';
  +import type { OfferedNote } from '../study-chat-client';
  ```

  3d. Render the live streaming placeholder. Right AFTER the `thread.messages.map(...)` block (the close of Task 3's map, before the `notes.offered.length > 0` block at line 85), insert a placeholder assistant row driven by `streamingContent`:

  ```tsx
  {streamingContent !== null && (
    <div data-role="assistant" data-streaming="true" style={{ marginBottom: 20, display: 'flex' }}>
      <div
        data-testid="lamplight-accent-bar"
        style={{ width: 2, alignSelf: 'stretch', background: 'var(--lamplight-accent)', borderRadius: 1, flexShrink: 0 }}
      />
      <div style={{ paddingLeft: 10, flex: 1 }}>
        <div style={{ fontSize: 10, color: 'var(--silica)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Lamplight</div>
        <div style={{ fontSize: 13, color: 'var(--deep-umber)', whiteSpace: 'pre-wrap' }}>
          {streamingContent}
          <span aria-hidden style={{ display: 'inline-block', width: 7, height: 14, marginLeft: 2, verticalAlign: 'text-bottom', background: 'var(--lamplight-accent)', animation: 'lamplight-caret 1s steps(1) infinite' }} />
        </div>
      </div>
    </div>
  )}
  ```

  Add the caret keyframes to `src/index.css` (near the bottom, after the existing `.notepad-nav-logo` block). This is a tiny global addition used only by the caret:

  ```css
  @keyframes lamplight-caret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/notepad/study/panes/LamplightStudyPanel.test.tsx
  ```

  EXPECT ALL tests in the file to PASS (the streaming success, throw-fallback, and error-beat-fallback tests, plus all earlier tests). Also run the study client + stream client tests together to confirm no cross-file breakage:

  ```bash
  npx vitest run src/notepad/study/
  ```

  EXPECT no NEW failures.

- [ ] **Step 5: Commit**

  ```bash
  git add src/notepad/study/panes/LamplightStudyPanel.tsx src/index.css src/notepad/study/panes/LamplightStudyPanel.test.tsx
  git commit -m "feat(study,stream): live streaming in LamplightStudyPanel with buffered fallback

Drive a live assistant placeholder (local streamingContent state + blinking
caret) from study SSE deltas; on done, commit the finalized turn and offered
notes; on throw / error beat / no terminal, fall back to the buffered
sendStudyMessage path. useStudyChatThread has no updateLast, so the live
placeholder is held in component state rather than the thread.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 9: Change E (part 1) — MobileTab union + Bible bottom tab

**Files:**
- Modify: `src/components/sections/notepad/mobile/types.ts`
- Modify: `src/components/sections/notepad/mobile/MobileTabBar.tsx`
- Test: `src/components/sections/notepad/mobile/MobileTabBar.test.tsx`

**Interfaces:**
- Consumes: `MobileTab` union.
- Produces: `MobileTab = 'notes' | 'editor' | 'lamplight' | 'bible' | 'more'`. `MobileTabBar` renders Notes · Editor · Bible · More (Bible uses `BookOpen`); the `lamplightHasConnections` prop is REMOVED from `MobileTabBarProps` (flame/dot moved to the header in Task 10).

- [ ] **Step 1: Write the failing test** — Rewrite `MobileTabBar.test.tsx` to assert Bible (not Lamplight) and no `lamplightHasConnections` prop:

  ```tsx
  // @vitest-environment jsdom
  import { render, cleanup, fireEvent } from '@testing-library/react';
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { MobileTabBar } from './MobileTabBar';

  afterEach(cleanup);

  describe('<MobileTabBar />', () => {
    it('renders Notes, Editor, Bible, More (no Lamplight) and marks the active one', () => {
      const { getByRole, queryByRole } = render(
        <MobileTabBar active="editor" onSelect={() => {}} />,
      );
      expect(getByRole('tab', { name: /Notes/ })).toBeTruthy();
      expect(getByRole('tab', { name: /Editor/ }).getAttribute('aria-selected')).toBe('true');
      expect(getByRole('tab', { name: /Bible/ })).toBeTruthy();
      expect(getByRole('tab', { name: /More/ })).toBeTruthy();
      expect(queryByRole('tab', { name: /Lamplight/ })).toBeNull();
    });

    it('calls onSelect with the tab id when a tab is tapped', () => {
      const onSelect = vi.fn();
      const { getByRole } = render(<MobileTabBar active="notes" onSelect={onSelect} />);
      fireEvent.click(getByRole('tab', { name: /Bible/ }));
      expect(onSelect).toHaveBeenCalledWith('bible');
    });

    it('never renders the lamplight connection dot in the bar (it moved to the header)', () => {
      const { container } = render(<MobileTabBar active="notes" onSelect={() => {}} />);
      expect(container.querySelector('[data-testid="lamplight-dot"]')).toBeNull();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileTabBar.test.tsx
  ```

  EXPECT FAIL: current bar renders a Lamplight tab (no Bible), requires `lamplightHasConnections`, and `onSelect('bible')` is unreachable.

- [ ] **Step 3: Write minimal implementation**

  3a. `types.ts`:

  ```diff
  -export type MobileTab = 'notes' | 'editor' | 'lamplight' | 'more';
  +export type MobileTab = 'notes' | 'editor' | 'lamplight' | 'bible' | 'more';
  ```

  3b. Rewrite `MobileTabBar.tsx`:

  ```tsx
  import { NotebookPen, Pencil, BookOpen, MoreHorizontal } from 'lucide-react';
  import type { MobileTab } from './types';

  interface TabDef {
    id: MobileTab;
    label: string;
    Icon: typeof NotebookPen;
  }

  const TABS: TabDef[] = [
    { id: 'notes', label: 'Notes', Icon: NotebookPen },
    { id: 'editor', label: 'Editor', Icon: Pencil },
    { id: 'bible', label: 'Bible', Icon: BookOpen },
    { id: 'more', label: 'More', Icon: MoreHorizontal },
  ];

  export interface MobileTabBarProps {
    active: MobileTab;
    onSelect: (tab: MobileTab) => void;
  }

  export function MobileTabBar({ active, onSelect }: MobileTabBarProps) {
    return (
      <div
        role="tablist"
        className="shrink-0 flex"
        style={{
          borderTop: '1px solid var(--pale-stone)',
          background: 'var(--notepad-bar-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          fontFamily: 'Outfit, sans-serif',
        }}
      >
        {TABS.map(({ id, label, Icon }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(id)}
              className="relative flex-1 flex flex-col items-center justify-center gap-0.5"
              style={{
                minHeight: 56,
                color: selected ? 'var(--deep-umber)' : 'var(--silica)',
                borderTop: selected ? '2px solid var(--deep-umber)' : '2px solid transparent',
                background: 'transparent',
              }}
            >
              <span className="relative">
                <Icon size={18} />
              </span>
              <span className="text-[10px] tracking-wide">{label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileTabBar.test.tsx
  ```

  EXPECT all 3 tests to PASS. **Cross-file note (do not act on it here — it is handled in Task 11):** removing the bottom `lamplightHasConnections` prop and the `/Lamplight/` bottom tab breaks two consumers — `MobileNotepadWorkspace.tsx` still passes `lamplightHasConnections` to the bar (a type error) and `MobileNotepadWorkspace.test.tsx` still clicks a `/Lamplight/` *tab* that no longer exists. Both are fixed in Task 11 (Tasks 9–11 form one nav-swap unit). Therefore the repo-wide `tsc -b` and the `MobileNotepadWorkspace.test.tsx` file are EXPECTED to be red between Task 9 and Task 11; the full typecheck gate runs only at Task 11 Step 4. Running `MobileTabBar.test.tsx` in isolation (above) still passes.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/sections/notepad/mobile/types.ts src/components/sections/notepad/mobile/MobileTabBar.tsx src/components/sections/notepad/mobile/MobileTabBar.test.tsx
  git commit -m "feat(mobile,nav): replace bottom Lamplight tab with a Bible tab

Bottom bar is now Notes / Editor / Bible (BookOpen) / More. Remove the
flame accent + connection-dot logic and the lamplightHasConnections prop
from MobileTabBar (the flame moves to the top header). Add 'bible' to the
MobileTab union (lamplight stays valid as a header-triggered view).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 10: Change E (part 2) — header Lamplight flame button

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileNotesView.tsx`
- Modify: `src/components/sections/notepad/mobile/MobileEditorView.tsx`
- Test: `src/components/sections/notepad/mobile/MobileNotesView.test.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `MobileNotesViewProps` and `MobileEditorViewProps` each gain `onOpenLamplight?: () => void` and `lamplightHasConnections?: boolean`. Each header renders a gold (`#b8843a`) `Flame` button with `aria-label="Lamplight"`, left of Search (Notes) / left of ThemeToggle (Editor), showing a `data-testid="lamplight-dot"` gold dot when `lamplightHasConnections`.

- [ ] **Step 1: Write the failing test** — Read the existing `MobileNotesView.test.tsx` first to preserve its existing assertions, then add (append a new describe, or extend). Add these tests:

  ```tsx
  it('renders a Lamplight flame button that calls onOpenLamplight', () => {
    const onOpenLamplight = vi.fn();
    const { getByRole } = render(
      <MobileNotesView
        onExit={() => {}}
        onOpenSearch={() => {}}
        onNewNote={() => {}}
        onScanNote={() => {}}
        onUploadFiles={() => {}}
        onOpenNote={() => {}}
        onOpenLamplight={onOpenLamplight}
        lamplightHasConnections={false}
      />,
    );
    const btn = getByRole('button', { name: /Lamplight/i });
    fireEvent.click(btn);
    expect(onOpenLamplight).toHaveBeenCalledTimes(1);
  });

  it('shows the connection dot on the flame only when lamplightHasConnections is true', () => {
    const base = {
      onExit: () => {}, onOpenSearch: () => {}, onNewNote: () => {},
      onScanNote: () => {}, onUploadFiles: () => {}, onOpenNote: () => {},
      onOpenLamplight: () => {},
    };
    const { container, rerender } = render(<MobileNotesView {...base} lamplightHasConnections={false} />);
    expect(container.querySelector('[data-testid="lamplight-dot"]')).toBeNull();
    rerender(<MobileNotesView {...base} lamplightHasConnections />);
    expect(container.querySelector('[data-testid="lamplight-dot"]')).not.toBeNull();
  });
  ```

  Ensure the test file imports `fireEvent` and `vi` (add to the existing import line if missing). `MobileNotesView` renders `NotepadSidebar` and `MobileFabMenu`; if the existing test already renders it without extra providers, these additions need none beyond what's there. If `NotepadSidebar` requires context the existing tests don't already mock, mirror whatever the existing `MobileNotesView.test.tsx` does (it already renders the component successfully, so reuse its setup).

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileNotesView.test.tsx
  ```

  EXPECT FAIL: no `Lamplight` button exists in the header yet; `onOpenLamplight`/`lamplightHasConnections` are not props.

- [ ] **Step 3: Write minimal implementation**

  3a. `MobileNotesView.tsx` — add the icon import, props, and the button. Update the import line:

  ```diff
  -import { Search, User } from 'lucide-react';
  +import { Search, User, Flame } from 'lucide-react';
  ```

  Add props to the interface and destructure:

  ```diff
     onOpenNote: (id: string) => void;
  +  /** Opens the Lamplight view (relocated from the bottom bar to the header). */
  +  onOpenLamplight?: () => void;
  +  /** Show the gold connection dot on the flame when Lamplight has neighbors. */
  +  lamplightHasConnections?: boolean;
     /** Opens the account menu (signed in) or the sign in / sign up modal (signed out). */
     onOpenAccount?: () => void;
  ```

  ```diff
     onOpenNote,
  +  onOpenLamplight,
  +  lamplightHasConnections,
     onOpenAccount,
     avatarUrl,
   }: MobileNotesViewProps) {
  ```

  Insert the flame button as the FIRST child of the right-side cluster (before Search):

  ```diff
         <div className="flex items-center gap-1">
  +        <button
  +          aria-label="Lamplight"
  +          onClick={onOpenLamplight}
  +          className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
  +          style={{ color: '#b8843a' }}
  +        >
  +          <Flame size={18} />
  +          {lamplightHasConnections && (
  +            <span
  +              data-testid="lamplight-dot"
  +              style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#b8843a' }}
  +            />
  +          )}
  +        </button>
           <button
             aria-label="Search notes"
             onClick={onOpenSearch}
  ```

  3b. `MobileEditorView.tsx` — same treatment. Update import:

  ```diff
  -import { User } from 'lucide-react';
  +import { User, Flame } from 'lucide-react';
  ```

  Add props:

  ```diff
     /** The signed-in user's avatar URL, if they've uploaded one. */
     avatarUrl?: string | null;
  +  /** Opens the Lamplight view (relocated from the bottom bar to the header). */
  +  onOpenLamplight?: () => void;
  +  /** Show the gold connection dot on the flame when Lamplight has neighbors. */
  +  lamplightHasConnections?: boolean;
     /** Whether a note is currently displayed in the editor. */
     hasActiveNote: boolean;
  ```

  ```diff
     onOpenAccount,
     avatarUrl,
  +  onOpenLamplight,
  +  lamplightHasConnections,
     hasActiveNote,
     onNewNote,
   }: MobileEditorViewProps) {
  ```

  Insert the flame as the FIRST child of the right-side cluster (before ThemeToggle):

  ```diff
           <div className="flex items-center gap-1">
  +        <button
  +          aria-label="Lamplight"
  +          onClick={onOpenLamplight}
  +          className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
  +          style={{ color: '#b8843a' }}
  +        >
  +          <Flame size={18} />
  +          {lamplightHasConnections && (
  +            <span
  +              data-testid="lamplight-dot"
  +              style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: '#b8843a' }}
  +            />
  +          )}
  +        </button>
           <ThemeToggle className="w-9 h-9" />
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileNotesView.test.tsx src/components/sections/notepad/mobile/MobileEditorView.test.tsx
  ```

  EXPECT the new Notes tests to PASS and the existing `MobileEditorView.test.tsx` to still PASS (the new Editor props are optional, so existing renders are unaffected).

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/sections/notepad/mobile/MobileNotesView.tsx src/components/sections/notepad/mobile/MobileEditorView.tsx src/components/sections/notepad/mobile/MobileNotesView.test.tsx
  git commit -m "feat(mobile,nav): add a gold Lamplight flame to the Notes/Editor headers

Each top header gains a Flame button (gold #b8843a, aria-label Lamplight)
left of Search, with the connection dot shown when lamplightHasConnections.
This is where Lamplight is reached now that the bottom bar holds Bible.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 11: Change E (part 3) — wire the workspace (Bible branch + header flame + loadEnum)

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`
- Test: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.test.tsx` (extend if it asserts tabs; otherwise rely on the full suite)

**Interfaces:**
- Consumes: `MobileTab` (now with `'bible'`), `BibleStudyPane` props (`{ lamplightAdapter, invoke, streamInvoke }` — confirmed from `MobileMoreSheet` usage and `BibleStudyPaneProps`), `model.invoke` / `model.streamInvoke` / `model.lamplightAdapter` (all present on `useMobileWorkspaceModel`), `MobileTabBar` (no `lamplightHasConnections`), `MobileNotesView`/`MobileEditorView` (new `onOpenLamplight`/`lamplightHasConnections`), `loadEnum`.
- Produces: a working `bible` content branch and the header-triggered `lamplight` view; persisted `bible` tab.

- [ ] **Step 1: Write the failing test** — The existing `MobileNotepadWorkspace.test.tsx` mocks every child view (real `MobileTabBar`, mocked `MobileNotesView`/`MobileEditorView`/`LamplightMobileView`/`MobileMoreSheet`) and renders inside `<MemoryRouter>` via a `renderShell()` helper; views are asserted via `data-testid` markers. Make THREE edits to that file:

  1. Add a `BibleStudyPane` mock alongside the other view mocks (near line 20):

  ```tsx
  vi.mock('@/notepad/bible/BibleStudyPane', () => ({ BibleStudyPane: () => <div data-testid="view-bible" /> }));
  ```

  2. Replace the existing "switches the visible view when a tab is selected" test (it clicks the now-removed `/Lamplight/` tab):

  ```diff
  -  it('switches the visible view when a tab is selected', () => {
  -    const { getByRole, getByTestId } = renderShell();
  -    fireEvent.click(getByRole('tab', { name: /Lamplight/ }));
  -    expect(getByTestId('view-lamplight')).toBeTruthy();
  -  });
  +  it('renders the Bible pane when the Bible tab is selected', () => {
  +    const { getByRole, getByTestId } = renderShell();
  +    fireEvent.click(getByRole('tab', { name: /Bible/ }));
  +    expect(getByTestId('view-bible')).toBeTruthy();
  +  });
  ```

  3. Add a test that the header flame opens the Lamplight view. The `MobileNotesView` mock currently renders `<div data-testid="view-notes" />` and ignores props; upgrade it to expose the `onOpenLamplight` callback as a button so the test can trigger it:

  ```diff
  -vi.mock('./MobileNotesView', () => ({ MobileNotesView: () => <div data-testid="view-notes" /> }));
  +vi.mock('./MobileNotesView', () => ({
  +  MobileNotesView: (p: { onOpenLamplight?: () => void }) => (
  +    <div data-testid="view-notes"><button data-testid="open-lamplight" onClick={p.onOpenLamplight}>flame</button></div>
  +  ),
  +}));
  ```

  ```tsx
  it('opens the Lamplight view from the header flame', () => {
    const { getByTestId } = renderShell();
    fireEvent.click(getByTestId('open-lamplight'));
    expect(getByTestId('view-lamplight')).toBeTruthy();
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileNotepadWorkspace.test.tsx
  ```

  EXPECT FAIL: there is no `bible` content branch yet (`view-bible` never renders) and the workspace still passes a removed prop to `MobileTabBar`. Also run the typecheck to surface the broken `MobileTabBar` prop contract:

  ```bash
  npx tsc -b
  ```

  EXPECT a type error at the `MobileTabBar` usage (line ~213): it no longer accepts `lamplightHasConnections`.

- [ ] **Step 3: Write minimal implementation** — Edit `MobileNotepadWorkspace.tsx`:

  3a. Import `BibleStudyPane`:

  ```diff
   import { LamplightMobileView } from './LamplightMobileView';
  +import { BibleStudyPane } from '@/notepad/bible/BibleStudyPane';
   import { MobileMoreSheet } from './MobileMoreSheet';
  ```

  3b. Allow `'bible'` in the persisted-tab allow-list (line 41):

  ```diff
     const [tab, setTab] = useState<MobileTab>(() =>
  -    loadEnum<MobileTab>(KEY_MOBILE_TAB, ['notes', 'editor', 'lamplight'], 'notes'),
  +    loadEnum<MobileTab>(KEY_MOBILE_TAB, ['notes', 'editor', 'lamplight', 'bible'], 'notes'),
     );
  ```

  3c. Add the `bible` content branch (after the existing `lamplight` branches, before the closing `</div>` of the content area at line 211):

  ```diff
           {effectiveTab === 'lamplight' && !model.lamplightAdapter && (
             <div
               className="flex items-center justify-center h-full text-xs"
               style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}
             >
               Lamplight unavailable — Supabase not configured.
             </div>
           )}
  +        {effectiveTab === 'bible' && (
  +          <BibleStudyPane
  +            lamplightAdapter={model.lamplightAdapter}
  +            invoke={model.invoke}
  +            streamInvoke={model.streamInvoke}
  +          />
  +        )}
         </div>
  ```

  3d. Pass the header flame props into both views and drop `lamplightHasConnections` from the tab bar:

  ```diff
           {effectiveTab === 'notes' && (
             <MobileNotesView
               onExit={() => navigate('/')}
               onOpenSearch={openSearch}
               onNewNote={handleNewNote}
               onScanNote={handleScanNote}
               onUploadFiles={handleUploadFiles}
               onOpenNote={handleOpenNote}
  +            onOpenLamplight={() => setTab('lamplight')}
  +            lamplightHasConnections={hasConnections}
               onOpenAccount={openAccount}
               avatarUrl={profile?.avatarUrl ?? null}
             />
           )}
           {effectiveTab === 'editor' && (
             <MobileEditorView
               onExit={() => navigate('/')}
               onAfterSave={model.onAfterSave}
               onOpenAccount={openAccount}
               avatarUrl={profile?.avatarUrl ?? null}
  +            onOpenLamplight={() => setTab('lamplight')}
  +            lamplightHasConnections={hasConnections}
               hasActiveNote={!!model.activeNote}
               onNewNote={handleNewNote}
             />
           )}
  ```

  ```diff
  -      <MobileTabBar active={effectiveTab} onSelect={handleSelectTab} lamplightHasConnections={hasConnections} />
  +      <MobileTabBar active={effectiveTab} onSelect={handleSelectTab} />
  ```

  Note: `effectiveTab` of `'bible'` and `'lamplight'` both render fine; `effectiveTab` is `MobileTab` and `MobileTabBar` accepts `'bible'`/`'lamplight'` as `active` (it just won't highlight `lamplight`, which is correct — Lamplight is now a header view with no bottom-bar tab). `handleSelectTab` already calls `setTab(next)` for any non-`'more'` tab, so tapping Bible works with no change.

- [ ] **Step 4: Run test to verify it passes + full typecheck**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileNotepadWorkspace.test.tsx
  npx tsc -b
  ```

  EXPECT the workspace test (if added) to PASS, and `tsc -b` to report no NEW errors beyond the known baseline (`force-sphere.test.ts`). Then run the whole mobile suite:

  ```bash
  npx vitest run src/components/sections/notepad/mobile/
  ```

  EXPECT no NEW failures.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.test.tsx
  git commit -m "feat(mobile,nav): wire Bible tab + header-triggered Lamplight (+ test updates)

Render BibleStudyPane for the new 'bible' tab (passing lamplightAdapter,
invoke, streamInvoke from the model); persist 'bible' across refresh; open
the Lamplight view from the header flame via onOpenLamplight; stop passing
lamplightHasConnections to the tab bar (it now feeds the header).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 12: Change E (part 4) — remove the redundant Bible segment from More sheet

**Files:**
- Modify: `src/components/sections/notepad/mobile/MobileMoreSheet.tsx`
- Test: `src/components/sections/notepad/mobile/MobileMoreSheet.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MobileMoreSheet` `Segmented` shows only Backlinks / Info / Graph. The `bible` segment, its `BibleStudyPane` render, and the now-unused `bible` member of `DetailSegment` are removed. `invoke`/`streamInvoke` props stay on `MobileMoreSheetProps` only if still used; since the only consumer was the Bible segment, they become unused — remove them from the component's destructure and the `MobileMoreSheetProps` interface, and drop the now-dead `BibleStudyPane` import. Update the workspace's `<MobileMoreSheet ... invoke streamInvoke />` usage accordingly (Task 11 already touched the file; this trims those two props there too).

  **Judgment note:** the spec says "remove the now-redundant Bible segment" and "verify nothing else depends on that segment." `invoke`/`streamInvoke` on `MobileMoreSheet` were ONLY used by the Bible segment, so removing them is the clean, lint-safe choice (leaving unused props would trip the no-unused baseline). This is a small extra edit to the prop surface, justified by the spec's intent.

- [ ] **Step 1: Write the failing test** — The existing `MobileMoreSheet.test.tsx` mounts via an `open()` helper that passes `lamplightAdapter={null} invoke={vi.fn()}`, mocks `BibleStudyPane` as `data-testid="bible-study"`, and finds segments via `getByRole('button', { name: 'Graph' })`. There is no standalone Bible-segment test to invert, so:

  1. Update the `open()` helper and the closed-render at lines ~45/50 to drop the props this task removes:

  ```diff
  -function open(extra: Partial<{ onClose: () => void; onOpenNote: (id: string) => void }> = {}) {
  -  return render(<MobileMoreSheet open onClose={extra.onClose ?? vi.fn()} onOpenNote={extra.onOpenNote ?? vi.fn()} lamplightAdapter={null} invoke={vi.fn()} />);
  +function open(extra: Partial<{ onClose: () => void; onOpenNote: (id: string) => void }> = {}) {
  +  return render(<MobileMoreSheet open onClose={extra.onClose ?? vi.fn()} onOpenNote={extra.onOpenNote ?? vi.fn()} />);
   }
  ```

  ```diff
  -    const { container } = render(<MobileMoreSheet open={false} onClose={vi.fn()} onOpenNote={vi.fn()} lamplightAdapter={null} invoke={vi.fn()} />);
  +    const { container } = render(<MobileMoreSheet open={false} onClose={vi.fn()} onOpenNote={vi.fn()} />);
  ```

  2. The `BibleStudyPane` mock (line 5) is now unused (the segment is gone); leave it in place — an unused `vi.mock` is harmless — OR delete it for cleanliness. Add an explicit absence test:

  ```tsx
  it('no longer offers a Bible segment (Bible is a first-class tab now)', () => {
    const { queryByRole, queryByTestId, getByTestId } = open();
    expect(queryByRole('button', { name: 'Bible' })).toBeNull();
    expect(queryByTestId('bible-study')).toBeNull();
    expect(getByTestId('backlinks')).toBeTruthy(); // Backlinks / Info / Graph remain
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileMoreSheet.test.tsx
  ```

  EXPECT FAIL on the new absence test: the Bible segment is still rendered, so `queryByRole('button', { name: 'Bible' })` and `queryByTestId('bible-study')` (after clicking it would be reachable) are non-null while the component is unchanged.

- [ ] **Step 3: Write minimal implementation** — Edit `MobileMoreSheet.tsx`:

  3a. Remove the `bible` type member and the dead import:

  ```diff
  -import { GraphPane } from '../GraphPane';
  -import { BibleStudyPane } from '@/notepad/bible/BibleStudyPane';
  +import { GraphPane } from '../GraphPane';
   import type { LamplightAdapter } from '../../../../notepad/storage/lamplight-adapter';
  -import type { InvokeFn } from '@/notepad/bible/lamplight-chat-client';
  -import type { StreamInvoke } from '@/notepad/bible/lamplight-stream-client';
  ```

  ```diff
  -type DetailSegment = 'backlinks' | 'info' | 'graph' | 'bible';
  +type DetailSegment = 'backlinks' | 'info' | 'graph';
  ```

  3b. Trim the props:

  ```diff
   export interface MobileMoreSheetProps {
     open: boolean;
     onClose: () => void;
     onOpenNote: (id: string) => void;
     lamplightAdapter: LamplightAdapter | null;
  -  invoke: InvokeFn;
  -  streamInvoke?: StreamInvoke;
   }

  -export function MobileMoreSheet({ open, onClose, onOpenNote, lamplightAdapter, invoke, streamInvoke }: MobileMoreSheetProps) {
  +export function MobileMoreSheet({ open, onClose, onOpenNote, lamplightAdapter }: MobileMoreSheetProps) {
  ```

  Note: `lamplightAdapter` is still received but, after removing the Bible segment, is no longer read. Check whether `GraphPane`/`NodePeek`/peek logic uses it — from the read file they do NOT. To stay lint-clean, also drop `lamplightAdapter` from the props and the workspace usage. Final `MobileMoreSheetProps` = `{ open, onClose, onOpenNote }`. (If a later reviewer wants to keep `lamplightAdapter` for future use, prefix with `_` — but removing is cleaner.)

  ```diff
   export interface MobileMoreSheetProps {
     open: boolean;
     onClose: () => void;
     onOpenNote: (id: string) => void;
  -  lamplightAdapter: LamplightAdapter | null;
   }

  -export function MobileMoreSheet({ open, onClose, onOpenNote, lamplightAdapter }: MobileMoreSheetProps) {
  +export function MobileMoreSheet({ open, onClose, onOpenNote }: MobileMoreSheetProps) {
  ```

  And drop the now-unused `LamplightAdapter` import:

  ```diff
  -import type { LamplightAdapter } from '../../../../notepad/storage/lamplight-adapter';
   import { NodePeek } from './NodePeek';
  ```

  3c. Remove the Bible option from the `Segmented` list:

  ```diff
             options={[
               { value: 'backlinks', label: 'Backlinks' },
               { value: 'info', label: 'Info' },
               { value: 'graph', label: 'Graph' },
  -            { value: 'bible', label: 'Bible' },
             ]}
  ```

  3d. Remove the Bible segment render block:

  ```diff
  -        {segment === 'bible' && (
  -          <div className="h-full min-h-[60vh]">
  -            <BibleStudyPane lamplightAdapter={lamplightAdapter} invoke={invoke} streamInvoke={streamInvoke} />
  -          </div>
  -        )}
           </div>
  ```

  3e. In `MobileNotepadWorkspace.tsx`, trim the `MobileMoreSheet` usage to match the new prop surface:

  ```diff
         <MobileMoreSheet
           open={moreOpen}
           onClose={() => setMoreOpen(false)}
           onOpenNote={handleOpenNote}
  -        lamplightAdapter={model.lamplightAdapter}
  -        invoke={model.invoke}
  -        streamInvoke={model.streamInvoke}
         />
  ```

- [ ] **Step 4: Run test to verify it passes + typecheck**

  ```bash
  npx vitest run src/components/sections/notepad/mobile/MobileMoreSheet.test.tsx
  npx tsc -b
  ```

  EXPECT the More-sheet test to PASS and `tsc -b` to show no NEW errors (the trimmed props must not leave any caller passing removed props — the workspace usage was updated in 3e). Run the full mobile suite once more:

  ```bash
  npx vitest run src/components/sections/notepad/mobile/
  ```

  EXPECT no NEW failures.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/sections/notepad/mobile/MobileMoreSheet.tsx src/components/sections/notepad/mobile/MobileMoreSheet.test.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx
  git commit -m "refactor(mobile): drop the redundant Bible segment from the More sheet

Bible is a first-class bottom tab now, so the More sheet shows only
Backlinks / Info / Graph. Remove the dead BibleStudyPane render plus the
invoke/streamInvoke/lamplightAdapter props it was the sole consumer of, and
trim the workspace usage to match.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 13: Deploy + full verification (lint, typecheck, suite, manual dark-mode smoke)

**Files:**
- None (verification + manual deploy only)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a verified, deployed feature.

- [ ] **Step 1: Run the full test suite + lint + typecheck and compare to baseline**

  ```bash
  npm run test 2>&1 | tail -40
  npm run lint 2>&1 | tail -20
  npx tsc -b 2>&1 | tail -20
  ```

  EXPECT: the ONLY failing test files are the known baseline (`Editor.toolbar-placement`, `garden-scene`); the ONLY tsc errors are in `force-sphere.test.ts`; lint error count is ≤ the pre-existing ~114 (no NEW lint errors introduced by this branch). If any NEW failure/error appears, fix it before proceeding — do not deploy.

- [ ] **Step 2: Deploy the edge function (MANUAL — not carried by Vercel)**

  ```bash
  supabase functions deploy lamplight-study --use-api
  ```

  EXPECT a successful deploy log for `lamplight-study`. Without this, streamed Study turns 404/fall back to buffered and silently drop the notes offer in the stream path.

- [ ] **Step 3: Manual smoke — mobile viewport + dark mode** (run `npm run dev`, open a mobile viewport, toggle dark mode ON via the header ThemeToggle on a `/notepad/notes` route):

  - **Study Chat (A/B/C):** open Study (`/notepad/notes/study`), Chat tab. Send a message → reply STREAMS in token-by-token with a blinking caret in the indigo-bar Lamplight row; user turn is right-aligned under "You"; typed text in the input is VISIBLE (not invisible) in dark mode. If the network drops mid-stream, the reply still completes via the buffered fallback.
  - **Offered notes over stream:** with a note that touches the passage, confirm the "bring them in?" offer appears after a streamed reply (proves `offered_notes` rode the `done` event).
  - **Nav (E):** bottom bar shows Notes · Editor · **Bible** · More (no Lamplight). Tap Bible → the Bible reader + Lamplight-over-scripture pane opens. The top header (Notes and Editor) shows a gold flame; tapping it opens the Lamplight view; the gold dot appears when connections exist. The More sheet shows only Backlinks / Info / Graph (no Bible). Refresh on the Bible tab → it persists.
  - **Auth logo (D):** open the in-app auth modal in dark mode → logo is light.

  EXPECT all of the above to hold. Record any failures and fix before claiming done.

- [ ] **Step 4: Finalize the branch** — Per `superpowers:finishing-a-development-branch`, present merge/PR options. (No commit in this task unless a smoke fix was needed; if a fix was made, commit it with the standard trailer.)

---

## Spec-coverage check

- Change A (refined-flat) → Task 3.
- Change B (streaming) → Tasks 4 (extraDoneFields), 5 (parse stream), 6 (edge SSE branch), 7 (client), 8 (panel wiring + fallback). Manual deploy → Task 13.
- Change C (dark input) → Task 2.
- Change D (auth logo) → Task 1.
- Change E (nav swap) → Tasks 9 (union + bottom tab), 10 (header flame), 11 (workspace wiring + loadEnum + Bible branch), 12 (More-sheet cleanup).
- Testing/verification (zero-new-errors, `tsc -b`, unit tests, manual smoke) → woven into each task + Task 13.
