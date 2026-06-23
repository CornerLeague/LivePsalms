// parse-body.ts — extracted so unit tests can import without the Deno serve URL.
export const VALID_TRANSLATIONS = ['BSB', 'KJV', 'WEB'] as const;
export type Translation = (typeof VALID_TRANSLATIONS)[number];

export type ParsedStudyBody =
  | { ok: true; book: string; chapter: number; message: string; mode: 'chat' | 'insight'; includeNotes: boolean; noteIds: string[]; translation?: Translation }
  | { ok: false };

export function parseStudyBody(body: {
  book?: unknown; chapter?: unknown; message?: unknown; mode?: unknown;
  include_notes?: unknown; note_ids?: unknown; translation?: unknown;
}): ParsedStudyBody {
  const mode = body.mode === 'insight' ? 'insight' : 'chat';
  if (typeof body.book !== 'string' || typeof body.chapter !== 'number') return { ok: false };
  if (mode === 'chat' && (typeof body.message !== 'string' || !body.message.trim())) return { ok: false };
  return {
    ok: true,
    book: body.book,
    chapter: body.chapter,
    message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '',
    mode,
    includeNotes: body.include_notes === true,
    noteIds: Array.isArray(body.note_ids) ? body.note_ids.filter((x): x is string => typeof x === 'string') : [],
    translation: (typeof body.translation === 'string' && (VALID_TRANSLATIONS as readonly string[]).includes(body.translation)) ? body.translation as Translation : undefined,
  };
}
