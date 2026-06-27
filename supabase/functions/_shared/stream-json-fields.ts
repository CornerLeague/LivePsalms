// supabase/functions/_shared/stream-json-fields.ts
// Pure streaming parser for the partial JSON object Claude emits as a tool's
// input (input_json_delta). Given a known root object, it identifies top-level
// (depth-1) fields, emits `text` deltas for declared string fields as they
// grow, and a `complete` event (with the JSON-parsed value) when each field
// closes. No I/O, no globals.

export type FieldEvent =
  | { type: 'text'; field: string; delta: string }
  | { type: 'complete'; field: string; value: unknown };

export interface ToolJsonStreamParser {
  push(deltaJson: string): FieldEvent[];
  finish(): FieldEvent[];
}

type Mode =
  | 'before-root'      // before the opening {
  | 'expect-key'       // at depth 1, expecting a key string or }
  | 'in-key'           // reading a depth-1 key string
  | 'expect-colon'
  | 'expect-value'
  | 'in-string-value'  // depth-1 string value
  | 'in-compound'      // depth-1 value is object/array; track until depth returns to 1
  | 'in-primitive';    // number/true/false/null

export function createToolJsonStreamParser(opts: { textFields?: string[] }): ToolJsonStreamParser {
  const textFields = new Set(opts.textFields ?? []);
  let acc = '';
  let i = 0;                 // scan cursor into acc (persists across pushes)
  let mode: Mode = 'before-root';
  let depth = 0;
  let esc = false;
   
  let inCompoundString = false;
  let keyStart = -1;
  let currentKey = '';
  let valueStart = -1;       // index in acc where the current top-level value begins
  let emittedTextLen = 0;    // decoded length already emitted for the active text field

  // Decode the in-progress string value [valueStart..end] (value begins at the
  // opening quote) tolerantly, returning the decoded string so far.
  function decodePartialString(): string {
    let frag = acc.slice(valueStart); // starts with the opening quote
    // Drop a trailing dangling backslash (incomplete escape) so JSON.parse succeeds.
    const trailingBackslashes = frag.length - frag.replace(/\\+$/, '').length;
    if (trailingBackslashes % 2 === 1) frag = frag.slice(0, -1);
    try {
      return JSON.parse(frag + '"') as string;
    } catch {
      return ''; // unparseable mid-stream; wait for more
    }
  }

  function push(deltaJson: string): FieldEvent[] {
    acc += deltaJson;
    const out: FieldEvent[] = [];

    while (i < acc.length) {
      const c = acc[i];

      switch (mode) {
        case 'before-root':
          if (c === '{') { depth = 1; mode = 'expect-key'; }
          i++; break;

        case 'expect-key':
          if (c === '"') { keyStart = i; mode = 'in-key'; i++; }
          else if (c === '}') { depth = 0; i++; }
          else i++; // whitespace, comma
          break;

        case 'in-key':
          if (esc) { esc = false; i++; }
          else if (c === '\\') { esc = true; i++; }
          else if (c === '"') {
            currentKey = JSON.parse(acc.slice(keyStart, i + 1)) as string;
            mode = 'expect-colon'; i++;
          } else i++;
          break;

        case 'expect-colon':
          if (c === ':') mode = 'expect-value';
          i++; break;

        case 'expect-value':
          if (c === ' ' || c === '\n' || c === '\t' || c === '\r') { i++; break; }
          valueStart = i;
          if (c === '"') { mode = 'in-string-value'; emittedTextLen = 0; i++; }
          else if (c === '{' || c === '[') { depth++; mode = 'in-compound'; i++; }
          else { mode = 'in-primitive'; i++; }
          break;

        case 'in-string-value':
          if (esc) { esc = false; i++; }
          else if (c === '\\') { esc = true; i++; }
          else if (c === '"') {
            // string value closed at depth 1
            i++;
            const value = JSON.parse(acc.slice(valueStart, i)) as string;
            if (textFields.has(currentKey)) {
              const tail = value.slice(emittedTextLen);
              if (tail) out.push({ type: 'text', field: currentKey, delta: tail });
            }
            out.push({ type: 'complete', field: currentKey, value });
            mode = 'expect-key';
          } else i++;
          break;

        case 'in-compound':
          if (inCompoundString) {
            // inside a string within the compound — handle char by char
            if (esc) { esc = false; i++; break; }
            if (c === '\\') { esc = true; i++; break; }
            if (c === '"') { inCompoundString = false; i++; break; }
            i++; break;
          }
          // not in a compound string
          if (c === '"') { inCompoundString = true; i++; break; }
          if (c === '{' || c === '[') { depth++; i++; break; }
          if (c === '}' || c === ']') {
            depth--; i++;
            if (depth === 1) {
              const value = JSON.parse(acc.slice(valueStart, i));
              out.push({ type: 'complete', field: currentKey, value });
              mode = 'expect-key';
            }
            break;
          }
          i++; break;

        case 'in-primitive':
          if (c === ',' || c === '}' || c === ' ' || c === '\n' || c === '\t' || c === '\r') {
            const value = JSON.parse(acc.slice(valueStart, i));
            out.push({ type: 'complete', field: currentKey, value });
            mode = (c === '}') ? 'before-root' : 'expect-key';
            if (c === '}') depth = 0;
            i++;
          } else i++;
          break;
      }
    }

    // Mid-string text streaming: emit any newly-decodable suffix of the active
    // text field without waiting for the closing quote.
    if (mode === 'in-string-value' && textFields.has(currentKey)) {
      const decoded = decodePartialString();
      if (decoded.length > emittedTextLen) {
        out.push({ type: 'text', field: currentKey, delta: decoded.slice(emittedTextLen) });
        emittedTextLen = decoded.length;
      }
    }

    return out;
  }

  function finish(): FieldEvent[] { return []; }

  return { push, finish };
}
