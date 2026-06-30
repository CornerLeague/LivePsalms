import { describe, it, expect } from 'vitest';
import { parseStudyBody } from './parse-body.ts';

describe('parseStudyBody stream flag', () => {
  it('defaults stream to false when absent', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.stream).toBe(false);
  });

  it('parses stream:true when explicitly set', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', stream: true });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.stream).toBe(true);
  });

  it('treats a non-boolean stream as false', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', stream: 'yes' as unknown as boolean });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.stream).toBe(false);
  });
});

describe('parseStudyBody thread_id', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  it('parses a UUID-shaped thread_id', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', thread_id: uuid });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBe(uuid);
  });
  it('leaves threadId undefined when absent', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBeUndefined();
  });
  it('ignores a non-UUID thread_id', () => {
    const out = parseStudyBody({ book: 'jhn', chapter: 10, message: 'hi', thread_id: 'not-a-uuid' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadId).toBeUndefined();
  });
});
