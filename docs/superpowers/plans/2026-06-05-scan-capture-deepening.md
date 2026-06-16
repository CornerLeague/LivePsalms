# ScanCapture Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the untested scan capture orchestration out of the `ScanCapture.tsx` React component into a node-testable `ScanCapture` controller (Observable + injected deps + generation fence), mirroring the existing `MigrationWorkflow` pattern.

**Architecture:** A pure `ScanCapture` class extends `Observable<ScanCaptureState>` and drives the five-phase machine (`idle → camera → cleaning → transcribing → error`) via command methods. All side effects (camera, canvas, preprocess, upload, transcribe, result/cancel callbacks) arrive through `ScanCaptureDeps`, so the calling sequence — the part that actually breaks — becomes node-testable with `vi.fn` fakes. A thin `useScanCapture` hook wires real browser deps and surfaces state via `useSyncExternalStore`; a thin `ScanCapturePanel` component renders by phase. The old `ScanCapture.tsx` component is deleted and its two mount sites are rewired.

**Tech Stack:** React, TypeScript, Vite, vitest (environment: 'node', globals: false), Supabase (storage + edge functions), existing `Observable<T>` base class.

---

## Background & House Patterns

Read these before starting — the controller MUST mirror them:

- **`src/notepad/collection/observable.ts`** — the `Observable<T>` base. Key surface: constructor takes initial snapshot; `getSnapshot = () => snapshot`; `subscribe = (listener) => unsubscribe`; `protected setState(updater)` compares `next === snapshot` by identity and notifies listeners only on change. Because `setState` is `protected`, subclasses reach it via the documented cast (see below).
- **`src/notepad/storage/migration-workflow.ts`** — THE pattern to mirror. `class MigrationWorkflow extends Observable<MigrationWorkflowState>`, injected `deps`, arrow-function command methods, a `dispose` method, and a private `update(updater)` helper that does the `setState` cast:
  ```ts
  private update(updater: (prev: State) => State): void {
    (this as unknown as { setState: (u: typeof updater) => void }).setState(updater);
  }
  ```
- **`src/notepad/storage/useMigrationWorkflow.tsx`** — the hook pattern: `useRef` for caller callbacks (kept current via assignment), `useMemo(() => new Workflow(deps), [stableKey])`, `useSyncExternalStore(workflow.subscribe, workflow.getSnapshot)`, `useEffect(() => () => workflow.dispose(), [workflow])`.
- **`src/notepad/scan/build-note-from-transcription.test.ts`** — the node-test style reference: `import { describe, it, expect, vi } from 'vitest';` (NO globals), `@` alias resolves to `./src`.
- **`src/notepad/scan/transcription-client.ts`** — the real deps the hook will inject: `isAcceptedImage(mimeType)`, `MAX_IMAGE_BYTES`, `uploadScan(userId, blob)`, `transcribe(userId, imageKey)`.
- **`src/notepad/scan/image-preprocess.ts`** — `preprocessImage(input: Blob): Promise<Blob>`.

**Generation fence (critical):** every async pipeline run captures `const gen = ++this.generation`. After each `await`, it checks `if (gen !== this.generation) return;` before applying state. `cancel()` and `dispose()` bump `this.generation`, so any in-flight pipeline silently drops its remaining work. This mirrors `ConnectionDiscovery` and `PurposeDetailReveal`.

## Behavioral parity with the old component (must preserve)

From the current `src/notepad/components/ScanCapture.tsx`:

- **Phases:** `idle | camera | cleaning | transcribing | error`. Success exits via `onResult(result)` — there is NO `done` phase.
- **`startCamera`**: on `getUserMedia` failure, fall back to the file picker (old code calls `fileRef.current?.click()`). In the controller this becomes `deps.requestFileFallback()`, and the phase stays `idle`.
- **Camera "Back" button**: goes camera → idle (stops the stream but keeps the modal open). This is DISTINCT from cancel (which closes the modal). Controller command: `backToIdle()`.
- **File validation messages (exact strings):**
  - wrong type → `'Please choose a JPG, PNG, or HEIC image.'`
  - too large → `'Image is too large (max 10 MB).'`
- **Pipeline:** `cleaning` (preprocess) → `transcribing` (upload then transcribe) → `onResult`. Any throw sets phase `error` with a message.
- **Error "Try again"** resets to `idle` and clears the error → `reset()`.
- **Cleanup:** unmount stops the camera (old `useEffect(() => () => stopCamera(), [])`). In the controller, `dispose()` stops the camera and bumps the fence.
- **CSS class names must be preserved** (`scan.css` targets `scan-capture`, `scan-capture__choices`, `scan-capture__camera`, `scan-capture__camera-actions`, `scan-capture__busy`, `scan-capture__error`). The panel keeps these.

---

## File Structure

**Create:**
- `src/notepad/scan/scan-capture.ts` — the `ScanCapture` controller class, `classifyScanError`, `SCAN_ERROR_MESSAGES`, and all types (`ScanPhase`, `ScanErrorStage`, `ScanCaptureState`, `ScanCaptureDeps`).
- `src/notepad/scan/scan-capture.test.ts` — node tests for the controller.
- `src/notepad/scan/useScanCapture.ts` — thin hook wiring real browser/transcription deps and exposing `{ state, startCamera, capture, submitFile, backToIdle, reset, cancel, videoRef, fileRef }`.
- `src/notepad/components/ScanCapturePanel.tsx` — thin presentational component (props `{ userId, onResult, onCancel }`) that uses the hook and renders by phase.

**Modify:**
- `src/notepad/components/UploadModal.tsx` — swap import + JSX tag `ScanCapture` → `ScanCapturePanel` (props unchanged).
- `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx` — same swap.
- `docs/CONTEXT.md` — reconcile the `ScanCapture` glossary entry: `classifyScanError(stage, err)` → `classifyScanError(stage)` (err is unused; the message depends only on the stage).

**Delete:**
- `src/notepad/components/ScanCapture.tsx` — its orchestration now lives in the controller; its rendering now lives in `ScanCapturePanel.tsx`.

---

## Task 1: Types, error classification, and the controller skeleton

**Files:**
- Create: `src/notepad/scan/scan-capture.ts`
- Test: `src/notepad/scan/scan-capture.test.ts`

- [ ] **Step 1: Write the failing test for `classifyScanError` and the initial state**

Create `src/notepad/scan/scan-capture.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  ScanCapture,
  classifyScanError,
  SCAN_ERROR_MESSAGES,
  type ScanCaptureDeps,
} from './scan-capture';
import type { TranscriptionResult } from './types';

const RESULT: TranscriptionResult = {
  transcription: 'hello',
  confidence: 0.9,
  uncertainWords: [],
  verseFlags: [],
  transcription_id: 't1',
  imageKey: 'note-scans/u1/x.jpg',
};

function makeDeps(over: Partial<ScanCaptureDeps> = {}): ScanCaptureDeps {
  return {
    openCamera: vi.fn(async () => {}),
    captureFrame: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
    stopCamera: vi.fn(),
    requestFileFallback: vi.fn(),
    preprocess: vi.fn(async (b: Blob) => b),
    upload: vi.fn(async () => 'note-scans/u1/x.jpg'),
    transcribe: vi.fn(async () => RESULT),
    onResult: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function fileOf(type: string, size: number): File {
  return { type, size } as File;
}

describe('classifyScanError', () => {
  it('maps each stage to its message', () => {
    expect(classifyScanError('wrong_type')).toBe(SCAN_ERROR_MESSAGES.wrong_type);
    expect(classifyScanError('too_large')).toBe(SCAN_ERROR_MESSAGES.too_large);
    expect(classifyScanError('preprocess')).toBe(SCAN_ERROR_MESSAGES.preprocess);
    expect(classifyScanError('upload')).toBe(SCAN_ERROR_MESSAGES.upload);
    expect(classifyScanError('transcribe')).toBe(SCAN_ERROR_MESSAGES.transcribe);
  });

  it('uses the exact legacy strings for validation stages', () => {
    expect(SCAN_ERROR_MESSAGES.wrong_type).toBe('Please choose a JPG, PNG, or HEIC image.');
    expect(SCAN_ERROR_MESSAGES.too_large).toBe('Image is too large (max 10 MB).');
  });
});

describe('ScanCapture initial state', () => {
  it('starts idle with no error', () => {
    const sc = new ScanCapture(makeDeps());
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: FAIL — cannot resolve `./scan-capture`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/notepad/scan/scan-capture.ts`:

```ts
import { Observable } from '../collection/observable';
import { isAcceptedImage, MAX_IMAGE_BYTES } from './transcription-client';
import type { TranscriptionResult } from './types';

export type ScanPhase = 'idle' | 'camera' | 'cleaning' | 'transcribing' | 'error';

export type ScanErrorStage =
  | 'wrong_type'
  | 'too_large'
  | 'preprocess'
  | 'upload'
  | 'transcribe';

export interface ScanCaptureState {
  phase: ScanPhase;
  error: string | null;
}

export interface ScanCaptureDeps {
  /** Start the camera stream and attach it to the preview element. Throws on denial. */
  openCamera: () => Promise<void>;
  /** Grab the current video frame as a JPEG blob, then leave the camera as-is. */
  captureFrame: () => Promise<Blob>;
  /** Tear down the camera stream. Safe to call when no stream is active. */
  stopCamera: () => void;
  /** Fallback when the camera cannot start: open the OS file picker. */
  requestFileFallback: () => void;
  preprocess: (input: Blob) => Promise<Blob>;
  upload: (blob: Blob) => Promise<string>;
  transcribe: (imageKey: string) => Promise<TranscriptionResult>;
  onResult: (result: TranscriptionResult) => void;
  onCancel: () => void;
}

export const SCAN_ERROR_MESSAGES: Record<ScanErrorStage, string> = {
  wrong_type: 'Please choose a JPG, PNG, or HEIC image.',
  too_large: 'Image is too large (max 10 MB).',
  preprocess: 'We could not prepare that image. Please try another photo.',
  upload: 'Upload failed. Check your connection and try again.',
  transcribe: 'We could not read that note. Please try a clearer photo.',
};

export function classifyScanError(stage: ScanErrorStage): string {
  return SCAN_ERROR_MESSAGES[stage];
}

export class ScanCapture extends Observable<ScanCaptureState> {
  private readonly deps: ScanCaptureDeps;
  private generation = 0;

  constructor(deps: ScanCaptureDeps) {
    super({ phase: 'idle', error: null });
    this.deps = deps;
  }

  private set(next: ScanCaptureState): void {
    (this as unknown as { setState: (u: (prev: ScanCaptureState) => ScanCaptureState) => void })
      .setState(() => next);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/scan/scan-capture.ts src/notepad/scan/scan-capture.test.ts
git commit -m "feat(scan): add ScanCapture controller skeleton + error classification"
```

---

## Task 2: File validation and the transcription pipeline

**Files:**
- Modify: `src/notepad/scan/scan-capture.ts`
- Test: `src/notepad/scan/scan-capture.test.ts`

- [ ] **Step 1: Write the failing tests for `submitFile` validation + happy-path pipeline**

Append to `src/notepad/scan/scan-capture.test.ts`:

```ts
describe('ScanCapture.submitFile validation', () => {
  it('rejects a wrong file type into the error phase and does not run the pipeline', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('application/pdf', 100));
    expect(sc.getSnapshot()).toEqual({
      phase: 'error',
      error: SCAN_ERROR_MESSAGES.wrong_type,
    });
    expect(deps.preprocess).not.toHaveBeenCalled();
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized file into the error phase', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('image/jpeg', MAX_IMAGE_BYTES + 1));
    expect(sc.getSnapshot()).toEqual({
      phase: 'error',
      error: SCAN_ERROR_MESSAGES.too_large,
    });
    expect(deps.preprocess).not.toHaveBeenCalled();
  });
});

describe('ScanCapture pipeline (happy path)', () => {
  it('runs preprocess → upload → transcribe → onResult, ending idle', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('image/jpeg', 1000));
    expect(deps.preprocess).toHaveBeenCalledTimes(1);
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.transcribe).toHaveBeenCalledWith('note-scans/u1/x.jpg');
    expect(deps.onResult).toHaveBeenCalledWith(RESULT);
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });

  it('maps a preprocess failure to the preprocess stage message', async () => {
    const deps = makeDeps({ preprocess: vi.fn(async () => { throw new Error('boom'); }) });
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('image/jpeg', 1000));
    expect(sc.getSnapshot()).toEqual({
      phase: 'error',
      error: SCAN_ERROR_MESSAGES.preprocess,
    });
    expect(deps.upload).not.toHaveBeenCalled();
  });

  it('maps an upload failure to the upload stage message', async () => {
    const deps = makeDeps({ upload: vi.fn(async () => { throw new Error('net'); }) });
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('image/jpeg', 1000));
    expect(sc.getSnapshot()).toEqual({
      phase: 'error',
      error: SCAN_ERROR_MESSAGES.upload,
    });
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it('maps a transcribe failure to the transcribe stage message', async () => {
    const deps = makeDeps({ transcribe: vi.fn(async () => { throw new Error('ocr'); }) });
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('image/jpeg', 1000));
    expect(sc.getSnapshot()).toEqual({
      phase: 'error',
      error: SCAN_ERROR_MESSAGES.transcribe,
    });
    expect(deps.onResult).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: FAIL — `sc.submitFile is not a function`.

- [ ] **Step 3: Add `submitFile`, `runPipeline`, and `fail` to the controller**

In `src/notepad/scan/scan-capture.ts`, add these methods to the `ScanCapture` class (after `set`):

```ts
  submitFile = async (file: File): Promise<void> => {
    if (!isAcceptedImage(file.type)) {
      this.set({ phase: 'error', error: classifyScanError('wrong_type') });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.set({ phase: 'error', error: classifyScanError('too_large') });
      return;
    }
    await this.runPipeline(file);
  };

  private async runPipeline(blob: Blob): Promise<void> {
    const gen = ++this.generation;

    let cleaned: Blob;
    try {
      this.set({ phase: 'cleaning', error: null });
      cleaned = await this.deps.preprocess(blob);
    } catch {
      this.fail(gen, 'preprocess');
      return;
    }
    if (gen !== this.generation) return;

    let key: string;
    try {
      this.set({ phase: 'transcribing', error: null });
      key = await this.deps.upload(cleaned);
    } catch {
      this.fail(gen, 'upload');
      return;
    }
    if (gen !== this.generation) return;

    let result: TranscriptionResult;
    try {
      result = await this.deps.transcribe(key);
    } catch {
      this.fail(gen, 'transcribe');
      return;
    }
    if (gen !== this.generation) return;

    this.set({ phase: 'idle', error: null });
    this.deps.onResult(result);
  }

  private fail(gen: number, stage: ScanErrorStage): void {
    if (gen !== this.generation) return;
    this.set({ phase: 'error', error: classifyScanError(stage) });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/scan/scan-capture.ts src/notepad/scan/scan-capture.test.ts
git commit -m "feat(scan): file validation + preprocess/upload/transcribe pipeline with stage errors"
```

---

## Task 3: Camera commands and lifecycle (`startCamera`, `capture`, `backToIdle`, `reset`, `cancel`)

**Files:**
- Modify: `src/notepad/scan/scan-capture.ts`
- Test: `src/notepad/scan/scan-capture.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/notepad/scan/scan-capture.test.ts`:

```ts
describe('ScanCapture camera commands', () => {
  it('startCamera opens the camera and moves to the camera phase', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.startCamera();
    expect(deps.openCamera).toHaveBeenCalledTimes(1);
    expect(sc.getSnapshot()).toEqual({ phase: 'camera', error: null });
  });

  it('startCamera falls back to the file picker and stays idle when the camera is denied', async () => {
    const deps = makeDeps({ openCamera: vi.fn(async () => { throw new Error('denied'); }) });
    const sc = new ScanCapture(deps);
    await sc.startCamera();
    expect(deps.requestFileFallback).toHaveBeenCalledTimes(1);
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });

  it('capture grabs a frame, stops the camera, and runs the pipeline to onResult', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.startCamera();
    await sc.capture();
    expect(deps.captureFrame).toHaveBeenCalledTimes(1);
    expect(deps.stopCamera).toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith(RESULT);
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });

  it('backToIdle stops the camera and returns to idle without cancelling', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.startCamera();
    sc.backToIdle();
    expect(deps.stopCamera).toHaveBeenCalled();
    expect(deps.onCancel).not.toHaveBeenCalled();
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });

  it('reset clears an error back to idle', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.submitFile(fileOf('application/pdf', 10));
    expect(sc.getSnapshot().phase).toBe('error');
    sc.reset();
    expect(sc.getSnapshot()).toEqual({ phase: 'idle', error: null });
  });

  it('cancel stops the camera and calls onCancel', async () => {
    const deps = makeDeps();
    const sc = new ScanCapture(deps);
    await sc.startCamera();
    sc.cancel();
    expect(deps.stopCamera).toHaveBeenCalled();
    expect(deps.onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: FAIL — `sc.startCamera is not a function`.

- [ ] **Step 3: Add the camera + lifecycle commands**

In `src/notepad/scan/scan-capture.ts`, add to the `ScanCapture` class (after `submitFile`):

```ts
  startCamera = async (): Promise<void> => {
    try {
      await this.deps.openCamera();
      this.set({ phase: 'camera', error: null });
    } catch {
      this.deps.requestFileFallback();
    }
  };

  capture = async (): Promise<void> => {
    const blob = await this.deps.captureFrame();
    this.deps.stopCamera();
    await this.runPipeline(blob);
  };

  backToIdle = (): void => {
    this.deps.stopCamera();
    this.set({ phase: 'idle', error: null });
  };

  reset = (): void => {
    this.set({ phase: 'idle', error: null });
  };

  cancel = (): void => {
    this.generation++;
    this.deps.stopCamera();
    this.deps.onCancel();
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/scan/scan-capture.ts src/notepad/scan/scan-capture.test.ts
git commit -m "feat(scan): camera + lifecycle commands (startCamera, capture, backToIdle, reset, cancel)"
```

---

## Task 4: `dispose` and the generation fence

**Files:**
- Modify: `src/notepad/scan/scan-capture.ts`
- Test: `src/notepad/scan/scan-capture.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/notepad/scan/scan-capture.test.ts`:

```ts
/** A promise plus its resolver, so a test can hold a dep mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ScanCapture generation fence', () => {
  it('dispose stops the camera and drops an in-flight pipeline result', async () => {
    const gate = deferred<TranscriptionResult>();
    const deps = makeDeps({ transcribe: vi.fn(() => gate.promise) });
    const sc = new ScanCapture(deps);

    const running = sc.submitFile(fileOf('image/jpeg', 1000));
    await flush(); // advance to the awaited transcribe()
    expect(sc.getSnapshot().phase).toBe('transcribing');

    sc.dispose();
    gate.resolve(RESULT); // late resolution after dispose
    await running;

    expect(deps.stopCamera).toHaveBeenCalled();
    expect(deps.onResult).not.toHaveBeenCalled();
    // state is left as-is on dispose; the key point is the result was dropped
    expect(sc.getSnapshot().phase).toBe('transcribing');
  });

  it('cancel during a pipeline drops the result', async () => {
    const gate = deferred<TranscriptionResult>();
    const deps = makeDeps({ transcribe: vi.fn(() => gate.promise) });
    const sc = new ScanCapture(deps);

    const running = sc.submitFile(fileOf('image/jpeg', 1000));
    await flush();
    sc.cancel();
    gate.resolve(RESULT);
    await running;

    expect(deps.onResult).not.toHaveBeenCalled();
    expect(deps.onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: FAIL — `sc.dispose is not a function`.

- [ ] **Step 3: Add `dispose`**

In `src/notepad/scan/scan-capture.ts`, add to the `ScanCapture` class (after `cancel`):

```ts
  dispose = (): void => {
    this.generation++;
    this.deps.stopCamera();
  };
```

- [ ] **Step 4: Run the full controller suite to verify it passes**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run src/notepad/scan/scan-capture.test.ts`
Expected: PASS (all controller tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/scan/scan-capture.ts src/notepad/scan/scan-capture.test.ts
git commit -m "feat(scan): dispose + generation fence drops stale in-flight pipeline results"
```

---

## Task 5: The `useScanCapture` hook

This wires real browser/transcription deps into the controller and exposes state + refs. It is browser-coupled (getUserMedia, canvas) so it is NOT unit-tested — parity is verified in Task 7's browser check.

**Files:**
- Create: `src/notepad/scan/useScanCapture.ts`

- [ ] **Step 1: Create the hook**

Create `src/notepad/scan/useScanCapture.ts`:

```ts
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ScanCapture, type ScanCaptureDeps, type ScanCaptureState } from './scan-capture';
import { preprocessImage } from './image-preprocess';
import { uploadScan, transcribe as transcribeNote } from './transcription-client';
import type { TranscriptionResult } from './types';

interface Options {
  userId: string;
  onResult: (result: TranscriptionResult) => void;
  onCancel: () => void;
}

export interface UseScanCapture {
  state: ScanCaptureState;
  startCamera: () => Promise<void>;
  capture: () => Promise<void>;
  submitFile: (file: File) => Promise<void>;
  backToIdle: () => void;
  reset: () => void;
  cancel: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  fileRef: React.RefObject<HTMLInputElement>;
}

export function useScanCapture({ userId, onResult, onCancel }: Options): UseScanCapture {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Keep caller callbacks current without rebuilding the controller.
  const onResultRef = useRef(onResult);
  const onCancelRef = useRef(onCancel);
  onResultRef.current = onResult;
  onCancelRef.current = onCancel;

  const controller = useMemo(() => {
    const stopCamera = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    const deps: ScanCaptureDeps = {
      openCamera: async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
      },
      captureFrame: async () => {
        const video = videoRef.current;
        if (!video) throw new Error('no video element');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        const blob = await new Promise<Blob | null>((r) =>
          canvas.toBlob(r, 'image/jpeg', 0.92),
        );
        if (!blob) throw new Error('capture failed');
        return blob;
      },
      stopCamera,
      requestFileFallback: () => fileRef.current?.click(),
      preprocess: (input) => preprocessImage(input),
      upload: (blob) => uploadScan(userId, blob),
      transcribe: (imageKey) => transcribeNote(userId, imageKey),
      onResult: (result) => onResultRef.current(result),
      onCancel: () => onCancelRef.current(),
    };

    return new ScanCapture(deps);
  }, [userId]);

  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    state,
    startCamera: controller.startCamera,
    capture: controller.capture,
    submitFile: controller.submitFile,
    backToIdle: controller.backToIdle,
    reset: controller.reset,
    cancel: controller.cancel,
    videoRef,
    fileRef,
  };
}
```

- [ ] **Step 2: Typecheck the hook**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc --noEmit`
Expected: no errors from `useScanCapture.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/scan/useScanCapture.ts
git commit -m "feat(scan): useScanCapture hook wiring real browser deps to the controller"
```

---

## Task 6: `ScanCapturePanel` component + rewire mount sites + delete old component

**Files:**
- Create: `src/notepad/components/ScanCapturePanel.tsx`
- Modify: `src/notepad/components/UploadModal.tsx`
- Modify: `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`
- Delete: `src/notepad/components/ScanCapture.tsx`

- [ ] **Step 1: Create the panel**

Create `src/notepad/components/ScanCapturePanel.tsx`:

```tsx
import '../scan/scan.css';
import { useScanCapture } from '../scan/useScanCapture';
import type { TranscriptionResult } from '../scan/types';

interface Props {
  userId: string;
  onResult: (result: TranscriptionResult) => void;
  onCancel: () => void;
}

export function ScanCapturePanel({ userId, onResult, onCancel }: Props) {
  const scan = useScanCapture({ userId, onResult, onCancel });
  const { phase, error } = scan.state;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void scan.submitFile(file);
  }

  return (
    <div className="scan-capture" role="dialog" aria-label="Scan handwritten note">
      <input
        ref={scan.fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onFile}
      />

      {phase === 'idle' && (
        <div className="scan-capture__choices">
          <button onClick={() => void scan.startCamera()}>Take photo</button>
          <button onClick={() => scan.fileRef.current?.click()}>Choose photo</button>
          <button onClick={scan.cancel}>Cancel</button>
        </div>
      )}

      {phase === 'camera' && (
        <div className="scan-capture__camera">
          <video ref={scan.videoRef} playsInline muted aria-label="Camera preview" />
          <div className="scan-capture__camera-actions">
            <button onClick={() => void scan.capture()}>Capture</button>
            <button onClick={scan.backToIdle}>Back</button>
          </div>
        </div>
      )}

      {(phase === 'cleaning' || phase === 'transcribing') && (
        <div className="scan-capture__busy" aria-live="polite">
          {phase === 'cleaning' ? 'Cleaning up image…' : 'Reading your handwriting…'}
        </div>
      )}

      {phase === 'error' && (
        <div className="scan-capture__error" role="alert">
          <p>{error}</p>
          <button onClick={scan.reset}>Try again</button>
          <button onClick={scan.cancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewire `UploadModal.tsx`**

In `src/notepad/components/UploadModal.tsx`:

Change the import (line ~23):
```tsx
import { ScanCapture } from './ScanCapture';
```
to:
```tsx
import { ScanCapturePanel } from './ScanCapturePanel';
```

Change the JSX usage (line ~330) from:
```tsx
              <ScanCapture
                userId={user.id}
                onResult={(result) => setScan({ review: result })}
                onCancel={() => setScan(null)}
              />
```
to:
```tsx
              <ScanCapturePanel
                userId={user.id}
                onResult={(result) => setScan({ review: result })}
                onCancel={() => setScan(null)}
              />
```

- [ ] **Step 3: Rewire `MobileNotepadWorkspace.tsx`**

In `src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx`:

Change the import (line ~21):
```tsx
import { ScanCapture } from '../../../../notepad/components/ScanCapture';
```
to:
```tsx
import { ScanCapturePanel } from '../../../../notepad/components/ScanCapturePanel';
```

Change the JSX usage (line ~195) from:
```tsx
            <ScanCapture
              userId={model.user.id}
              onResult={(result) => setScan({ review: result })}
              onCancel={() => setScan(null)}
            />
```
to:
```tsx
            <ScanCapturePanel
              userId={model.user.id}
              onResult={(result) => setScan({ review: result })}
              onCancel={() => setScan(null)}
            />
```

- [ ] **Step 4: Delete the old component**

```bash
cd /Users/newmac/Downloads/Psalms_app
git rm src/notepad/components/ScanCapture.tsx
```

- [ ] **Step 5: Verify nothing else references the old component**

Run: `cd /Users/newmac/Downloads/Psalms_app && grep -rn "components/ScanCapture'" src/ ; grep -rn "[^a-zA-Z]ScanCapture[^P]" src/ --include="*.tsx" --include="*.ts" | grep -v scan-capture | grep -v ScanCapturePanel`
Expected: no remaining import of `./ScanCapture` or `components/ScanCapture`; the only `ScanCapture` identifiers left are the controller class import in `useScanCapture.ts` and `scan-capture.test.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add src/notepad/components/ScanCapturePanel.tsx src/notepad/components/UploadModal.tsx src/components/sections/notepad/mobile/MobileNotepadWorkspace.tsx
git commit -m "refactor(scan): render via ScanCapturePanel + useScanCapture; delete old ScanCapture component"
```

---

## Task 7: Reconcile CONTEXT.md and full verification

**Files:**
- Modify: `docs/CONTEXT.md`

- [ ] **Step 1: Reconcile the glossary signature**

In `docs/CONTEXT.md`, in the `## ScanCapture` entry, change any reference to `classifyScanError(stage, err)` to `classifyScanError(stage)` (the `err` argument is unused; the message depends only on the stage). Also confirm the entry's component name reads `ScanCapturePanel` (renamed from `ScanCapture`) and the hook reads `useScanCapture`.

- [ ] **Step 2: Run the full unit suite**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx vitest run`
Expected: all tests pass, including `src/notepad/scan/scan-capture.test.ts`.

- [ ] **Step 3: Typecheck and build**

Run: `cd /Users/newmac/Downloads/Psalms_app && npx tsc --noEmit && npm run build`
Expected: typecheck clean; build succeeds.

- [ ] **Step 4: Browser parity check (manual via dev server)**

Run: `cd /Users/newmac/Downloads/Psalms_app && npm run dev`

In the browser, open the notepad → Upload/Scan flow and verify against the old behavior:
- "Take photo" → camera preview appears (or, if the camera is denied/unavailable, the OS file picker opens and the view stays on the choices).
- From the camera, "Capture" → "Cleaning up image…" → "Reading your handwriting…" → review pane shows the transcription.
- From the camera, "Back" → returns to the choices (modal stays open).
- "Choose photo" with a non-image (e.g. a PDF) → error: "Please choose a JPG, PNG, or HEIC image."; "Try again" returns to choices.
- "Cancel" closes the scan flow.
- Repeat on the mobile workspace (`MobileNotepadWorkspace`) entry point.

If any behavior diverges, fix the controller or panel and re-run Steps 2–4.

- [ ] **Step 5: Commit**

```bash
cd /Users/newmac/Downloads/Psalms_app
git add docs/CONTEXT.md
git commit -m "docs(scan): reconcile CONTEXT.md ScanCapture entry with implemented controller"
```

---

## Self-Review

- **Spec coverage:** five-phase machine (Tasks 1–3), file validation with exact legacy strings (Task 2), preprocess/upload/transcribe pipeline with stage-tagged errors (Task 2), camera fallback to file picker (Task 3), camera "Back" → idle distinct from cancel (Task 3), generation fence on cancel/dispose (Task 4), hook + panel parity (Tasks 5–6), both mount sites rewired + old component deleted (Task 6), CONTEXT.md reconciled (Task 7). ✓
- **Type consistency:** `ScanCaptureDeps` member names (`openCamera`, `captureFrame`, `stopCamera`, `requestFileFallback`, `preprocess`, `upload`, `transcribe`, `onResult`, `onCancel`) are identical across the controller (Task 1), every test factory `makeDeps` (Task 1), and the hook (Task 5). `classifyScanError(stage)` single-arg everywhere. Command method names (`startCamera`, `capture`, `submitFile`, `backToIdle`, `reset`, `cancel`, `dispose`) match across controller, hook, and panel. ✓
- **No placeholders:** every code step contains the full code; every run step has an exact command and expected result. ✓
