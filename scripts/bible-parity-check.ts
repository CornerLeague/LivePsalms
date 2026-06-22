// scripts/bible-parity-check.ts
// Reports OSIS verse-key differences between a translation and BSB so
// versification gaps surface before launch. Read-only.
//
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... TRANSLATION=KJV \
//   npx tsx scripts/bible-parity-check.ts
import { createClient } from '@supabase/supabase-js';

async function keysFor(supabase: ReturnType<typeof createClient>, translation: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bible_passages')
      .select('id')
      .eq('translation', translation)
      .like('id', '%.%.%') // verse grain only
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: string }>) keys.add(r.id);
    if (data.length < PAGE) break;
  }
  return keys;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const translation = process.env.TRANSLATION ?? 'KJV';
  const [bsb, other] = await Promise.all([keysFor(supabase, 'BSB'), keysFor(supabase, translation)]);
  const missing = [...bsb].filter((k) => !other.has(k));
  const extra = [...other].filter((k) => !bsb.has(k));
  console.log(`${translation}: ${other.size} verse keys; BSB: ${bsb.size}`);
  console.log(`missing in ${translation} (present in BSB): ${missing.length}`, missing.slice(0, 50));
  console.log(`extra in ${translation} (absent in BSB): ${extra.length}`, extra.slice(0, 50));
}
main().catch((e) => { console.error(e); process.exit(1); });
