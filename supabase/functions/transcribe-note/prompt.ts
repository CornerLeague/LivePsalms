// supabase/functions/transcribe-note/prompt.ts
import type { ToolSchema } from '../_shared/openai.ts';

export const TRANSCRIBE_SYSTEM = `You are transcribing a handwritten note from a Psalms / Bible-study devotional journal. The writer may reference verses ("Psalm 23:1"), psalm titles, prayers, and scriptural language — use this context to resolve messy handwriting.

Transcribe EXACTLY what is written, preserving line breaks and the writer's own spelling. Do NOT paraphrase, correct, complete, or add commentary. If a word is illegible, give your single best guess and add it to uncertainWords. Never invent text, and never insert Scripture the writer did not write.`;

export const TRANSCRIBE_TOOL: ToolSchema = {
  name: 'record_transcription',
  description: 'Record the exact transcription of the handwritten note.',
  input_schema: {
    type: 'object',
    properties: {
      transcription: { type: 'string', description: 'Exact transcription, line breaks preserved.' },
      confidence: { type: 'number', description: '0–1 overall legibility confidence.' },
      uncertainWords: {
        type: 'array',
        description: 'Words that were hard to read and may be wrong.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The uncertain word as transcribed.' },
            context: { type: 'string', description: '~3 surrounding words to locate it.' },
          },
          required: ['text'],
        },
      },
    },
    required: ['transcription', 'confidence', 'uncertainWords'],
  },
};
