//
// Live smoke test for the OpenAI adapter. Hits the real API — costs a few cents.
// Nothing here touches Supabase, your database, or deployed functions.
//
//   OPENAI_API_KEY=sk-... npx tsx scripts/smoke/openai-adapter-smoke.ts
//
// Exercises the four things the unit tests can only mock:
//   1. buffered generate on the `balanced` tier (devotions, chat, transcription)
//   2. streaming generateStream, printing deltas as they land — the riskiest
//      path, since it depends on partial tool-call JSON arriving the way the
//      stream parser expects
//   3. the `deep` tier (gpt-5.6-sol) — the flagship, at its default effort
//   4. the flagship at HIGH reasoning effort — the leg that proves the whole
//      Responses migration: on Chat Completions a forced function tool required
//      reasoning_effort 'none', so this combination was impossible. Waymarks
//      runs exactly this configuration.
//
// Exit code is non-zero if any leg fails, so this is CI-usable as-is.

import { createOpenAIAdapter, type ToolSchema } from '../../supabase/functions/_shared/openai.ts';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set. Export it and re-run:');
  console.error('  OPENAI_API_KEY=sk-... npx tsx scripts/smoke/openai-adapter-smoke.ts');
  process.exit(2);
}

const llm = createOpenAIAdapter({ apiKey, fetch });

const REFLECTION_TOOL: ToolSchema = {
  name: 'emit_reflection',
  description: 'Return a short devotional reflection with its scripture citations.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'citations'],
    properties: {
      reply: { type: 'string', description: 'Two or three sentences of reflection.' },
      citations: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bible references supporting the reflection, e.g. "Psalm 23:1".',
      },
    },
  },
};

const SYSTEM = 'You write brief, grounded devotional reflections. Cite only real Bible references.';
const MESSAGES = [{
  role: 'user' as const,
  content: 'Write a short reflection on finding rest in God when work feels relentless.',
}];

interface Leg { name: string; ok: boolean; detail: string }
const results: Leg[] = [];

async function leg(name: string, run: () => Promise<string>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, ok: true, detail: `${detail}  (${Date.now() - started}ms)` });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

// ── 1. buffered ───────────────────────────────────────────────────────────────
await leg('buffered generate (balanced)', async () => {
  const out = await llm.generate<{ reply: string; citations: string[] }>({
    model: 'balanced', system: SYSTEM, messages: MESSAGES, tool: REFLECTION_TOOL, maxTokens: 1024,
  });
  if (typeof out.parsed?.reply !== 'string' || !out.parsed.reply.trim()) {
    throw new Error('no reply text in parsed artifact');
  }
  if (!Array.isArray(out.parsed.citations)) throw new Error('citations was not an array');
  console.log(`\n[buffered] ${out.modelUsed}\n  ${out.parsed.reply.trim()}`);
  console.log(`  citations: ${out.parsed.citations.join(', ') || '(none)'}`);
  return `${out.modelUsed}, ${out.promptTokens} in / ${out.completionTokens} out`;
});

// ── 2. streaming ──────────────────────────────────────────────────────────────
await leg('streaming generateStream (balanced)', async () => {
  let streamed = '';
  let firstDeltaMs = 0;
  const started = Date.now();
  const fields: string[] = [];

  process.stdout.write('\n[streaming] ');
  const out = await llm.generateStream<{ reply: string; citations: string[] }>(
    {
      model: 'balanced', system: SYSTEM, messages: MESSAGES, tool: REFLECTION_TOOL,
      maxTokens: 1024, textFields: ['reply'],
    },
    {
      onText: (_field, delta) => {
        if (!firstDeltaMs) firstDeltaMs = Date.now() - started;
        streamed += delta;
        process.stdout.write(delta);
      },
      onField: (field) => { fields.push(field); },
    },
  );
  process.stdout.write('\n');

  if (!streamed.trim()) throw new Error('no text deltas arrived — stream parser saw nothing');
  if (out.parsed?.reply !== streamed) {
    throw new Error('assembled artifact does not match the concatenated deltas');
  }
  if (!fields.includes('citations')) throw new Error('citations field never completed');
  // On Responses, usage rides the terminal response.completed event (there is no
  // stream_options opt-in); a zero here means that event was missed or reshaped.
  if (out.completionTokens === 0) throw new Error('usage missing — response.completed carried no usage');
  return `first delta ${firstDeltaMs}ms, ${streamed.length} chars, ${out.promptTokens} in / ${out.completionTokens} out`;
});

// ── 3. flagship tier ──────────────────────────────────────────────────────────
await leg('buffered generate (deep, flagship)', async () => {
  const out = await llm.generate<{ reply: string; citations: string[] }>({
    model: 'deep', system: SYSTEM, messages: MESSAGES, tool: REFLECTION_TOOL, maxTokens: 2048,
  });
  if (typeof out.parsed?.reply !== 'string' || !out.parsed.reply.trim()) {
    // The failure this leg exists to catch: the flagship rejecting or failing
    // the forced tool call.
    throw new Error('empty artifact from the flagship tier');
  }
  console.log(`\n[deep] ${out.modelUsed}\n  ${out.parsed.reply.trim()}`);
  return `${out.modelUsed}, ${out.promptTokens} in / ${out.completionTokens} out`;
});

// ── 4. flagship + high reasoning (the Waymarks configuration) ─────────────────
// This leg is the point of the Responses migration: a forced function tool AND
// reasoning at the same time. It was a 400 on Chat Completions.
await leg('buffered generate (deep, effort=high) — forced tool + reasoning', async () => {
  const out = await llm.generate<{ reply: string; citations: string[] }>({
    model: 'deep', effort: 'high', system: SYSTEM, messages: MESSAGES,
    tool: REFLECTION_TOOL, maxTokens: 8192,
  });
  if (typeof out.parsed?.reply !== 'string' || !out.parsed.reply.trim()) {
    throw new Error('empty artifact from the flagship tier at high effort');
  }
  console.log(`\n[deep · high] ${out.modelUsed}\n  ${out.parsed.reply.trim()}`);
  // Reasoning tokens are billed as output tokens; expect this to exceed leg 3.
  return `${out.modelUsed}, ${out.promptTokens} in / ${out.completionTokens} out (incl. reasoning)`;
});

// ── report ────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(64));
for (const r of results) {
  console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}\n        ${r.detail}`);
}
const failed = results.filter(r => !r.ok).length;
console.log('─'.repeat(64));
console.log(failed ? `${failed} of ${results.length} legs failed.` : `All ${results.length} legs passed.`);
process.exit(failed ? 1 : 0);
