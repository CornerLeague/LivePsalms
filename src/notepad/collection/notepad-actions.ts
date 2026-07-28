import type { StorageAdapter } from '../storage/adapter';
import type { Note } from '../types';
import { NoteCollection } from './note-collection';
import { FolderHierarchy } from './folder-hierarchy';
import { ReferenceGraph } from '../graph/reference-graph';
import { planTypeFolderSeed, reconcileTypeFolderSeed } from './seed-type-folders';
import {
  hasSeededTypeFolders,
  markSeededTypeFolders,
  hasAttemptedTypeFolders,
  markAttemptedTypeFolders,
} from '../session/session-storage';

/**
 * How many note moves the backfill issues at once. Sequential would mean one
 * round trip per note on a large account's first load after the update; the
 * whole batch at once would burst hundreds of concurrent requests at Supabase.
 */
const SEED_MOVE_CONCURRENCY = 8;

export class NotepadActions {
  private adapter: StorageAdapter;
  private notes: NoteCollection;
  private folders: FolderHierarchy;
  private referenceGraph: ReferenceGraph;
  /** The run currently in flight, shared by concurrent `init()` callers. */
  private initInFlight: Promise<void> | null = null;
  /**
   * Whether this instance has already completed the type-folder backfill.
   * Backstop for the `hasSeededTypeFolders` marker, which silently no-ops when
   * localStorage is unavailable. Deliberately not set on failure, so a run that
   * errored — wholly or partway — is retried (and resumed) on the next load.
   */
  private seedAttempted = false;

  constructor(
    adapter: StorageAdapter,
    notes: NoteCollection,
    folders: FolderHierarchy,
    referenceGraph: ReferenceGraph,
  ) {
    this.adapter = adapter;
    this.notes = notes;
    this.folders = folders;
    this.referenceGraph = referenceGraph;
  }

  /**
   * Concurrent callers share one run. React StrictMode invokes the provider's
   * mount effect twice, and without this both runs would load in parallel and
   * each see a pre-backfill folder list — seeding a duplicate set of folders.
   * Sequential calls still re-run: the guard clears once the run settles.
   */
  init(): Promise<void> {
    this.initInFlight ??= this.runInit().finally(() => {
      this.initInFlight = null;
    });
    return this.initInFlight;
  }

  private async runInit(): Promise<void> {
    await Promise.all([this.notes.init(), this.folders.init()]);
    await this.seedTypeFolders();
    const noteList = this.notes.getSnapshot().notes;
    if (noteList.length > 0) {
      try {
        const { rewires } = this.referenceGraph.repairNoteLinks(noteList);
        // Persist each rewire through NoteCollection so canonical in-memory
        // state stays in sync — no refetchAll needed.
        for (const rewire of rewires) {
          await this.notes.updateNote(rewire.noteId, { content: rewire.content });
        }
      } catch (err) {
        console.warn('[NotepadActions] repair pass failed:', err);
      }
    }
    await this.referenceGraph.init(this.notes.getSnapshot().notes);
  }

  /**
   * One-time backfill for accounts predating folder-based note creation: turns
   * the sidebar's implicit note-type grouping into real folders so the folder
   * model (per-folder "+", New Note landing in the current folder, folder graph
   * chips) is actually reachable. Declines on accounts that already use folders
   * — see `planTypeFolderSeed`.
   *
   * Writes go through the adapter rather than `FolderHierarchy.createFolder` so
   * seeding doesn't emit `folder-created` and tick off the user's "create a
   * folder" onboarding step on their behalf.
   *
   * Never throws into `init()`: a failure here must not block the workspace from
   * loading. A partial run is recorded up front (see `markAttemptedTypeFolders`)
   * and resumed on this device's next load — creating only the folders that are
   * still missing and moving only the notes still at root — so an interrupted
   * backfill converges instead of stranding notes at root. Until it does, the
   * un-moved notes stay visible in the sidebar's legacy type grouping.
   */
  private async seedTypeFolders(): Promise<void> {
    const scopeId = this.adapter.scopeId;
    if (this.seedAttempted || hasSeededTypeFolders(scopeId)) return;

    // Re-read folders straight from storage: the in-memory snapshot can be stale
    // (another tab on the same account may have seeded since this one loaded).
    const current = await this.adapter.getFolders();

    // Respect a genuine user folder — non-system AND untagged. The user has
    // adopted folders, so their layout is theirs and the one-time backfill backs
    // off. This gate runs for a *resume* too, not just a fresh start: if the user
    // organized between a partial run and its resume, we must not pile more seed
    // folders on top. A seeded folder (seededType set) is our own run, never
    // adoption, so it doesn't trip this — which is what lets a partial seed
    // resume, and (when the attempt marker was lost) be recognized by its tag.
    if (current.some((f) => f.kind !== 'study' && f.seededType == null)) {
      await this.folders.init().catch(() => {});
      return;
    }

    if (!hasAttemptedTypeFolders(scopeId)) {
      // Fresh account: only start if there are root notes to migrate.
      const plan = planTypeFolderSeed(this.notes.getSnapshot().notes, current);
      if (!plan) return;
      // Record intent before the first write so a crash mid-seed is resumable.
      markAttemptedTypeFolders(scopeId);
    }

    await this.applyTypeFolderSeed(scopeId);
  }

  /**
   * Drive the account to the seeded end-state from wherever it currently sits,
   * creating only the folders that don't exist yet and moving only notes still
   * at root (see `reconcileTypeFolderSeed`). Idempotent by identity match, so a
   * retry after a partial run fills the gaps rather than duplicating folders.
   *
   * Never throws: on failure the attempt marker stays set and the next load
   * resumes; on success it records completion so later loads short-circuit.
   */
  private async applyTypeFolderSeed(scopeId: string): Promise<void> {
    try {
      // Reconcile against live storage, not the in-memory snapshot, so a resume
      // sees folders an earlier attempt (or another tab) already created.
      const liveFolders = await this.adapter.getFolders();
      const plan = reconcileTypeFolderSeed(this.notes.getSnapshot().notes, liveFolders);
      if (!plan) {
        // Nothing left at root — an earlier attempt already did the work (or
        // there was none to do). Record completion and stop re-checking.
        this.seedAttempted = true;
        markSeededTypeFolders(scopeId);
        await this.folders.init().catch(() => {});
        return;
      }

      const folderIdByType = new Map<string, string>(plan.existingByType);
      for (const spec of plan.foldersToCreate) {
        try {
          const created = await this.adapter.createFolder({
            name: spec.name,
            parentId: null,
            order: spec.order,
            icon: spec.icon,
            color: spec.color,
            // Provenance: lets a resume re-find this folder by tag, not name, backs
            // the (user_id, seeded_type) unique index that stops two tabs both
            // creating it, and marks it for later seeded-folder features. See
            // Folder.seededType and migration 053.
            seededType: spec.type,
          });
          folderIdByType.set(spec.type, created.id);
        } catch (err) {
          // Another tab seeding this account concurrently may have created the
          // folder first — the unique index rejects our duplicate. Adopt the
          // winner's folder (found by tag) so both tabs file into the same one.
          // If it's genuinely absent this is a real failure: rethrow to the
          // outer catch, which leaves the attempt marker set to resume next load.
          const existing = (await this.adapter.getFolders()).find(
            (f) => f.seededType === spec.type,
          );
          if (!existing) throw err;
          folderIdByType.set(spec.type, existing.id);
        }
      }

      for (let i = 0; i < plan.moves.length; i += SEED_MOVE_CONCURRENCY) {
        const batch = plan.moves.slice(i, i + SEED_MOVE_CONCURRENCY);
        await Promise.all(
          batch.map((move) => {
            const folderId = folderIdByType.get(move.type);
            return folderId ? this.notes.updateNote(move.noteId, { folderId }) : Promise.resolve();
          }),
        );
      }

      // Re-read folders so the sidebar and graph see the seeded set.
      await this.folders.init();
      this.seedAttempted = true;
      markSeededTypeFolders(scopeId);
    } catch (err) {
      console.warn('[NotepadActions] type-folder backfill failed:', err);
      // Pick up whatever did land so the UI matches storage. The attempt marker
      // stays set, so the next load resumes and fills the rest.
      await this.folders.init().catch(() => {});
    }
  }

  deleteFolder = async (id: string): Promise<void> => {
    const affectedIds = this.notes
      .getSnapshot()
      .notes.filter((n) => n.folderId === id)
      .map((n) => n.id);

    await this.folders.deleteFolder(id);
    this.notes.applyReparenting(affectedIds, 'root');
  };

  updateNote = async (id: string, updates: Partial<Note>): Promise<Note> => {
    const updated = await this.notes.updateNote(id, updates);
    // Only content changes affect references; skip sync for title/folder/tag updates.
    if (updates.content !== undefined) {
      await this.referenceGraph.syncNote(updated);
    }
    return updated;
  };

  deleteNote = async (id: string): Promise<void> => {
    await this.notes.deleteNote(id);
    this.referenceGraph.deleteReferencesFor(id);
  };

  importNotes = async (notes: Note[]): Promise<void> => {
    // Uses `importNote` (id-preserving) so client-generated ids in cross-link
    // marks resolve once the notes are synced into ReferenceGraph.
    for (const note of notes) {
      await this.adapter.importNote(note);
    }
    await this.notes.refetchAll();
    await this.referenceGraph.syncAll(this.notes.getSnapshot().notes);
  };

  async rebindAdapter(next: StorageAdapter): Promise<void> {
    // Drain any init still in flight before swapping accounts. rebind mutates the
    // shared NoteCollection / FolderHierarchy / ReferenceGraph in place, so if a
    // previous account's run kept going after the swap the two inits would
    // interleave over the same collections — double seeds, notes filed into the
    // wrong account's folders, a graph rebuilt from a mixed note set. Letting the
    // old run finish first (on its own, still-current binding) keeps them serial.
    // Loop, don't check once: a mount / StrictMode `init()` can start during the
    // await. Once the loop exits, the swap below runs synchronously through to
    // `init()` installing the new guard, so no run can slip in after the last
    // check — and `init()` finds `initInFlight` already null, so it starts fresh.
    while (this.initInFlight) {
      await this.initInFlight.catch(() => {});
    }
    this.adapter = next;
    this.notes.rebindAdapter(next);
    this.folders.rebindAdapter(next);
    this.referenceGraph.reset();
    // Fresh account: re-run the backfill check.
    this.seedAttempted = false;
    await this.init();
  }
}
