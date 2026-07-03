// Test doubles for browser media APIs (absent/limited in jsdom).
// Imported only by *.test.tsx files — never by shipped code.
import { vi } from 'vitest';

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type.startsWith('audio/webm'));
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  stream: MediaStream;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start = vi.fn(() => { this.state = 'recording'; });
  pause = vi.fn(() => { this.state = 'paused'; });
  resume = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
    this.onstop?.();
  });
}

export class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  #listeners = new Map<string, Set<() => void>>();
  constructor() {
    FakeAudio.instances.push(this);
  }
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  addEventListener(type: string, fn: () => void) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.#listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    this.#listeners.get(type)?.forEach((fn) => fn());
  }
}

/** Install fakes on window/navigator; returns a restore function. */
export function installMediaFakes() {
  FakeMediaRecorder.instances = [];
  FakeAudio.instances = [];
  const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => fakeStream);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('Audio', FakeAudio);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  return { getUserMedia, restore: () => vi.unstubAllGlobals() };
}
