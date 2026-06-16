# Domain language

Names for the concepts the codebase keeps re-encountering. Use these terms exactly when discussing architecture; variants ("note service", "notes manager", "notes store") drift the conversation.

When a new concept is introduced or sharpened during design work, it goes here.

---

## Note

A user-authored document with TipTap JSON content, a title, a `folderId`, a `type`, and tags. Lives in a single flat collection under whatever `StorageAdapter` is active.

## Folder

A node in a hierarchy that groups Notes. Has a `parentId` (or `null`/`'root'`), a sibling `order`, optional icon and color. Hierarchy is a tree, not a graph.

## NoteCollection

The deepened module that owns the canonical state of all Notes plus the active selection.

Responsibilities:
- The list of Notes
- `activeNoteId` and the derived `activeNote` (selection points *into* the collection)
- All single-Note mutations (create, update, rename, move, duplicate, delete)
- The selection invariant: deleting the active Note clears `activeNoteId`
- Targeted patching from adapter return values — no full refetch on single-Note mutations
- The `applyReparenting(noteIds, newFolderId)` operation invoked by `NotepadActions` after a folder delete
- The legacy `repairNoteLinks` pass on init

Does **not** own: folders, journal theme, the cross-reference graph, or any awareness of `FolderHierarchy`.

## FolderHierarchy

The deepened module that owns the canonical state of all Folders.

Responsibilities:
- The list of Folders
- All single-Folder mutations (create, rename, delete)
- Sibling-`order` computation on create
- Targeted patching from adapter return values

Does **not** own: any awareness of Notes. `deleteFolder` mutates only the folder; the cross-table re-parenting is `NotepadActions`'s concern.

## NotepadActions

The coordinator module that owns multi-module sequencing. Stateless.

Responsibilities:
- `updateNote(id, updates)` — call `NoteCollection.updateNote`; if `updates.content` was set, call `ReferenceGraph.syncNote` with the updated Note
- `deleteNote(id)` — call `NoteCollection.deleteNote`, then `ReferenceGraph.deleteReferencesFor(id)`
- `deleteFolder(id)` — read affected Note ids from `NoteCollection`, call `FolderHierarchy.deleteFolder`, then `NoteCollection.applyReparenting`
- `importNotes(items)` — bulk create through the adapter, `NoteCollection.refetchAll()`, then `ReferenceGraph.syncAll(currentNotes)`
- `rebindAdapter(newAdapter)` — cascade re-init to all three modules; init runs the repair pass and full sync
- First-load orchestration: `init()` runs `NoteCollection.init` and `FolderHierarchy.init` in parallel, then `ReferenceGraph.repairNoteLinks` against the loaded notes — applying each returned rewire through `NoteCollection.updateNote` so canonical in-memory state stays in sync — then `ReferenceGraph.init`

`NoteCollection`, `FolderHierarchy`, and `ReferenceGraph` do not know each other; cross-module knowledge concentrates here.

## NoteEditor

The deepened module that bridges a TipTap editor instance to `NotepadActions.updateNote` for the active Note. Surfaced as the `useNoteEditor({ activeNote, updateNote })` hook returning `{ editor }`.

Responsibilities:
- TipTap editor instantiation with the `StarterKit`, `Placeholder`, `Underline`, `BibleVerse`, `NoteLink`, and `TagMark` extensions
- Debounced save on every doc change (writes `content` + `tags` via `updateNote`)
- Active-Note swap: load content, focus start, do not emit update
- Cleanup of pending debounce on unmount

Sibling controllers in the same module live next to it:
- `useNoteLinkPopup({ editor, notes, activeNoteId })` — `[[` keydown trigger, popup anchor, search state, filtered candidates, insertion (delegates to `insertNoteLinkAt` exported from `extensions/note-link.ts`).
- `useVerseTooltip({ graph })` — hover detection over `[data-bible-verse]`, race-fenced verse resolution that **reads** from `ReferenceGraph.getScriptureNode` first and falls back to the network. Does not write the cache on miss; that path is reserved for `ReferenceGraph.syncNote`.

Does **not** own: toolbar, note-link click-through, or the journal-theme picker. Those are view concerns and stay in the consuming component. The `<input>` Enter/Escape handling on the popup also stays inline with the input element.

Tag extraction currently uses the `#\w+` regex on plain text (preserved from the prior inline implementation). Aligning this with the `tagMark` extension is intentionally out of scope for the deepening; it is filed as a future candidate.

## FolderTreeView

The deepened module that prepares `(Notes, Folders, filterText, tagFilter)` into the indexed shape the sidebar renders. Surfaced as `buildFolderTreeView(notes, folders, filterText, tagFilter)` returning `{ rootFolders, rootNotesByType, notesByFolder, childFoldersByParent, allTags }`.

Load-bearing invariants pinned in tests:

- **Orphan rule.** A Note whose `folderId` is `'root'` OR points at a folder that does not exist is treated as a root Note. This is preserved verbatim from the prior inline implementation; it lets the sidebar continue to render Notes whose folder was deleted out from under them without dropping them on the floor.
- Folders sort by `order` ascending, both at the root and within each parent bucket.
- Tag counts (`allTags`) are computed from ALL Notes, not the filtered subset, so the active tag pivot stays visible and clickable when applied.
- Empty `NoteType` buckets are dropped from `rootNotesByType`. Iteration order is `NOTE_TYPE_ORDER` (`devotion`, `sermon`, `theme`).

Sibling sub-components live next to it under `src/notepad/sidebar/`: `InlineEdit`, `MoveToFolderDialog`, `NewNoteDialog`, `NoteItem`, `FolderItem`, plus the small `NOTE_TYPE_CONFIG` lookup. `src/notepad/components/Sidebar.tsx` is now the shell that consumes `buildFolderTreeView` and mounts these.

Does **not** own: drag-and-drop reordering (none today; Move-to-Folder is dialog-driven) or selection invariants (those live in `NoteCollection`). Tree expand/collapse state is owned by `TreeViewState`, scoped to the sidebar tree.

## TreeViewState

The deepened module that holds expand/collapse state for the sidebar tree, replacing three previously-scattered state holders (top-level `tagsExpanded`, top-level `typeGroupsExpanded` record, and per-`FolderItem` local `useState`). Surfaced as `<TreeViewStateProvider>` mounted by `NotepadSidebar`, with `useTreeViewState()` returning `{ isExpanded(key, default), toggle(key, default) }`.

Underlying state is a sparse `Record<string, boolean>` of OVERRIDES only — keys absent from the record fall back to the per-call default. Folders never explicitly toggled don't appear in state, and a folder mounting/unmounting during search-filter changes doesn't clear its open state.

Key conventions:

- `folder:${folderId}` — each Folder row, default `true`.
- `type:${noteType}` — each NoteType group at root, default `true`.
- `tags` — the tags section at the bottom, default `false`.

Overrides are persisted to `localStorage` under `notepad_tree_view_overrides`, so expanded folders, type groups, and the tags section survive a page refresh. Defensive: malformed JSON, non-boolean values, missing storage, and quota errors all degrade to "ignore and continue." Storage helpers accept a `Pick<Storage, 'getItem' | 'setItem'>` so they're testable without a DOM (mirrors the `ReferenceGraph` cache pattern).

Does **not** own: filter text, tag filter pivot, or any data; only the boolean tree-view state. The state lives at the `NotepadSidebar` level — it is not pushed up into `NotepadProvider` because no other surface consumes it.

## StorageAdapter

The seam between persistence and the domain modules. Two real adapters today: `LocalStorageAdapter` (offline) and `SupabaseStorageAdapter` (cloud). The seam is real because two adapters exist; do not collapse it.

## AdapterMigration

The deepened module that copies every Folder and Note from one `StorageAdapter` to another, preserving ids and timestamps so embedded `noteLink` marks and `folderId` references keep resolving after the move. Surfaced as `migrateAdapter(source, target, { onEvent? })` returning `{ folders, notes }`.

Pure copy — does **not** mutate the source. Source-side cleanup (e.g., `LocalStorageAdapter.clearAll()` after migrating to Supabase) is the caller's concern; per-adapter cleanup methods encapsulate the storage keys.

Folders are imported before Notes so each Note's `folderId` reference resolves at the destination at write time. Note ids are preserved so embedded `noteLink` marks keep resolving — otherwise every cross-Note edge in the graph would break after migration.

## MigrationWorkflow

The deepened module that owns the multi-phase orchestration around `migrateAdapter` — the stateful coordinator that the pure `AdapterMigration` module's "caller's concern" is referring to. Surfaced as the `useMigrationWorkflow({ source, target, onMigrationComplete, onClose })` hook returning `{ state, start, dismissError }`. Mounted by `MigrationDialog`.

Seven-state status machine:

```
idle ──(start)──> loading ──> folders(c,t) ──> notes(c,t) ──> cleanup ──> done(folders,notes)
                                                                              │
                                                                  (TIMELINE.celebratoryPause)
                                                                              ▼
                                                                            idle  (fires onClose)

(any step) ──(throw)──> error(message)
                            │
                            ├──(start)──────────> loading (retry)
                            └──(dismissError)───> idle  (fires onClose)
```

Class responsibilities:

- The seven-state status (idle / loading / folders / notes / cleanup / done / error) and the per-status payload (progress counts on folders/notes, result counts on done, message on error)
- `start()` — `idle | error → loading`; runs the migrate→clearSource→onMigrationComplete→done sequence; schedules the celebratory close timer
- `dismissError()` — `error → idle`; fires `onClose`
- `dispose()` — clears any pending celebratory timer (called on hook unmount); guards against the stale-fire race
- Guarded transitions: `start` no-ops from any in-progress status; mid-migration progress events from `migrateAdapter` flow through a private `setPhaseFromEvent` translator
- Side-effect orchestration via injected `MigrationWorkflowDeps`: `migrate`, `clearSource`, `toastSuccess`, `toastError`, `setTimer`, `clearTimer`, `onMigrationComplete`, `onClose`. Pure-state-and-deps, testable in node — fakes substitute for the storage adapters, toast, and timers at test time.

Owns the timeline as `MIGRATION_TIMELINE`: `celebratoryPauseMs` (default 1400). Single source of truth for the dialog's pause-then-close timing.

Composes with `AdapterMigration`: `start()` calls `deps.migrate(source, target, { onEvent })`, translating each `MigrationEvent` into a status mutation. The result `{ folders, notes }` flows into the `done` payload so the toast message ("1 note imported" vs "N notes imported") is computed inside the workflow, not the dialog.

Does **not** own: the dialog's `open` prop, the source-side `noteCount` shown on the intro panel (one-shot fetch, lives in the dialog's `useEffect`), the JSX panels themselves (intro / in-progress / error), or the in-progress click-outside guard (`open && !inProgress` is a view concern reading `state.status` from the workflow).

The fallback error message ("Something went wrong importing your notes. Your local copy was left untouched.") lives in the workflow, not the dialog — it is part of the lifecycle's contract that source data is preserved on failure.

## DocumentImporter

The module that turns uploaded files into full `Note` records, ready for `adapter.importNote` (id-preserving). Three exports:

- `parseFile(file)` — async, format-aware (`.md`, `.txt`, `.pdf`, `.docx`). DOM-coupled; `pdfjs-dist` and `mammoth` are dynamically imported. Not unit-tested.
- `buildNoteFromText({ title, text, folderId, type?, autoDetectVerses? })` — sync, pure. Generates a client-side `id` (`uuidv4`), `createdAt`/`updatedAt`, `wordCount`. Splits paragraphs on `\n\n+`, wraps each in a TipTap `paragraph` node. Optionally seeds tags from verse references (capped at 10).
- `linkNotesByVerses(notes)` — sync, pure. Optional cross-link pass that appends a "Related Notes" section pointing at each peer that shares at least one verse reference, using real `noteLink` marks. Because the ids exist before this pass runs, the inserted marks become genuine Reference edges in `ReferenceGraph` after `syncAll` — i.e. proper Backlinks.

The upload path uses `NotepadActions.importNotes(notes: Note[])`, which preserves ids via `adapter.importNote`. The id-preserving contract is what makes `linkNotesByVerses` work: the cross-link marks reference peers by their final ids, so `ReferenceGraph.syncNote` recognizes them as `explicit` References and they appear as Backlinks per §Backlink.

## tiptap-text

The canonical TipTap-text-extraction utility, lifted out of five inline copies that had drifted across the codebase (`word-count.ts`, `reference-parser.ts`, `SearchDialog.tsx`, `InfoPanel.tsx`, `document-importer.ts`). Lives at `src/notepad/utils/tiptap-text.ts`.

Three exports:

- `extractPlainText(node)` — recursive walker over a parsed TipTap JSON tree. Defensive on `unknown` input: returns `''` for non-objects. Joins child text on a single space.
- `extractTextFromNote(note)` — `extractPlainText(JSON.parse(note.content))` with a try/catch fallback to the raw `note.content` string for non-JSON. The shape `document-importer.ts` already exposed; promoted here so every caller goes through the same path.
- `countWordsFromTipTapJSON(jsonString)` — preserved from the original `word-count.ts`. Implementation now reuses `extractPlainText`.

The five previous copies had minor drift — `InfoPanel.tsx`'s version was missing the `type === 'text'` gate (theoretically buggy on TipTap docs with stray `text` fields on non-text nodes; in practice harmless on valid docs). The canonical version uses the gate; the migration is effectively a defensive bug fix.

Does **not** own: verse extraction (that's `extractVerseRefs` in `bible-verse-utils`), tag parsing (that's `tags.ts`), or any TipTap *editor* coupling — these are pure utilities operating on parsed JSON.

## SearchIndex

The deepened module that builds the deduped verse-and-tag index `SearchDialog` renders. Surfaced as `buildSearchIndex(notes): { verses, tags }`, each entry shaped `{ <key>, noteId, noteTitle }`.

Responsibilities:

- For each Note: extract plain text via `extractTextFromNote` (§tiptap-text), then run `extractVerseRefs` over the result.
- Dedup verses by ref string, **first-occurrence-wins**: the first Note in `notes` order containing a given verse owns the entry. Same dedup logic for tags, reading from `note.tags` directly (tags are pre-stored on the Note, not parsed from content).
- Pure of React, DOM, and persistence; tested in node.

Does **not** own: the cmdk command-palette UI (lives in `SearchDialog`), the keyboard shortcut binding (`useEffect` listener in the dialog), or full-text note search (the dialog leans on cmdk's substring-on-`value` matching for the Notes group).

## dominant-color

The deepened pure module that owns the dominant-color extraction algorithm previously buried inside `extractDominantColor`'s canvas `onload` handler. Lives at `src/utils/dominant-color.ts`.

One public export:

- `dominantColorFromPixels(pixels: Uint8ClampedArray): string` — takes an RGBA pixel buffer (any size; algorithm walks `pixels.length / 4` pixels), returns a muted overlay-friendly hex color.

Algorithm steps (preserved from the original):

1. Walk every pixel, skip transparent (alpha < 128), too-dark/too-bright (brightness < 25 or > 230), and near-grey (HSL saturation < 0.08).
2. Quantise the survivors into 32-step RGB buckets; track count and running RGB sum per bucket.
3. If the filtered pass produced no buckets, do a second pass over **every** opaque pixel (skipping only the alpha gate) — this is the "fully grey image" rescue.
4. Pick the bucket with the highest count (initial `best` is the algorithm's neutral starting RGB, hardcoded to `(0x8B, 0x83, 0x78)` — not to be confused with `FALLBACK_OVERLAY_COLOR`, which is the project-data fallback used by the DOM wrapper for image-load failures).
5. Average the real RGB values inside that bucket.
6. Mute via HSL: saturation × 0.45, lightness blended toward 0.45 (`l × 0.55 + 0.45 × 0.45`).

Internal helpers (`rgbToHsl`, `hslToRgb`, `toHex`) stay private to the module — they are algorithm support, not a public color-math API.

`extractDominantColor` is now a thin DOM wrapper around this: load `Image`, draw to a 50×50 canvas, `getImageData`, hand the buffer to `dominantColorFromPixels`. Image-load failures and missing canvas context resolve to `FALLBACK_OVERLAY_COLOR` directly without calling the algorithm.

Pure of DOM, canvas, and React. Tested in node by constructing synthetic `Uint8ClampedArray` pixel buffers — the previous embedded algorithm had zero test coverage despite four magic numbers and a two-pass fallback structure.

## Reference

A directed link from one Note to another (`explicit`, authored as a `noteLink` TipTap mark), from a Note to a scripture passage (`scripture-reference`, detected via verse regex in the Note's plain text), or from one scripture passage to another (`cross-reference`, derived from a bundled TSK dataset). The umbrella term is **Reference**; **cross-reference** is reserved for the scripture↔scripture kind.

## Backlink

A Note that has an inbound `explicit` Reference to the active Note — i.e. it contains an authored `noteLink` mark targeting the active Note's id. Served by `ReferenceGraph.getReferencesBy({ target: activeNoteId })` filtered to `type === 'explicit'`.

Title-substring mentions (a Note whose plain text happens to contain the active Note's title) are **not** Backlinks. They were considered and rejected: false positives are easy (any Note about "forgiveness" matches a Note titled "Forgiveness"), the heuristic doesn't survive title renames, and treating them as Backlinks creates a silent disagreement with the graph view where the same Notes are not connected. If a "soft mention" feature is ever wanted, it is a separate concept with separate UI.

## ScriptureNode

A persistent record for a scripture passage referenced by at least one Note. Holds the canonical id (`scripture:{book}-{chapter}-{verse}`), parsed location, translation, and cached verse text from the Bible API. Created lazily as References are detected.

## ReferenceGraph

The deepened module that owns the canonical state of all References plus the ScriptureNode cache.

Responsibilities:
- The list of References (note→note, note→scripture, scripture→scripture)
- The ScriptureNode cache (verse text fetched lazily, best-effort)
- Per-Note sync: parse a Note's TipTap content, write its outgoing References, create any missing ScriptureNodes, expand TSK cross-references for new scripture nodes
- TSK dataset loading and scripture↔scripture expansion
- The legacy `repairNoteLinks` pass (orphan-by-title rewiring of `noteLink` marks). Returns `{ rewires, rewiredLinks, orphans }` — pure, no I/O. Caller (`NotepadActions`) persists each rewire through `NoteCollection`.
- Neighborhood queries (`getNeighborhood(nodeId, depth)`)
- Targeted patching from sync — no full rebuild on per-Note sync
- `reset()` — clears state to empty; called from `NotepadActions.rebindAdapter` cascade. Does not take an adapter; `ReferenceGraph` has no adapter coupling.
- Exporting the verse regex, book patterns, canonical-id helpers, and parser for TipTap marks to import

Does **not** own: visualization shape (`GraphNode`/`GraphEdge` for `GraphPane` belong to the view layer), TipTap mark rendering (marks stay in `src/notepad/extensions/` and import from this module), the `StorageAdapter` (graph is pure of persistence — note mutations from `repairNoteLinks` flow back through `NoteCollection`), or any awareness of `NoteCollection` or `FolderHierarchy`.

The localStorage keys (`notepad_graph_references`, `notepad_scripture_nodes`) are a **derivation cache**, not a source of truth. Source of truth is Note content + the bundled TSK dataset + the Bible API. Deleting the cache and re-running sync rebuilds the same state. Cross-device sync is intentionally out of scope.

## projectGraph

The pure function that turns `(Note[], Reference[], ScriptureNode[])` into `{ nodes: GraphNode[], edges: GraphEdge[] }` for `GraphView`. Owns three load-bearing rules:

- Edge weights are summed per node id (both endpoints accumulate).
- A `ScriptureNode` is emitted only if it participates in at least one edge — verses fetched lazily during `ReferenceGraph.syncNote` but never actually referenced from a Note are omitted from the view.
- Reference type strings (`'scripture-reference'`, `'cross-reference'`, `'explicit'`) are mapped to view-side edge types (`'scripture_reference'`, `'cross_reference'`, `'explicit'`).

Lives next to `reference-graph.ts` because the rules are about References, not layout. The previous `useGraph` hook collapses to a thin `useMemo` around this function, or is dropped entirely if the shell prefers to project inline.

## NoteStats

The pure function that derives one Note's connection counts from `Reference[]`, for `InfoPanel`. Surfaced as `buildNoteStats(noteId, references): NoteStats` returning `{ backlinkCount, outgoingLinkCount, verseCount }`. Lives next to `project-graph.ts` because the rules are about References, not the panel.

- `backlinkCount` — distinct Notes with an inbound `explicit` Reference targeting this Note (the §Backlink definition; replaces the rejected title-substring heuristic that had survived inline in `InfoPanel`).
- `outgoingLinkCount` — distinct Notes this Note explicitly links to.
- `verseCount` — distinct scripture passages this Note references (`scripture-reference` References). Counts canonical passages, not text occurrences: "John 3:16" written five times, or once as "Jn 3:16", is one.

Load-bearing invariants:

- **Distinctness is inherited, not re-derived.** `parseReferences` dedupes per `(type, target)` before edges enter the graph, so each qualifying Reference row counts once. `buildNoteStats` counts rows; uniqueness is the parser's documented contract.
- **Self-references (`source === target`) are excluded** from every count — a Note is not its own Backlink.
- **Trusts the graph on referential integrity.** Does not take `notes[]` to verify a backlink's source Note still exists; `deleteReferencesFor` owns that invariant.

Scoped deliberately to graph-derived counts so it doesn't drift into "all note metadata." Does **not** own: word count (§tiptap-text), folder name, type labels, or date formatting — those are view concerns that stay in `InfoPanel`.

## GraphView

The deepened module that owns the d3-force simulation, canvas rendering, and pointer interaction for the knowledge graph. Surfaced as a `GraphView` class extending `Observable<GraphViewState>`, instantiated by `GraphPane` and attached to a canvas element. `GraphPane` becomes the view shell: controls panel, canvas + popover-overlay markup, and `useEffect`-bound forwarders to `view.setData`, `view.setMode`, `view.setFilters`, `view.setSettings`.

Responsibilities:

- d3-force simulation lifecycle (rebuild on data / mode / filter changes, preserve `(x, y)` of surviving node ids across rebuilds)
- Canvas drawing of edges, nodes, labels, and the active-node glow ring
- Pan/zoom transform — internal, mutated by pointer/wheel handlers without React rerenders
- Pointer handling: hover detection, drag-vs-click discrimination, wheel zoom anchored at cursor
- Scripture popover state on the observable snapshot. Rendered by the shell as a positioned DOM element over the canvas, not via `ctx.fillText` — the previous in-canvas `drawPopover` is removed
- Auto-fit camera once at tick 80
- `ResizeObserver` coupling (canvas DPR sizing + sim recenter)

Construction takes `GraphViewDeps`: `onNodeOpen(noteId)` is the sole outbound callback (what to do on a non-scripture node click is the shell's concern). Optional `now()` and `devicePixelRatio()` deps make tick counting and DPR injectable for tests.

Pure of React, persistence, and `NoteCollection` knowledge. Consumes `GraphNode[] / GraphEdge[]` produced by `projectGraph`; knows nothing about `Reference` shapes. Tested in node with a `MockCanvasContext` (recorder of draw calls) and a `MockResizeObserver`, mirroring the `RouteTransition` testing pattern.

`GraphPane` (the view shell) keeps mode/filter/settings React state because those are bound to form inputs; on every change it forwards the new value to the matching `setX` method. Position preservation is `GraphView`'s concern, not the shell's — the shell can rerender without losing dragged positions.

## AuthSession

The deepened module that owns user identity for the active session. Surfaced as the `useAuthSession()` hook returning `{ user, loading, adapter, session }` — methods (`signUp`, `signIn`, `signInWithGoogle`, `signInWithApple`, `signOut`) are called on `session`, mirroring the `useNoteCollection().collection` pattern. Mounted by `<AuthProvider>`, which wires `AuthSession`, `AccountProfile`, and `AccountActions` together (mirroring how `<NotepadProvider>` wires the notepad-domain classes).

Responsibilities:
- The Supabase `User` (or `null`) and the auth subscription lifecycle
- `loading`: session-level loading only — `false` once `getSession()` resolves, regardless of profile state
- The active `StorageAdapter`: the `localAdapter` singleton from `local-storage.ts` when no user, a `SupabaseStorageAdapter` memoized on `user.id` when signed in
- Sign-up, password sign-in, Google/Apple OAuth, sign-out, password reset (link → `/update-password`), and password update
- OAuth callback URL stripping (the once-on-first-mount `window.history.replaceState`)

Does **not** own: profile data, account-deletion sequencing, or online/offline detection.

The `adapter` field is derived state, not separately managed: a fresh `SupabaseStorageAdapter` is constructed when `user.id` changes, and `signOut` resets it to `localAdapter`. `NotepadProvider` consumes it as a prop and calls `NotepadActions.rebindAdapter` when it changes; that pipe is unchanged from before the deepening.

## ProfileStatus

A four-state value indicating the lifecycle of `AccountProfile`'s fetch for the current user:
- `'loading'` — fetch in flight (initial or after `refreshProfile`)
- `'loaded'` — profile row was returned and is non-null
- `'missing'` — fetch resolved with no row (e.g. signed-in user without a profile row yet)
- `'error'` — fetch threw; `profile` is `null` and the error was swallowed

Distinguished from `AuthSession.loading`: that flag covers session resolution; `profileStatus` covers profile resolution. They move independently. Consumers that need the distinction read `profileStatus`; consumers that just need "is there a profile?" can keep checking `profile !== null`.

## AccountProfile

The deepened module that owns the active user's profile. Surfaced as the `useAccountProfile()` hook returning `{ profile, profileStatus, account }` — methods (`updateProfile`, `refreshProfile`, `uploadAvatar`) are called on `account`. Mounted via `<AuthProvider>`.

Responsibilities:
- The `UserProfile` (or `null`) for the current user
- `profileStatus: ProfileStatus` — explicit state machine for the profile fetch
- The snake_case ↔ camelCase mapping for the `profiles` table — concentrated here, not duplicated at callsites
- Profile field updates (`fullName`, `dateOfBirth`, `avatarUrl`) and `refreshProfile`
- Avatar upload to Supabase Storage and write-back to the profile row

Does **not** own: identity, sign-in/out, or account-level multi-step operations like deletion.

Fetch fires when `AuthSession.user` changes and intentionally does **not** gate `AuthSession.loading`. A slow or failed profile fetch leaves the rest of the UI usable.

## AccountActions

The coordinator module that owns multi-module sequencing for account-level operations. Stateless. Surfaced as `useAccountActions()` returning `{ deleteAccount }`, composing `useAuthSession()` and `useAccountProfile()` internally.

Responsibilities:
- `deleteAccount()` — remove avatar files from Supabase Storage, delete the profile row (cascades to notes/folders via FK), then `signOut`. The adapter resets to `localAdapter` automatically because `AuthSession` derives it from `user`.
- `exportData()` — read all Notes and Folders from the active `StorageAdapter` for download as JSON. Adapter-level rather than in-memory because the only consumer is `ProfilePage`, which lives outside `<NotepadProvider>` and therefore has no in-memory `NoteCollection` to read from.

`AuthSession` and `AccountProfile` do not know each other; cross-module knowledge concentrates here.

## UsernameAvailability

The deepened controller that owns the live availability machine for the username picker — `idle → checking → available | taken | error` — including the 300ms debounce and the stale-response fence. Follows the **`ConnectionDiscovery`** precedent (an `Observable<AvailabilityStatus>` class driven by `setInputs` forwarders from a thin hook), one layer smaller. Surfaced as `useUsernameAvailability({ checkAvailable, name, eligible, debounceMs })` returning `{ status, markTaken }`.

Owns:
- The availability state machine; `status` is the single source of truth for whether a name reads as free.
- **Debounce.** `setInputs` schedules the `checkAvailable` call via an injected `setTimer(fn, ms) => cancel` (default: real `setTimeout`); a newer input cancels the pending timer before it fires, so a fast typist never triggers a check for an abandoned prefix.
- **Generation-fencing.** `setInputs`, `markTaken`, and `dispose` all bump a generation counter; a `checkAvailable` that resolves or rejects after the input changed is dropped. This is the load-bearing complexity — rapid input must drop late-arriving responses — and it was previously reachable only through the React harness in `UsernameSetup.test.tsx`.
- **`markTaken()`** — the submit-time reconciliation: when `claim` loses the unique-constraint race (`reason: 'taken'`), the component calls this to force the machine to `taken`. Concentrates every path into `taken` behind one seam; cancels any in-flight check so it cannot overwrite the verdict.

Fails open: a rejected `checkAvailable` lands in `error`, which does **not** block submit — the `profiles` unique constraint at claim time is the real guard.

Does **not** own: format validation (`username-rules`), the `canSubmit` composition (mixes in `format.valid` + `submitting`, a view concern that stays in `UsernameSetup`), or the `claim` call and its `onClaimed` / `submitError` handling. The thin `useUsernameAvailability` hook owns the React coupling the controller is pure of — it captures `checkAvailable` via a ref so an unstable inline prop doesn't recreate the controller, binds the snapshot via `useSyncExternalStore`, and disposes on unmount. Mirrors how `useConnectionDiscovery` wraps `ConnectionDiscovery`.

## RouteTransition

The deepened module that owns the state machine and side-effect orchestration for cross-route page transitions (the `SplitTransition` overlay flow). Surfaced as the `useRouteTransition(projects)` hook returning `{ status, color, transition }`. The hook also internally mounts the popstate-driven back-button interception on `/purpose/:id` detail pages and the belt-and-suspenders scroll restore in a `useLayoutEffect` on pathname change.

Status is a four-state machine:

```
idle ──(beginNavigation)──> expanding ──(completePhase)──> revealing ──(completePhase)──> idle
idle ──(beginExit)─────────> exiting ──(completeExit)────> expanding (then as above)
```

`exiting` exists only on the back-from-detail flow: `PurposeDetail` plays its text-fade animation while the overlay is still hidden, then calls `completeExit('/')` to start the overlay.

Class responsibilities:

- The four-state status, current `color`, and (private) `pendingTarget`, `isBackNav`, `savedScrollY`
- Phase transitions including double-click defense (`beginNavigation` / `beginExit` no-op when not idle) and double-popstate defense
- Side-effect orchestration via injected `RouteTransitionDeps`: `navigate`, `killScrollTriggers`, `setBodyOverflow`, `scrollWindow`, `getScrollY`. The class is pure-state-and-deps, testable in node — fakes substitute for DOM, GSAP, and react-router at test time.
- Scroll restoration on back nav (restore saved Y) versus forward nav (scroll to 0), both inside the `expanding → revealing` boundary and as a backstop in `handleLocationChanged()`.

Does **not** own: the popstate listener itself, `history.pushState` for the back-button trap, or knowledge of which paths are detail pages. Those live in `useRouteTransition` because they are window-event coupling.

The status value is a four-state superset of `SplitTransition`'s three-state `phase` prop. App-level rendering maps `'exiting' → SplitTransition is hidden` and the other three pass through directly.

## PurposeDetailReveal

The deepened module that owns the entry + exit reveal lifecycle for the purpose detail page. Surfaced as the `useDetailReveal({ project, exiting, onExitComplete })` hook returning `{ isVisible, textReady, contentRef, imageRef }`. Mounted by `PurposeDetail`.

Five-state status machine:

```
idle ──(start)──> entering ──(textReadyTimer @ TIMELINE.textReadyAt)──> revealed
                     │                                                     │
                     └──────────────(requestExit)─────────────────────────-┤
                                                                           ▼
                                                                        exiting
                                                                           │
                                                              (TIMELINE.exitCompleteAt)
                                                                           ▼
                                                                        exited  (fires onExitComplete)
```

Class responsibilities:

- The five-state status and the derived `isVisible` / `textReady` booleans the JSX consumes
- `start()` — `idle → entering`; schedules the text-ready timer
- `reset()` — for project change; cancels any pending timer and re-enters
- `requestExit()` — `entering | revealed → exiting`; calls `applyExitStyles` for `'content'` and `'image'` with the styles from `DETAIL_REVEAL_TIMELINE`; schedules the exit-complete timer that fires `onExitComplete` and transitions to `exited`
- `dispose()` — clears any pending timers (called on hook unmount)
- Guarded transitions: each method no-ops from the wrong status, mirroring `RouteTransition.beginNavigation` / `beginExit` defense
- Side-effect orchestration via injected `DetailRevealDeps`: `applyExitStyles`, `setTimer`, `clearTimer`, `onExitComplete`. The class is pure-state-and-deps, testable in node — fakes substitute for DOM mutation and timers at test time.

Owns the timeline as `DETAIL_REVEAL_TIMELINE` exported from the module: `textReadyAt`, `exitCompleteAt`, `easing`, and the `contentExit` / `imageExit` style objects. JSX imports the easing string for the inline `<h1>` / small-text transitions.

Composes with `RouteTransition`: `RouteTransition.beginExit()` flows down as the `exiting` prop, the controller plays the fade, then `onExitComplete` (= `RouteTransition.completeExit`) hands back. The two halves of the back-from-detail handshake.

Does **not** own: scroll reset on project change (stays a `useLayoutEffect` in `PurposeDetail` because it is layout-effect-coupled), per-reveal animation durations on `<LineMaskReveal>` / `<ImageReveal>` (those are aesthetic, not lifecycle), or the Restoration1/3-vs-standard layout branching (pure JSX).

## NotepadFirstLoad

The deepened module that owns the three first-load decisions fired when a signed-in user lands on `/notepad`: welcome redirect, daily greeting, and local-notes migration prompt. Surfaced as the `useNotepadFirstLoad()` hook returning `{ showMigration, dismissMigration }`. Mounted by `NotepadWorkspace`.

Unlike the other deepened modules in this file, this one is **not a state machine** — there are no timers, no async sequencing, no observable status to react to. The shape is a pure decision module:

```ts
decideFirstLoadActions({
  user, authLoading,
  hasBeenWelcomed, hasBeenGreetedToday, localNoteCount
}): FirstLoadAction[]

// FirstLoadAction =
//   | { kind: 'redirect-welcome' }
//   | { kind: 'greet'; firstName: string }
//   | { kind: 'offer-migration' }
```

The hook coordinates the storage reads (sync localStorage / sessionStorage; async `localAdapter.getNotes()`), invokes the decision, and dispatches each returned action to its side-effect target (`navigate`, `toast`, `setShowMigration`).

Module responsibilities:

- `decideFirstLoadActions(input)` — pure rule evaluation. Empty list when `authLoading || !user`. Returns `redirect-welcome` first when `!hasBeenWelcomed` (and short-circuits the greet decision); always evaluates the migration decision independently. `greet` carries the resolved `firstName` so the toast string is computed inside the decision, not at the call site.
- `firstNameOf(user)` — pure name extraction with the canonical fallback chain: `user_metadata.full_name` first word → email local-part → `'friend'`.
- `welcomedKey(userId)` and `greetedKey(userId, today)` — single source of truth for the storage key formats. Previously templated inline in two places (`WelcomePage` writer, `Notepad` reader); both now import from here.
- `hasBeenWelcomed` / `markWelcomed` and `hasBeenGreetedToday` / `markGreetedToday` — sync read/write helpers taking `Pick<Storage, 'getItem' | 'setItem'>` so they're testable without a DOM (mirrors the `TreeViewState` and `ReferenceGraph` cache pattern).
- `todayDateString(now)` — pure thin wrapper over `Date.toDateString()`, parameterized for fake-clock tests.

Hook responsibilities:

- Owns the `showMigration` boolean previously held in `NotepadWorkspace`
- Reads the local note count via `localAdapter.getNotes()` (async). The previous direct `localStorage.getItem('notepad_notes')` read leaked the storage key past `LocalStorageAdapter`'s seam — that leak is closed.
- Dispatches each `FirstLoadAction` in order:
  - `redirect-welcome` → `navigate('/welcome')`
  - `greet` → `markGreetedToday(...)` then `toast.success('Welcome back, {firstName}!')` (write-marker-then-toast order matches the original)
  - `offer-migration` → `setShowMigration(true)`
- Returns `{ showMigration, dismissMigration }` to the consumer; the migration dialog's `onClose` wires to `dismissMigration`.

Does **not** own: identity (that's `AuthSession`), the migration workflow itself (that's `MigrationWorkflow`), or the WelcomePage UI flow (the page calls `markWelcomed` directly when the user submits the form).

## DevotionMoodBoard

The data model that describes one devotion's moodboard as a `DevotionMoodBoard`. **All 11 devotions are now migrated** — the hand-written `*Zones` / `*Mobile` functions are deleted from `MoodBoard.tsx`, which renders every devotion from these data objects. The model and node-testable helpers live in `src/data/devotion-moodboards/_shared.ts`; each devotion is **one file per board** (`peace.tsx`, `hope.tsx`, `strength.tsx`, `wholeness.tsx`, `purpose.tsx`, `connection.tsx`, `identity.tsx`, `joy.tsx`, `forgiveness.tsx`, `surrender.tsx`, `trust.tsx`) carrying its own prose constants; and `src/data/devotion-moodboards.tsx` is a **thin barrel** that re-exports `_shared` and assembles the 11 boards into `moodBoards: Record<string, DevotionMoodBoard>`. The import path `@/data/devotion-moodboards` is unchanged. Boards are keyed by `Project.id` and lean on `devotions.ts` for shared metadata (they do not restate `title`/`scriptureRef`).

A board carries **two independent arrangements, not one** (the load-bearing decision): a desktop `sections: DesktopSection[]` and a separate `mobile: MobileSection[]`. They do **not** share section membership — Peace desktop puts "quiet waters" in the `principle` zone while mobile puts it in the `scripture` section — so they cannot be one list walked twice. What they share is **prose**: `SectionText = { full: ReactNode; mobile? }` constants, authored once and referenced from both arrangements. `mobile` carries **intentionally condensed copy** (shorter by design, not drift) and defaults to `full` when omitted. Body text is `ReactNode` so inline markup (`<em>shub</em>`, entities) authors naturally in the `.tsx`.

The desktop `sections` are the assertable spine: `board.sections.map(s => s.role)` equals `CANONICAL_ROLE_ARC` (`title` → `opening` → `scripture` → `principle` → `application` → `prayer`), verified by test. A `DesktopSection` is `{ role, width, bg?: BlendRecipe, elements }`; a `MobileSection` is `{ role | 'gallery', className, bg?: BlendRecipe | 'base', elements }`.

The geometry is **art-directed and preserved verbatim as data, not normalized**. Each element is a tagged node (`{ kind: 'image' | 'text' | 'divider', … }`) that carries its **exact class/style tokens as strings** — a desktop image holds its `pos` (`top-[10%] left-[5%] w-[42vw] h-[78vh]`) and any `style`; a text node holds its full `className` (`font-['Cormorant_Garamond'] italic … text-white/70`) and `tag` (`h2`/`h3`/`p`/`div`). This verbatim-token approach is **required**, not stylistic: the GSAP engine sniffs exact class tokens (`text-sm`, `text-white`, `mb-text`, the `w-[45vw]`/`w-[35vw]`/`w-[50vw]`/`w-[40vw]` scale-effect set), so byte-identical classes are the only way to guarantee zero animation change. The win is node-testability + one grammar, **not** line reduction or style derivation.

`BlendRecipe` concentrates the `color-mix(in srgb, ${overlay} N%, …)` background formula: `{ mix, toward: 'app-bg' }` or `{ mix, toward: 'black', amount }`, expanded by `blendRecipeToColor(recipe, overlay)`. `overlayColor` defaults to `project.overlayColor` — retiring Peace's hardcoded `ov = '#8B8378'`.

`purposeWord?: string` is **per-board data**, not derived from the label: it feeds the `RestorationCTA`. Most boards use their capitalized id (`Peace`, `Hope`, …) but the Serenity trio (`forgiveness`, `surrender`, `trust`) all carry `'Serenity'`, which a label-split could not produce. The renderers read `board.purposeWord ?? purposeWord` (the latter being the old label-derived fallback).

Node-testable helpers (`collectImageSources`, `collectSectionTexts`, `collectBlendRecipes`, `isValidBlendRecipe`, `collectMobileImageSlots`, `CANONICAL_ROLE_ARC`) back the invariants in `devotion-moodboards.test.ts`: every image resolves under `/public`, every text has a non-empty `full`, every background is a valid recipe, every board follows the role arc. `collectMobileImageSlots(board)` (returning `{ where, src, aspectClass }[]`) feeds the data-driven `moodboard-aspect.test.ts`, which reads each mobile image's real pixel dimensions and asserts the `object-cover` crop factor stays under 1.45 — the guard that caught an identity mobile-principle src pointing at the wrong (portrait) asset. The `_shared.ts` helpers import `node:fs` only in tests, but the boards are `.tsx`; the three node-env tests (`-assets`, `-aspect`, the data test) are excluded from `tsconfig.app` and type-checked under `tsconfig.node` — which now also carries the `@/* → ./src/*` path alias (added so the aspect test's `@/data/devotion-moodboards` import resolves under `tsc -b`, not just Vitest).

Does **not** own: the animation engine (stays in `MoodBoard`, unchanged), the CTA (`RestorationCTA`) or `NextDevotionHandoff` (appended by the renderers, already shared), or the handoff metadata in `devotions.ts`.

## MoodBoardZones / MoodBoardStack

The two renderers in `MoodBoard.tsx` that are the seam between a `DevotionMoodBoard` and the DOM. They do **not** walk the same data: `MoodBoardZones` (desktop) walks `board.sections` into absolute-positioned horizontal zones; `MoodBoardStack` (mobile) walks the separate `board.mobile` into the vertical `<section>` stack. Each delegates per-element work to a small `renderDesktopElement` / `renderMobileElement` helper.

The renderers own only the **constant wrapper grammar**, never per-kind styling (the elements already carry their full class tokens). For a desktop element the renderer composes `mb-elem absolute {pos} overflow-hidden`, applies the element's `style`, and stamps `data-speed="0.5"` — the exact shell the GSAP `querySelectorAll('.mb-elem')` reveal/parallax pass keys off; text tags are emitted via `createElement(tag, …, text.full)`. The mobile renderer emits each element's verbatim `className` and renders `text.mobile ?? text.full`. Passing an absent `PhotoDevelopImage` prop as `undefined` keeps the emitted props byte-identical to the old hand-written JSX (no conditional spreading).

The parent `MoodBoard` keeps the GSAP+ScrollTrigger engine and the horizontal-pin lifecycle. The old `isPeace…isTrust` dispatch ladder, the eleven `isX` consts, and `isCustomDevotion` are **all gone**: because every devotion now has a board, the dispatch collapses to `board ? <MoodBoardStack/Zones …> : <MoodBoardMobile/DefaultZones …>` (the non-board fallback remains only for any project without an entry), and the handoff gate is `{board && <NextDevotionHandoff … inHorizontalTrack/>}`. The renderers compute `const word = board.purposeWord ?? purposeWord` and pass `purposeWord={word}` to `RestorationCTA` — `purposeWord` is now board **data**, not derived from `devotions[id].label`.

Migration is **complete — all 11 devotions** render from data; the ~4,000 lines of hand-written `*Zones`/`*Mobile` JSX (20 functions) and their nine dead image-map consts are deleted, shrinking `MoodBoard.tsx` from ~4,989 to ~983 lines. Faithfulness is guarded three ways: `moodboard-assets.test.ts` (every referenced `/public` image exists; scans the whole `devotion-moodboards/` dir), `moodboard-aspect.test.ts` (no mobile image severely cropped), and `devotion-moodboards.test.ts` (role arc, prose, recipes). Verified green across the suite plus `npm run build`, and visually spot-checked (hope desktop, identity mobile) with the all-11 route sweep showing 0 broken images and no console errors.

Does **not** own: the animation engine, the horizontal-scroll pin, or the progress bar — those stay in `MoodBoard`.

## ConnectionDiscovery

The deepened module that owns the connection-card lifecycle for the active Note: qualify → check embedding → fetch neighbors → (optionally) assemble cards. Reactive, not imperatively triggered — it re-runs whenever its inputs change and cancels the in-flight run on change/unmount. Follows the **`GraphView`** precedent (an `Observable<ConnectionDiscoveryState>` class driven by `useEffect`-bound `setInputs` forwarders), **not** the `MigrationWorkflow`/`RouteTransition` `start()`-triggered precedent. Surfaced as `useConnectionDiscovery({ adapter, userId, activeNote, totalNoteCount, loadNeighborNotes, thresholds, mode })` returning `{ state, retry }`.

Two modes (mirroring `GraphView.setMode`):

- `'presence'` — stops after `getConnectionNeighbors`; emits only whether qualifying connections exist. Used by the mobile glow-dot. `useHasConnections` collapses to a thin wrapper over `mode: 'presence'`, retiring the faked-`{}`-adapter hack (the controller accepts a nullable adapter and parks in `inactive` when absent).
- `'full'` — continues through `loadNeighborNotes` + `computeSharedSignals` to assemble `ConnectionCard[]`. Used by `ConnectionCardsPanel`.

`cards.length > 0` is knowable at the neighbor-fetch stage boundary (a non-empty `neighbors` always yields non-empty `cards` after the `slice(0, maxRenderedCards)`), which is why `'presence'` can short-circuit before the expensive note-load + signal-compute work.

Responsibilities:

- `decideConnectionQualification(input)` — the **pure** gate, lifted out and node-tested in isolation (mirrors `NotepadFirstLoad.decideFirstLoadActions`). Maps `(activeNote, plaintext word count, totalNoteCount, thresholds)` to the `inactive` reasons (`no_active_note` / `note_too_short` / `vault_too_small`) plus the `meetsDepth` / `meetsVault` flags, or `qualified`.
- The async run sequence and its per-step error → `{ phase: 'error', reason: 'network' }` mapping.
- **Generation-fencing** (the stale-async guard previously held in `generationRef` / `cancelledRef` inside a React effect) — moved *inside* the controller so it is node-testable with fake deps. This was the original friction: the fencing was the load-bearing complexity and it could only be exercised through a React harness.
- The default thresholds contract (`qualifyingMinSimilarity` defaults to the spec value `0.78`; `minWords` / `minVaultSize` carry the dev-loosened defaults), preserved verbatim from the hook.

Deps are injected (`hasNoteEmbedding`, `getConnectionNeighbors`, `loadNeighborNotes`, `computeSharedSignals`) so the controller is node-testable with fakes, mirroring `GraphView`'s `GraphViewDeps`.

`ConnectionCard` (the assembled card data) stays, but **without a `why` field** — the per-card explanation is owned by `ConnectionWhy`. Emits `ConnectionDiscoveryState` (the renamed `ConnectionCardsState`).

Does **not** own: the per-card why-explanation lifecycle (that's `ConnectionWhy`), the server-threshold fetch (`getConnectionCardThresholds` stays a one-shot `useEffect` in the panel and flows in as `thresholds`), or any rendering (`ConnectionCardsPanel` / `ConnectionCardsStrip` / `ConnectionCardsEmpty` are the view shells).

## ConnectionWhy

The deepened module that owns the per-card **why-explanation** lifecycle, split out of the old `useConnectionCards`'s `expandCard` / `retryWhy` callbacks. Surfaced as `useConnectionWhy({ adapter, sourceNoteId })` returning `{ whyState(relatedNoteId), expand(relatedNoteId), retry(relatedNoteId) }`.

Owns a `Record<relatedNoteId, ConnectionCardWhyState>` — a small per-key status machine: `collapsed → loading → shown | error`. `expand` calls `adapter.generateConnectionWhy(sourceNoteId, relatedNoteId)` and maps the `ConnectionWhyResult`: `ok → shown(text, cached)`; `!ok` with `reason === 'validators_failed' → error('validators_failed')`; any other `!ok` or a throw → `error('network')`. `retry` re-runs `expand`. The `ConnectionCardWhyState` type moves here from `useConnectionCards`.

`ConnectionCardsPanel` **composes** the two modules: a `ConnectionCard` from `ConnectionDiscovery` (mode `'full'`) plus `whyState(card.relatedNoteId)` + `expand` from `ConnectionWhy`. The `activeChipId` / open-card UI state stays in the panel (view concern); the chip-click handler calls `expand` only when the card's why is still `collapsed`, preserving today's behavior.

Pure of React orchestration in its core: node-testable with a fake adapter that scripts a `ConnectionWhyResult` per `(sourceNoteId, relatedNoteId)` pair — the `generate → cache | validators_failed | network` branches get one focused test instead of being exercised only through the panel.

Does **not** own: card assembly or qualification (that's `ConnectionDiscovery`), the `prefixWhyWithName` personalization (stays in the panel / `why-render`), or the loading/error/shown JSX.

## HeroChoreography

The umbrella for the hero animation layer split: per-scene keyframe **data** plus pure invariant helpers (the "score"), executed by a thin GSAP/ScrollTrigger harness in `HeroDesktop` / `HeroMobile`. Mirrors `DevotionMoodBoard`'s stance — art-directed timing preserved as data, node-testable helpers back the invariants — so the win is **testability + one source of truth across desktop/mobile**, not normalization of aesthetic easing.

Keyframe grammar: a `Keyframe = { target, from?, to, at, duration, ease }`; a scene spec is `Keyframe[]` plus its scrub/start/end trigger metadata. A thin `applyKeyframes(tl, keyframes, targets)` walks the data into a GSAP timeline — the only GSAP-coupled step.

Scrub scenes expressed as data:
- `collapseKeyframes` — bloom → three letter waves → A-pulse → ring-bloom → color-flash. Owns the **wave-overlap invariant** (wave 2 (P+M) starts before wave 1 (S₂) ends) and the nav-collapse progress publish spanning `[0,1]`.
- `maskExpandKeyframes` — clip grow + image scale + image→video crossfade. Carries `VIDEO_PLAY_AT = 0.65` as data so the **play-before-crossfade** ordering (0.65 < the 0.70 crossfade position) is assertable.
- `quoteFadeKeyframes` — the three-line staggered fade.
- the shared `bridgeCascadeKeyframes` (below).

Reduced-motion is a **derived projection** for the two fade-only scenes (`quoteFadeKeyframes`, `maskExpandKeyframes`): each reduced state = `projectFinalFrame(spec)`, making "reduced == last frame" an assertable invariant that catches drift. Two scenes are documented **carve-outs** because their reduced state is *not* their scrub's last frame: the **collapse** applies the final opacities WITHOUT the x-translate (no scroll drives it) on an `IntersectionObserver`; the **bridge** renders all three beats simultaneously visible in normal flow (the scrub's last frame has beats 1–2 already faded out, so projection would hide them).

Does **not** own: the GSAP/ScrollTrigger lifecycle wiring (thin effects stay in the components), the intro lifecycle (that's `HeroIntroSequence`), or the JSX.

## WordmarkGeometry

The five PSALMS letter collapse offsets (`P 653.3, S1 339.8, L −313.9, M −690.5, S2 −1076.4`, SVG-userspace units) as one shared constant consumed by both `HeroDesktop` and `HeroMobile`. Previously copy-pasted verbatim across the two files. The intro spread uses them as the *from*; both letter-collapses use them as the *to*. A palette/geometry change is now one edit, not two.

## bridgeCascadeKeyframes

The shared three-beat bridge builder, living alongside the already-shared `BRIDGE_PIN_TIMING` in `hero-bridge-content.ts`. Returns the six-tween keyframe list (text 1 rise+exit, text 2 slide+exit, text 3 rise+exit) as data; `HeroDesktop` and `HeroMobile` each walk it via `applyKeyframes`, passing their own `timeScale` (× `MOBILE_TIME_SCALE` on mobile) and text-2 enter-`x` (120 desktop / 30 mobile). Replaces the duplicated `tl.to` ladder that lived in both files; the kiss-handoff fractions are now asserted once for both platforms.

## HeroIntroSequence

The deepened controller that owns the play-once **intro → handoff → reveal** lifecycle on `HeroDesktop` — the only real state machine in the hero. Status `idle → playing → revealed`; `HeroDesktop` derives `showNav` from the status, which gates the mask section's CSS reveal. The handoff beat fires `onHandoff` and flips to `revealed` at t ≈ 6.40s, strictly **before** `onIntroComplete` fires at timeline end.

Side-effects (gsap timeline build/play, the two callbacks, the clock) are injected as deps so the **callback-ordering invariant** and the **play-once guard** are node-testable with a fake clock — mirrors `RouteTransition` / `PurposeDetailReveal`. The aesthetic heartbeat / ring / spread tweens stay imperative inside its build method (preserved verbatim; we test the lifecycle, not the easing). `HeroMobile` keeps its trivial immediate-fire intro (fires `onIntroComplete` + `onHandoff` at once) and needs no controller.

Does **not** own: the scrub scenes (those are `HeroChoreography` data), responsive aura/ring sizing (`wordmarkAuraSizes` + a thin `ResizeObserver` effect), or `introActive` gating (a prop from `App`).

## wordmarkAuraSizes

Pure function for the glow-aura / pulse-ring sizing ratios (aura ×0.6545, ring-initial ×0.2364, ring-final ×2.5455 of the measured wordmark width). Replaces the inline `ResizeObserver` math; the observer stays a thin effect that calls this and writes the three CSS vars. Node-testable on synthetic widths.

## ScanCapture

The deepened module that owns the capture→transcribe lifecycle for a handwritten-note scan: take or choose a photo, clean it, upload it, and resolve a `TranscriptionResult`. Surfaced as the `useScanCapture({ userId, onResult, onCancel })` hook returning `{ state, startCamera, capture, submitFile, backToIdle, reset, cancel, videoRef, fileRef }` (where `state` is the `{ phase, error }` snapshot). Mounted by the `ScanCapturePanel` view shell (the former inline `ScanCapture` component), itself mounted by `UploadModal`.

Five-state phase machine:

```
idle ──(startCamera)──> camera ──(capture)──> cleaning ──> transcribing ──(onResult)──> ✕ unmounted
  │                                              ▲
  └──(submitFile, valid)─────────────────────────┘
(any pipeline throw) ──> error ──(reset)──> idle
(submitFile, invalid) ──> error
```

Success exits through `deps.onResult(result)` — there is **no `done` phase** because `UploadModal` swaps the panel for `TranscriptionReview` on result.

Class responsibilities:

- The five-state phase and the current error message.
- `startCamera()` — `idle | error → camera`; calls `deps.openCamera()`. On rejection calls `deps.requestFileFallback()` and stays `idle`, preserving the original getUserMedia-fails→file-picker fallback.
- `capture()` — `camera → cleaning`; `deps.captureFrame()` → `Blob`, `deps.stopCamera()`, then the pipeline.
- `submitFile(file)` — the validation gate (`isAcceptedImage` / `MAX_IMAGE_BYTES`) runs **before** any pipeline dep; an invalid file goes straight to `error` with the stage-tagged message and no upload is attempted.
- The private `runPipeline(blob)`: `cleaning → deps.preprocess(blob) → transcribing → deps.upload(cleaned) → deps.transcribe(key) → deps.onResult(result)` (the deps close over `userId` in the hook, so the controller passes only the blob/key).
- `reset()` — `error → idle`. `cancel()` — `deps.stopCamera()` then `deps.onCancel()`.
- `dispose()` — `deps.stopCamera()` and bumps the generation counter; called on hook unmount.
- **Generation-fencing.** `runPipeline` captures the current generation; a `preprocess` / `upload` / `transcribe` that resolves or throws after `dispose()` / `cancel()` is dropped — `onResult` and the `error` transition only fire for the live generation. This closes the latent unmounted-`setState` bug where an in-flight `transcribe` resolving after the modal closed called `onResult` on an unmounted `UploadModal`. Mirrors `ConnectionDiscovery`'s generation fence and `PurposeDetailReveal.dispose()`.
- Owns user-facing error copy via the pure `classifyScanError(stage)`: maps `'wrong_type'` / `'too_large'` / `'preprocess'` / `'upload'` / `'transcribe'` to stable messages. Retires the prior raw-`err.message` leak (internal strings like `'upload failed: …'` no longer reach users).

Side-effects are injected as `ScanCaptureDeps` (`openCamera`, `captureFrame`, `stopCamera`, `requestFileFallback`, `preprocess`, `upload`, `transcribe`, `onResult`, `onCancel`), so the controller is pure-state-and-deps and node-testable with fakes for the camera, the canvas, and the transcription client. The previously-untested orchestration — phase transitions, per-stage error mapping, validation-before-upload, the camera fallback, and the dispose fence — gets one focused test each (`scan-capture.test.ts`) instead of being reachable only by mounting the component with a real `getUserMedia` and Supabase.

The thin `useScanCapture` hook owns the DOM coupling the controller is pure of: it holds `videoRef` / `fileRef` and wires the real deps — `openCamera` does `getUserMedia` + attaches the stream to the video element + `play()`; `captureFrame` draws the video to a canvas and `toBlob`s it; `preprocess` / `upload` / `transcribe` forward to `image-preprocess` and `transcription-client`. Mirrors how `useNoteEditor` owns the TipTap instance and `useRouteTransition` mounts its own window listeners.

Does **not** own: the review/save flow (`TranscriptionReview` + `markTranscriptionSaved` / `discardScan` / `buildNoteFromTranscriptionDoc`), the editor, `UploadModal`'s `ScanStage` machine, or the `<video>` / `<canvas>` / file `<input>` elements themselves (the panel renders them; the hook bridges them in through deps).

---

# Lamplight (edge functions)

The server-side AI surface lives in `supabase/functions/`. These concepts name the seams in the `lamplight-generate` Edge Function. Use them exactly; variants ("the generate handler", "the AI dispatcher", "the usage logger") drift the conversation.

## Artifact

A persisted, model-generated output keyed by a `kind`: `daily_devotion` (a `DailyDevotion` object in `lamplight_artifacts`, idempotent on `(user_id, 'daily_devotion', period_key)`), `connection_card_why` (a short `why` string in `lamplight_connections`, keyed by composite `content_hash`), or `smoke_test` (throwaway, slated for removal per follow-up P1-1; carries no persistence). Each kind has its own model (Sonnet for daily devotion, Haiku for connection-why), context builder, validators, and result shape — that per-kind logic does not generalize and is not meant to.

## lamplight_usage

The fire-and-forget audit row for a single generation attempt: `{ user_id, model, artifact_kind, tokens_in, tokens_out, status, error_code? }`. A usage-table outage must never break the primary work path, so `recordLamplightUsage` swallows insert failures to a `console.error`.

`model` is **nullable** (migration 022): a `null` model means *no model was invoked* — the honest record for a pre-model failure (`quota_exceeded`, `no_embedding`, `not_neighbor`). The admin cost map (`src/admin/lamplight-cost.ts`) resolves a `null` model to `$0`. Before migration 022 these rows fictitiously recorded a hardcoded Haiku model id and `0` tokens, which silently overcounted Haiku spend in the admin leaderboard; that fiction is retired.

Cache-hit success paths (an already-generated `daily_devotion`, a `content_hash`-matched `connection_card_why`) spend nothing and record **no** usage row. The daily-devotion *race path* (a concurrent insert won between pre-check and INSERT) is the subtle exception: it returns `cached: true` to the client but **did** spend tokens, so it records a real usage row. "Cached" therefore cannot gate "skip usage" — the `GenerationOutcome.usage` field carries the decision explicitly.

## GenerationLifecycle

The deepened module that owns the cross-cutting envelope around every artifact generation — the stateless coordinator that concentrates what was previously smeared across `index.ts` and the three pipelines. Surfaced as `runGeneration(deps, meta, body)` in `supabase/functions/_shared/generation-lifecycle.ts`.

Mirrors the stateless-coordinator pattern of `NotepadActions` / `AccountActions` (cross-module knowledge concentrates in one place), but takes the shape of a higher-order wrapper: the per-kind work is an injected `body` that returns a `GenerationOutcome` — **data, not side effects**.

```ts
interface GenerationOutcome {
  response: unknown;          // JSON body for the client
  usage: UsageRow | null;     // null = nothing to record (cache hit)
}

interface GenerationLifecycleDeps {
  checkQuota: (userId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  recordUsage: (row: UsageRow) => Promise<void>;   // the single insert site
  classifyError: (err: unknown) => string;
}

function runGeneration(
  deps: GenerationLifecycleDeps,
  meta: { userId: string; artifactKind: string },
  body: () => Promise<GenerationOutcome>,
): Promise<{ status: number; response: unknown }>;
```

Responsibilities (the one place each of these now lives):

- **Quota gate.** Runs `checkQuota` before the body. On `!ok`: records one `error` usage row (`model: null`, `error_code: 'quota_exceeded'`) and returns `{ status: 429 }`. This *adds* a usage row where `index.ts` previously recorded nothing on quota rejection — deliberate failure-rate telemetry.
- **Single-site usage recording.** Records `outcome.usage` exactly once when non-null; skips when `null`. No pipeline calls `recordLamplightUsage` anymore — they surface real `{ model, tokens_in, tokens_out, status }` in their result and the lifecycle writes it.
- **Error classification.** Genuine throws are caught, recorded as an `error` row (`model: null`, `error_code: classifyError(err)`), and rethrown so `serve()`'s top-level catch emits the CORS-bearing 500. `validators_failed` is a *returned* `ok:false`, not a throw — the body maps that result's reason into its `usage` row directly; only thrown errors reach `classifyError`. `classifyGenerateError` is the sole error-code source; pipelines no longer hardcode error codes.

Does **not** own: HTTP/CORS, env-key checks, JSON parsing, JWT→`userId` derivation, the `lamplight_settings.enabled` opt-in gate, or per-kind payload validation — those stay in `index.ts`, which shrinks to transport + auth + three `runGeneration(...)` dispatch calls. It also does not own context building, the per-kind generate→validate→retry loop, or persistence — those stay in the per-kind bodies and pipelines.

Pure of HTTP and Supabase wiring: `checkQuota` / `recordUsage` / `classifyError` are injected, so the envelope is node-testable with fakes. The invariants that were previously un-assertable at the dispatcher level — quota-exceeded records exactly one error row and never calls the body; success records exactly one row; a `usage:null` body records nothing; a thrown body records one `model:null` error row with the classified code — get one focused test instead of being re-proven piecemeal across three pipeline suites.

The P2-5 `pg_cron` daily-devotion trigger composes through this seam: the cron calls `runGeneration(deps, meta, dailyDevotionBody)` and inherits quota + usage accounting without re-implementing them. That is the leverage the seam buys — the reason it is not just `index.ts` tidied.

## GenerateWithRetry

The deepened module one layer below `GenerationLifecycle`: it owns the generate→validate→maybe-retry-once loop that every Lamplight pipeline previously open-coded. Surfaced as `generateWithRetry(config)` in `supabase/functions/_shared/generate-with-retry.ts`.

Each pipeline used to repeat the same shape — compose system prompt (base voice fragment + artifact stance + a stricter suffix on retry), call `llm.generate`, run validators, and on failure re-prompt once with a sterner instruction. The bodies differed only in their artifact type, their validators, and the prose of the stricter suffix. That sameness was the duplication; the wrapper concentrates it.

```ts
interface GenerateWithRetryConfig<TParsed, TViolations> {
  llm: LLMAdapter;
  model: LLMModel;
  maxTokens: number;
  artifactSystem: string;
  systemTokens?: Record<string, string>;
  messages: GenerateInput['messages'];
  tool: ToolSchema;
  validate: (parsed: TParsed) => Promise<{ ok: boolean; violations: TViolations }>;
  formatStricter: (violations: TViolations) => string;
  maxAttempts?: number; // default 2
}

type RetryOutcome<TParsed, TViolations> =
  | { ok: true; parsed: TParsed; modelUsed: string; promptTokens: number; completionTokens: number; attempts: number }
  | { ok: false; violations: TViolations; modelUsed: string; attempts: number };
```

Like `GenerationLifecycle`, it returns **data, not side effects** — a `RetryOutcome`, never a DB write. Cache/idempotency lookups stay *before* the wrapper and persistence stays *after* it, in each pipeline: the smoke-test pipeline just returns, daily-devotion does an insert + race-reread, connection-why upserts by composite hash. Those genuinely-different success branches remain visible in the pipelines; only the identical loop moved.

Generic over `TParsed` (artifact shape) and `TViolations` (the pipeline's own violation bag), so each caller keeps its own validators and its own stricter-prose. The wrapper bakes in `LAMPLIGHT_SYSTEM_FRAGMENT` as the base voice and threads the prior attempt's violations into the retry prompt via `formatStricter` — the suffix is empty on the first attempt and only appears on the retry.

Pure of Supabase: it takes an injected `LLMAdapter`, so it is node-testable with a fake adapter that scripts a parsed value per attempt and records the system prompt it was handed. The invariants that were previously re-proven across three pipeline suites — first-attempt-valid makes one call with no stricter suffix; an invalid first attempt retries once with the violations threaded forward; both-invalid returns `ok:false` with the *last* violations and `modelUsed` from the last call; `systemTokens` substitute into the composed prompt — get one focused test (`generate-with-retry.test.ts`).

`formatContentFamilyStricter` (in `validators.ts`) is the shared companion helper: it maps the `banned` / `contested` / `growth` content-violation families to their stricter-prompt lines, deduplicating prose that the smoke and daily pipelines held byte-identical copies of. It deliberately does **not** handle the `name` family — that is daily-devotion-specific and composed in that pipeline's `formatStricter`.

`formatVerseRef` + `buildPassages` (in `_shared/bible-passage.ts`) are the parallel companion on the retrieval side: `formatVerseRef` owns the verse-reference string (Reference-domain logic, per §Reference / §ScriptureNode) and `buildPassages` owns the `bible_passages`→passage join, deduplicating the byte-identical Map-build/format/filter blocks that the smoke and daily-devotion context builders in `lamplight-generate/index.ts` both held. Both callers now pass `passageRows` + `retrievedBible` and get back the same passage objects, so the structurally-identical `SmokeTestPassage` / `DailyDevotionPassage` shapes stay assignable without touching either pipeline.

## NoteContext

The deepened module that owns the recent-notes → theme-query → Bible-passage retrieval shared by the smoke-test and daily-devotion context builders in `lamplight-generate/index.ts`. Surfaced as `retrieveNoteContext(deps, opts)` in `supabase/functions/_shared/note-context.ts`, returning a `NoteContext` or `null`.

```ts
interface NoteContext {
  notes: NoteContextNote[];        // { id, title, plaintext }
  passages: BiblePassage[];        // from buildPassages (§GenerateWithRetry companion)
  allowedNoteIds: Set<string>;
  allowedVerseRefs: Set<string>;
  rerankUsed: boolean;
}

interface NoteContextDeps {
  fetchRecentNotes(userId: string, limit: number): Promise<RawNoteRow[]>;   // { id, title, content }
  embedQuery(text: string): Promise<number[]>;
  searchBible(args: { query: string; k: number; queryEmbedding: number[] }): Promise<RetrievedBibleRow[]>;
  fetchPassages(sourceIds: string[]): Promise<BiblePassageRow[]>;
}

function retrieveNoteContext(
  deps: NoteContextDeps,
  opts: {
    userId: string;
    noteLimit: number;
    rerankEnabled: boolean;
    buildThemeQuery: (notes: NoteContextNote[]) => string;
    k?: number; // default 3
  },
): Promise<NoteContext | null>;
```

Owns the sequence both builders previously open-coded: fetch the N most-recently-updated notes, map each to `{ id, title, plaintext: extractTextFromNoteContent(content).slice(0, 800) }`, drop the blank ones, short-circuit to `null` when none survive (**no embed/search work happens** — those deps are never called), invoke `buildThemeQuery` on the survivors, embed it, search the Bible (`k` default 3), fetch the matched `bible_passages`, run `buildPassages`, and derive `allowedNoteIds` / `allowedVerseRefs` / `rerankUsed` (`rerankEnabled && passages.length > 0`).

The **only** thing that varies between callers is the theme query, so it is the injected `buildThemeQuery(notes)` strategy — smoke uses the longest survivor's plaintext; daily joins `"{title}: {plaintext.slice(0,200)}"` capped at 4000. The note limit (5 smoke / 3 daily) is a plain option.

Canonicalizes the **title fallback** to the stricter daily form — `(title ?? '').trim() || '(untitled)'` — retiring smoke's looser `title ?? '(untitled)'`. A whitespace-only title now reads as `(untitled)` for both callers; a defensive consolidation in the spirit of `§tiptap-text`'s `type === 'text'` gate, not a behavior the smoke pipeline depended on.

Pure of Supabase, mirroring `§GenerationLifecycle` / `§GenerateWithRetry`: the four I/O leaves are injected `NoteContextDeps`, so the orchestration is node-testable with plain fakes (no Supabase query-builder stub). `index.ts` writes the `.from('notes')…` and `.from('bible_passages')…` queries **once** as the shared dep impls both builders pass. The invariants previously reachable only through `pipeline.test.ts` get one focused `note-context.test.ts`: blank-notes short-circuits to `null` without calling embed/search; plaintext is sliced to 800 and blank notes filtered; `buildThemeQuery` receives the surviving notes; the allowed-sets and `rerankUsed` gate are derived correctly.

`buildSmokeTestContext` and `buildDailyDevotionContext` shrink to: call `retrieveNoteContext` with their strategy, and — daily only — wrap the result with the `profiles.full_name` → `firstName` fetch and `localDate`. Both are daily-specific, so they stay in the builder, *around* the seam; daily fetches the profile only after a non-null retrieval, preserving "no profile read when the user has no notes."

Does **not** own: the connection-why retrieval (`buildConnectionWhyContext` loads a note **pair by id** + source embedding + neighbor RPC + composite hash — a different shape that shares only the already-shared `extractTextFromNoteContent`, so it stays out of this seam), the per-kind result shaping (`firstName` / `localDate` / the distinct context interfaces), quota/usage accounting (`§GenerationLifecycle`), or the generate→validate→retry loop (`§GenerateWithRetry`).
