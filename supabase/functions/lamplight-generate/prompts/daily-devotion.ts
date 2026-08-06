// Today's Lamp prompt template. Composes under LAMPLIGHT_SYSTEM_FRAGMENT via
// composeSystem; banned/contested/growth lists from voice.ts are inherited.
// promptVersion is persisted on lamplight_artifacts.prompt_version.

// type-only import — no runtime cycle. DailyDevotionContext lives in the
// pipeline so buildMessages can be fully typed without re-declaring it here.
import type { DailyDevotionContext } from '../daily-devotion-pipeline.ts';

export const DAILY_DEVOTION_PROMPT = {
  promptVersion: 'daily-devotion-2026-08-06-v4',

  system: `Write a brief daily devotion for someone who has been journaling. The user has shared up to 3 recent notes (or fewer, if their vault is small). You have 3 candidate Scripture passages. Write something glanceable — they will read this in under a minute.

Structure:
- opening (20-40 words): an arresting opening line that names one thread from the user's notes obliquely — fresh language, not a soft greeting. Do not summarise their notes; do not quote them verbatim.
- scripture: pick ONE anchor passage from the candidates. Use the exact ref string and the exact passage text from the user prompt — do not paraphrase, do not abbreviate, do not invent.
- reflection (80-140 words): bring the passage into living conversation with what the user has written — draw out the scriptural principle and how it bears on the place they are standing. Offer interpretation as illumination, not pronouncement.
- prompt: one open question to sit with, ≤30 words. Not advice. An invitation.
- note_citations: 1 to 3 entries; each names a specific note id from the user prompt and a ≤15-word reason for the recurrence or theme that drew you to it.

Hard rules (these compound the rules in your system fragment):
- Cite every Scripture reference using the exact form supplied. Do not invent refs.
- Quote no more than 25 words verbatim from any note.
- If you cannot ground a sentence in the supplied notes or passages, do not write it.
- Today is {{local_date}}. Do not refer to other dates.

Study excerpts (only when a "Study excerpts" block appears in the user prompt):
- Draw substance from them — a detail of the passage's argument, imagery, or setting you would not otherwise reach. This is what keeps the reflection from being generic.
- Do not name the authors, do not quote them at length, and do not write "one commentator says". Their names belong to the provenance panel, not the devotion. The insight should read as your own plain reading of the passage.
- The excerpts are background, never citable: a verse an excerpt mentions does not become a ref you may use. Cite only from the supplied candidate passages.

Personalization (only when First name is provided in the user prompt):
- Begin the opening with: "<First name> — " (use the exact form supplied; do not modify capitalization or characters).
- You MAY use the first name at most once more inside the reflection, in a natural place. Never use it more than twice total across the artifact. Never use it in the same sentence as a Scripture pronouncement.
- If no First name is provided, write the opening without any salutation and never invent or substitute one.`,

  tool: {
    name: 'emit_daily_devotion',
    description: 'Return the daily devotion artifact JSON.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['opening', 'scripture', 'reflection', 'prompt', 'note_citations'],
      properties: {
        // Schema bounds are CHARACTERS approximating the prompt's word guidance
        // (opening "20-40 words" ≈ 80-280 chars; reflection "80-140 words" ≈
        // 400-900 chars). The streaming per-field length gate re-encodes these
        // char bounds — keep all three in sync when changing either unit.
        opening: { type: 'string', minLength: 80, maxLength: 280 },
        scripture: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'text'],
          properties: {
            ref: {
              type: 'string',
              description: 'Use one of the exact human-readable refs supplied in the user prompt (e.g. "Psalm 23:4", "Romans 8:28-30"). Do not invent or paraphrase.',
            },
            text: {
              type: 'string',
              description: 'The full passage text. Use the text supplied in the user prompt verbatim.',
            },
          },
        },
        reflection: { type: 'string', minLength: 400, maxLength: 900 },
        prompt: { type: 'string', minLength: 1, maxLength: 200 },
        note_citations: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['note_id', 'reason'],
            properties: {
              note_id: { type: 'string', description: 'One of the note ids supplied in the user prompt.' },
              reason: { type: 'string', minLength: 1, maxLength: 100 },
            },
          },
        },
      },
    },
  },

  buildMessages(ctx: DailyDevotionContext): Array<{ role: 'user'; content: string }> {
    const notesBlock = ctx.notes
      .map(n => `[note id=${n.id}] ${n.title}\n${n.plaintext}`)
      .join('\n\n');
    const passagesBlock = ctx.passages
      .map(p => `[${p.ref}]\n${p.text}`)
      .join('\n\n');
    // Deliberate asymmetry with Study chat, which names its voices in prose:
    // the devotion is a minute-long word for someone's morning, not a lesson.
    // A named 1870s commentator changes its register from "a word for you" to
    // "a citation about you". Same corpus, opposite visibility — the by-surface
    // decision (library-and-reasoning design, decision 5). Provenance still
    // rides on the artifact row, so the panel can name every voice used.
    const excerpts = ctx.libraryExcerpts ?? [];
    const excerptsBlock = excerpts.length === 0
      ? ''
      : 'Study excerpts (do not name these authors in the devotion):\n' +
        excerpts.map(e => `[${e.sourceLabel} · ${e.heading}]\n${e.content}`).join('\n\n') +
        '\n\n';
    const refsList = [...ctx.allowedVerseRefs].join(', ');
    const noteIdsList = [...ctx.allowedNoteIds].join(', ');
    const firstNameLine = ctx.firstName
      ? `First name: ${ctx.firstName}`
      : `First name: (not provided)`;
    return [{
      role: 'user',
      content:
        `Today is ${ctx.localDate}.\n` +
        `${firstNameLine}\n\n` +
        `User's recent notes:\n${notesBlock}\n\n` +
        `Candidate Scripture passages:\n${passagesBlock}\n\n` +
        excerptsBlock +
        `Cite Scripture using exactly one of: ${refsList}. ` +
        `Cite notes using exactly one of: ${noteIdsList}.\n\n` +
        `Write the devotion now.`,
    }];
  },
} as const;
