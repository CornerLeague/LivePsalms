// supabase/functions/_shared/stream-json-fields.test.ts
import { describe, it, expect } from 'vitest';
import { createToolJsonStreamParser, type FieldEvent } from './stream-json-fields';

// Feed a full JSON string in arbitrary cuts; collect events.
function run(json: string, cuts: number[], textFields: string[] = []): FieldEvent[] {
  const p = createToolJsonStreamParser({ textFields });
  const events: FieldEvent[] = [];
  let prev = 0;
  for (const c of [...cuts, json.length]) {
    events.push(...p.push(json.slice(prev, c)));
    prev = c;
  }
  events.push(...p.finish());
  return events;
}

describe('createToolJsonStreamParser', () => {
  it('emits complete events for flat string fields in order', () => {
    const json = '{"opening":"hello","prompt":"sit"}';
    const ev = run(json, [10, 20]);
    const completes = ev.filter(e => e.type === 'complete');
    expect(completes).toEqual([
      { type: 'complete', field: 'opening', value: 'hello' },
      { type: 'complete', field: 'prompt', value: 'sit' },
    ]);
  });

  it('parses a nested object value (scripture) as one complete event', () => {
    const json = '{"scripture":{"ref":"Psalm 23:4","text":"Even though"},"prompt":"q"}';
    const ev = run(json, [5, 25, 45]);
    expect(ev).toContainEqual({ type: 'complete', field: 'scripture', value: { ref: 'Psalm 23:4', text: 'Even though' } });
    expect(ev).toContainEqual({ type: 'complete', field: 'prompt', value: 'q' });
  });

  it('parses an array value (note_citations) as one complete event', () => {
    const json = '{"note_citations":[{"note_id":"n1","reason":"a"},{"note_id":"n2","reason":"b"}]}';
    const ev = run(json, [15, 40]);
    expect(ev).toContainEqual({
      type: 'complete', field: 'note_citations',
      value: [{ note_id: 'n1', reason: 'a' }, { note_id: 'n2', reason: 'b' }],
    });
  });

  it('does NOT treat a colliding key substring inside a value as a top-level key', () => {
    // reflection text literally contains the substring "prompt":
    const json = '{"reflection":"see \\"prompt\\": here","prompt":"real"}';
    const ev = run(json, [12, 25, 40]);
    const completes = ev.filter(e => e.type === 'complete').map(e => e.field);
    expect(completes).toEqual(['reflection', 'prompt']);
    expect(ev).toContainEqual({ type: 'complete', field: 'reflection', value: 'see "prompt": here' });
  });

  it('streams text deltas for declared textFields, decoding escapes', () => {
    const json = '{"reply":"line one\\nline two","citations":[]}';
    const ev = run(json, [10, 14, 20, 30], ['reply']);
    const text = ev.filter(e => e.type === 'text' && e.field === 'reply') as Array<{ delta: string }>;
    expect(text.map(t => t.delta).join('')).toBe('line one\nline two');
    // and still emits a final complete for the text field
    expect(ev).toContainEqual({ type: 'complete', field: 'reply', value: 'line one\nline two' });
  });

  it('handles a string split mid-escape across pushes', () => {
    const json = '{"reply":"a\\"b"}';
    // cut right after the backslash
    const ev = run(json, [11], ['reply']);
    const text = ev.filter(e => e.type === 'text') as Array<{ delta: string }>;
    expect(text.map(t => t.delta).join('')).toBe('a"b');
  });
});
