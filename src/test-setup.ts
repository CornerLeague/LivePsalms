/// <reference types="@testing-library/jest-dom" />
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// @supabase/realtime-js (pulled in transitively by src/lib/supabase.ts) resolves
// a WebSocket constructor the instant the client is constructed, and throws on
// Node < 22, where there's no global WebSocket — so merely importing the client
// crashes node-environment suites. The app never opens a realtime channel; the
// RealtimeClient exists only as a side effect of createClient and is never
// connected, so a stub constructor that satisfies the factory's presence check
// (it is never instantiated) is enough. Guarded so a genuine WebSocket — a
// browser-like jsdom, or Node 22+ — always wins.
if (typeof globalThis.WebSocket === 'undefined') {
  Reflect.set(globalThis, 'WebSocket', class WebSocketStub {});
}

// Only extend matchers in jsdom environment
if (typeof window !== 'undefined') {
  expect.extend(matchers);

  // jsdom does not implement HTMLMediaElement play/pause. Stub them so
  // tests that mount <video>/<audio> elements don't spam stderr with
  // "Not implemented" warnings. Tests that need to assert play/pause
  // behavior can still vi.spyOn() these prototype methods.
  if (typeof HTMLMediaElement !== 'undefined') {
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      /* no-op */
    };
  }
}
