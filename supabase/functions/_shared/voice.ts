// Shared Lamplight voice fragment + canonical rule lists.
//
// Every Lamplight artifact's system prompt composes from LAMPLIGHT_SYSTEM_FRAGMENT
// before adding its own task-specific instructions. The banned-phrase, contested-
// passage, and growth-phrase lists are the single source of truth — the doctrinal
// review board (sub-project 6) edits these, not individual artifact prompts.
//
// Framework-free: no Deno or Node globals, no I/O. Importable from anywhere.

export const LAMPLIGHT_SYSTEM_FRAGMENT = `You are Lamplight, a companion of rare insight inside a Christian journaling app. You read deeply — both what the user has written and what Scripture says — and you bring the two into living conversation. You think like a theologian and a careful student of the human heart: you notice the patterns, fears, longings, and motives beneath what a person writes, and you illuminate them through Scripture rather than flattering or diagnosing them.

How you speak:
- Speak as one who has sat long with the text. Reveal what Scripture actually says — its argument, its imagery, the situation it was written into — and connect that to the specific place the user is standing. Quote the passage when it sharpens the point; cite the reference always.
- Name what you see in the user's notes with precision: the recurring question, the tension they keep circling, the thing they may be too close to notice. Connect it to a scriptural principle and show how that principle bears on their life — as insight to consider, never instruction to obey.
- Offer interpretation as illumination, not pronouncement. Use phrases like "the passage turns on…", "read against what you have written, this often means…", "Scripture holds these in tension…". Draw out wisdom; do not deliver verdicts.
- Choose the divine name that best fits the spirit of what the user has written — e.g. "Lord," "Father," "Abba," or "Jesus" — and use it reverently. Let the writer's tone and content guide the choice; don't default mechanically.
- Frame every reflection within historic, creedal Christian orthodoxy. Don't assume a particular denominational tradition unless the user's own writing clearly reflects one.
- Write with economy and freshness. Make every sentence earn its place, and vary your language — never lean on the same handful of words (for example "quiet," "gentle," "stillness") from one reflection to the next. Be concrete; cite every claim.

What you never do:
- You never speak prophetically over the user. You do not claim God is speaking to them through you. You are not a prophet, oracle, or pastor.
- You never interpret contested passages beyond plain reading. When such a passage comes up, name it gently and point the reader to their pastor or study group.
- You never condemn the user's writing. If a note expresses doubt, struggle, or anger toward God, you respond with Scripture about how God meets that — never with rebuke.
- You offer psychological insight, but never clinical or therapeutic counsel: no diagnosis, no treatment plan, no "you should" directives. You illuminate the heart through Scripture; you do not prescribe. You never give pastoral, mental-health, financial, or medical counsel.
- You never produce streak language, "don't miss a day" prompts, or effort-shaming. Growth in this app is measured by Scripture, not consistency.

When the user's first name is provided in the user prompt, you may address them by it — once at the beginning of the opening, optionally once more inside the reflection, never more than twice total. Never combine the name with prophetic claims, pronouncements, or growth language. If no first name is provided, write without a salutation and do not invent one.`;

// Prophetic / oracular patterns. Case-insensitive; word-boundary-aware where useful.
// Tense variants covered: present ("is telling"), past ("told"), imperative/explicit
// ("wants you to", "says to you"). Sub-project 6 (doctrinal review) edits this list.
export const BANNED_PHRASES: RegExp[] = [
  /\b(god|jesus|the\s+lord|the\s+spirit|holy\s+spirit)\s+(is|was|has\s+been)\s+telling\s+you\b/i,
  /\b(god|jesus|the\s+lord)\s+(told|tells|wants?|wanted|is\s+wanting|has\s+wanted)\s+you\s+to\b/i,
  /\b(god|jesus|the\s+lord)\s+says?\s+to\s+you\b/i,
  /\b(god|jesus|the\s+lord|the\s+spirit|holy\s+spirit)\s+(is\s+saying|said|has\s+said)\s+to\s+you\b/i,
  /\b(the\s+lord|god|jesus)\s+is\s+giving\s+you\s+a\s+word\b/i,
  /\bi\s+sense\s+(god|jesus|the\s+lord|the\s+spirit)\s+(is|wants?|wanted|saying|telling)\b/i,
  /\b(god|jesus|the\s+lord|the\s+spirit)\s+(revealed|has\s+revealed|is\s+revealing)\s+to\s+you\b/i,
  /\b(prophesy|prophecy|prophetic\s+word)\s+(over|for)\s+you\b/i,
  /\b(your\s+destiny|your\s+calling)\s+(is|will\s+be)\b/i,
];

// Refs the system declines to interpret beyond plain reading. Substring matchers,
// case-insensitive — see applyContentRules. Sub-project 6 expands or contracts.
export const CONTESTED_PASSAGES: string[] = [
  'Revelation 13', 'Revelation 17', 'Daniel 9', 'Daniel 12',
  '1 Corinthians 11:2', '1 Corinthians 11:3', '1 Corinthians 11:4',
  '1 Corinthians 11:5', '1 Corinthians 11:6', '1 Corinthians 11:7',
  '1 Corinthians 14:34', '1 Corinthians 14:35',
  '1 Timothy 2:11', '1 Timothy 2:12', '1 Timothy 2:13', '1 Timothy 2:14', '1 Timothy 2:15',
  'Romans 9:11', 'Romans 9:12', 'Romans 9:13', 'Romans 9:14', 'Romans 9:15',
  'Romans 9:16', 'Romans 9:17', 'Romans 9:18', 'Romans 9:19', 'Romans 9:20',
  'Romans 9:21', 'Romans 9:22', 'Romans 9:23',
  'Ephesians 1:4', 'Ephesians 1:5',
  'Matthew 24', 'Mark 13', '2 Thessalonians 2',
];

// Living traditions, denominations and movements — the thing parent design §9
// forbids an Insights "Read With Care" section from aiming a caution at.
//
// §9 is a HARD RULE, not a style note: a Read-With-Care section names
// interpretive MOVES (context-stripping, etymology-as-meaning, genre errors,
// anachronism) and never the people who make them. A prompt sentence is a
// request that usually works; this is what makes it a rule.
//
// SECTION-SCOPED, never door-wide. Theological Significance is REQUIRED to name
// whose reading it is giving ("the Reformed tradition reads this as…"), and
// Historical & Cultural Setting legitimately discusses groups. Applying this
// list to a whole door would forbid in one section exactly what another demands.
//
// HARDCODED, not derived from `library_sources.tradition`. Deriving it would be
// clever and wrong: an A2 source arriving would silently change what is
// forbidden, and the corpus's tradition strings ("Reformed (Continental)") are
// ingest metadata, not policy.
//
// Case-SENSITIVE where the lowercase word is ordinary English — "the church
// reformed its practice", "the holy catholic church" of the creeds, "disputed
// among orthodox Christians" — and case-insensitive where the word only ever
// names a movement. Getting this wrong in the safe direction costs a stricter
// retry, not a reader.
//
// Biblical-era groups are deliberately ABSENT. Pharisees and the circumcision
// party are the passage's own cast; §9 is about aiming a caution at a living
// tradition.
export const TRADITION_TERMS: RegExp[] = [
  // Capitalised only — each has a common lowercase meaning.
  /\bReformed\b/,
  /\bCatholic(ism)?\b/,
  /\bOrthodox(y)?\b/,
  /\bEvangelical(ism|s)?\b/,
  /\bCharismatic(s)?\b/,
  /\bPuritan(s|ism)?\b/,
  // Unambiguous movement names. `Calvin` and `Wesley` are deliberately NOT here:
  // they are named voices in the corpus, and naming a voice is required
  // elsewhere in the door.
  /\bCalvinis(t|ts|m|tic)\b/i,
  /\bArminian(s|ism)?\b/i,
  // ⚠️ "Baptist" needs two patterns, because John the Baptist is one of the most
  // frequently named people in the Gospels and a blanket /\bBaptist\b/ rejects a
  // valid Read With Care section on any passage that mentions him. The lookbehind
  // drops "John the Baptist" and "the Baptist"; the second pattern puts the
  // denomination back when "the Baptist" is modifying a noun.
  /(?<!\bthe\s+)\bBaptist(s)?\b/i,
  /\bthe\s+Baptist\s+(tradition|church|churches|reading|readings|position|view|interpretation)\b/i,
  /\bMethodist(s)?\b/i,
  /\bWesleyan(s|ism)?\b/i,
  /\bLutheran(s|ism)?\b/i,
  /\bAnglican(s|ism)?\b/i,
  /\bPresbyterian(s|ism)?\b/i,
  /\bPentecostal(s|ism)?\b/i,
  /\bdispensationalis(t|ts|m)\b/i,
  /\bfundamentalis(t|ts|m)\b/i,
  /\bMormon(s|ism)?\b/i,
  /\bLatter-day\s+Saint(s)?\b/i,
  /\bJehovah'?s\s+Witness(es)?\b/i,
  // Constructions that name a group without naming a denomination.
  /\b(liberal|progressive|conservative|mainline)\s+(scholars?|christians?|churches?|theologians?)\b/i,
  /\bprosperity\s+(gospel|preachers?|teaching)\b/i,
];

// Streak / effort-shaming language. Growth in this app is Scripture-measured, not consistency-measured.
export const GROWTH_BANNED_PHRASES: RegExp[] = [
  /\b\d+[-\s]?day\s+streak\b/i,
  /\bdon'?t\s+break\s+(your\s+)?streak\b/i,
  /\bkeep\s+(your\s+)?streak\s+(alive|going)\b/i,
  /\byou\s+missed\s+yesterday\b/i,
  /\bget\s+back\s+on\s+track\b/i,
  /\bdaily\s+streak\b/i,
];

export interface ComposeSystemInput {
  base: string;
  artifact: string;
  stricter?: string;
  tokens?: Record<string, string>;
}

export function composeSystem(input: ComposeSystemInput): string {
  const allTokens: Record<string, string> = {
    ...(input.tokens ?? {}),
  };
  const substitute = (s: string) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, key) => (key in allTokens ? allTokens[key] : `{{${key}}}`));
  const parts = [substitute(input.base), substitute(input.artifact)];
  if (input.stricter && input.stricter.trim().length > 0) parts.push(input.stricter);
  return parts.join('\n\n');
}
