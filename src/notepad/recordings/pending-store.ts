// src/notepad/recordings/pending-store.ts
// Durable queue for pending voice recordings (PR #73, increment 2). A recording
// that has STOPPED but not yet uploaded successfully is persisted here so it
// survives a hard reload, tab close, or crash — rehydrating (via the provider)
// as a `failed` session with the dock's Retry/Discard recovery UI.
//
// Hand-rolled minimal IndexedDB wrapper: the repo has zero IDB usage and we add
// NO new dependencies, so the raw-IDB access is kept tiny and private to this
// module, behind one small backend seam. jsdom has no IndexedDB, so this
// module's own unit test injects an in-memory fake backend via
// `_setBackendForTests`; the provider's tests mock this module wholesale.
//
// Every exported operation SWALLOWS failures (open error, QuotaExceededError on
// save, etc.) and warns — IDB unavailability must NEVER break the upload path.
// A failed save leaves behavior exactly as before this increment (in-memory
// only), so nothing here can throw into recording, upload, or retry.

const DB_NAME = 'psalms-recordings';
const DB_VERSION = 1;
const STORE = 'pending';
const USER_INDEX = 'userId';

/** The pending payload (`pendingRef` shape) plus persistence metadata. */
export interface PendingRecording {
  userId: string;
  noteId: string;
  recordingId: string;
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  error: string | null;
  createdAt: number;
}

/**
 * The single seam between the public API and its storage. The default
 * implementation hand-rolls IndexedDB; tests inject an in-memory fake so the
 * module's logic (and the provider) can run without real IDB.
 */
export interface PendingBackend {
  put(record: PendingRecording): Promise<void>;
  delete(recordingId: string): Promise<void>;
  loadByUser(userId: string): Promise<PendingRecording[]>;
}

// ── Default backend: hand-rolled minimal IndexedDB ───────────────────────────

/** Wrap an IDBRequest as a promise. */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (once) the recordings DB, creating the store + userId index on upgrade. */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'recordingId' });
        store.createIndex(USER_INDEX, 'userId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // If the open fails, drop the cached rejection so a later call can retry.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Run `fn` inside a transaction on the pending store and await completion. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    fn(store).then(
      (value) => {
        result = value;
      },
      reject,
    );
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

const idbBackend: PendingBackend = {
  put: (record) =>
    withStore('readwrite', async (store) => {
      // store.put resolves the generated key; the contract is void, so drop it.
      await promisifyRequest(store.put(record));
    }),
  delete: (recordingId) =>
    withStore('readwrite', (store) => promisifyRequest(store.delete(recordingId))),
  loadByUser: (userId) =>
    withStore('readonly', (store) =>
      promisifyRequest<PendingRecording[]>(store.index(USER_INDEX).getAll(userId)),
    ),
};

// ── Backend override for tests ───────────────────────────────────────────────

let backend: PendingBackend = idbBackend;

/**
 * Test seam: swap the storage backend (e.g. an in-memory fake) so the module's
 * logic can be exercised without real IndexedDB, then restore with `null`.
 * Not used by shipped code.
 */
export function _setBackendForTests(fake: PendingBackend | null): void {
  backend = fake ?? idbBackend;
  if (fake) dbPromise = null; // forget any real handle opened by a prior test
}

// ── Public API (all swallow-and-warn) ────────────────────────────────────────

function warn(err: unknown): void {
  console.warn('[recordings] pending-store unavailable', err);
}

/** Persist (upsert) the full pending payload. IDB stores Blobs natively. */
export async function savePending(record: PendingRecording): Promise<void> {
  try {
    await backend.put(record);
  } catch (err) {
    warn(err);
  }
}

/** Remove a persisted pending row by its recordingId. */
export async function deletePending(recordingId: string): Promise<void> {
  try {
    await backend.delete(recordingId);
  } catch (err) {
    warn(err);
  }
}

/** Load all persisted pending rows for a single user (isolation boundary). */
export async function loadPendingForUser(userId: string): Promise<PendingRecording[]> {
  try {
    return await backend.loadByUser(userId);
  } catch (err) {
    warn(err);
    return [];
  }
}
