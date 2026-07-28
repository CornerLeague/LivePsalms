import type { StorageAdapter } from '../storage/adapter';
import type { Note } from '../types';
import { NoteCollection } from './note-collection';
import { FolderHierarchy } from './folder-hierarchy';
import { ReferenceGraph } from '../graph/reference-graph';
import { planTypeFolderSeed } from './seed-type-folders';
import { hasSeededTypeFolders, markSeededTypeFolders } from '../session/session-storage';

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
   * errored before creating anything is retried on the next load.
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
   * loading. A partial run leaves the remaining notes at root — visible in the
   * sidebar and fixable by dragging — and won't be retried, since the account
   * now has folders.
   */
  private async seedTypeFolders(): Promise<void> {
    const scopeId = this.adapter.scopeId;
    if (this.seedAttempted || hasSeededTypeFolders(scopeId)) return;

    const plan = planTypeFolderSeed(
      this.notes.getSnapshot().notes,
      this.folders.getSnapshot().folders,
    );
    if (!plan) return;

    // Re-read straight from storage immediately before writing. The in-memory
    // snapshot can be stale — another tab on the same account may have already
    // run the backfill since this one loaded — and seeding twice would hand the
    // user two of every folder.
    const current = await this.adapter.getFolders();
    if (current.some((f) => f.kind !== 'study')) {
      await this.folders.init().catch(() => {});
      return;
    }

    try {
      const folderIdByType = new Map<string, string>();
      for (let i = 0; i < plan.folders.length; i++) {
        const spec = plan.folders[i];
        const created = await this.adapter.createFolder({
          name: spec.name,
          parentId: null,
          order: i,
          icon: spec.icon,
          color: spec.color,
        });
        folderIdByType.set(spec.type, created.id);
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
      // Pick up whatever did land so the UI matches storage.
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
    this.adapter = next;
    this.notes.rebindAdapter(next);
    this.folders.rebindAdapter(next);
    this.referenceGraph.reset();
    // Drop both init guards: a run still in flight belongs to the previous
    // account, and the incoming one needs its own backfill check.
    this.initInFlight = null;
    this.seedAttempted = false;
    await this.init();
  }
}
