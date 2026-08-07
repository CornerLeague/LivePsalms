// Ambient declarations that let `tsc` read the Deno edge functions.
//
// The ten `*/index.ts` shells were the last thing in the repo no typechecker
// looked at, and that gap has now produced two shipped bugs: `DOOR_REGISTERS`,
// an identifier defined nowhere on Door 1's generate path, which reached `main`
// through a squash; and an undefined `doorEntry` in the eval harness. Both are
// TS2304s a compiler reports instantly.
//
// The obstacle was never the code — it was three remote specifiers and one
// global that Node-flavoured TypeScript cannot resolve. Deno resolves them at
// runtime; this file resolves them at compile time.
//
// ⚠️ THESE ARE COMPILE-TIME SHIMS, NOT THE RUNTIME CONTRACT. Deno is still the
// only thing that actually runs this code, so a declaration here that drifts
// from what the module really exports buys a green typecheck and a runtime
// failure — strictly worse than no check. So each one is deliberately NARROW:
// it declares only the members these functions actually use, and widening it is
// a decision someone makes on purpose rather than a default that crept in.
//
// The narrowness is also the safety property. `serve` below takes exactly the
// handler shape the shells pass; if a shell starts using a second overload or a
// different option bag, this file goes red rather than silently accepting it.

/**
 * `Deno.env`, which is all these functions touch — 19 `Deno.env.get()` calls
 * plus 19 places the object itself is handed to a helper.
 *
 * The shape matches what `resolveAllowedOrigins` and `resolveQuotaLimits`
 * already declare as their parameter, so the shells' existing call sites
 * typecheck against the helpers rather than against `any`.
 */
declare const Deno: {
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
};

/**
 * The Deno standard library's HTTP server, imported by all ten shells.
 *
 * Pinned at the same version the code imports. A version bump in a shell will
 * fail to resolve here until this declaration is bumped too — which is the
 * intended friction, because a std bump is exactly the kind of change that
 * should not pass unnoticed.
 */
declare module 'https://deno.land/std@0.224.0/http/server.ts' {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void;
}

/** Used by `transcribe-note` to hand audio to the transcription API. */
declare module 'https://deno.land/std@0.224.0/encoding/base64.ts' {
  export function encodeBase64(data: ArrayBuffer | Uint8Array | string): string;
  export function decodeBase64(b64: string): Uint8Array;
}

/**
 * `_shared/supabase.ts` imports the client through a `jsr:` specifier, which
 * Deno resolves and Node does not. The package is in `node_modules` for the
 * app's own use, so the declaration forwards to it rather than restating an API
 * surface this repo does not own — the one case where widening is safer than
 * narrowing, because the real types are right there.
 */
declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
