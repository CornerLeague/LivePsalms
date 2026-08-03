import { type Editor } from '@tiptap/core';

// The unified "/" launcher's command registry. Pure data + a pure filter; the
// only editor coupling is inside each `run` closure, which the Suggestion
// plugin invokes with the live editor and the "/query" range to delete.
//
// Scripture commands do NOT re-implement the book/verse pickers — they write
// the existing "/verse " / "/lookup " trigger text and let ScriptureRef's
// shipped matchers take over (see scripture-ref.ts). The launcher is a front
// door, not a rebuild.

export type SlashGroup = 'basic' | 'scripture';

export interface SlashRunContext {
  editor: Editor;
  /** The "/query" span in the doc, deleted before the command's effect runs. */
  range: { from: number; to: number };
}

export interface SlashCommand {
  /** Stable identifier, kebab-case. */
  id: string;
  title: string;
  /** One-line description shown under the title. */
  hint: string;
  group: SlashGroup;
  /** lucide-react icon name; mapped to a component in SlashMenuList. */
  icon: string;
  /** Extra match terms beyond the title (e.g. 'h1', '#', 'bible'). */
  keywords: string[];
  run: (ctx: SlashRunContext) => void;
}

// A block/mark command: delete the "/query" then toggle. Focus first so the
// selection is live when the toggle runs.
const block =
  (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
  ({ editor, range }: SlashRunContext) => {
    fn(editor.chain().focus().deleteRange(range)).run();
  };

export function createSlashCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [
    // ── Basic — block & mark formatting ─────────────────────────────────
    {
      id: 'heading-1', title: 'Heading 1', hint: 'Large section title',
      group: 'basic', icon: 'Heading1', keywords: ['h1', 'title', '#', 'header'],
      run: block((c) => c.toggleHeading({ level: 1 })),
    },
    {
      id: 'heading-2', title: 'Heading 2', hint: 'Medium subheading',
      group: 'basic', icon: 'Heading2', keywords: ['h2', 'subheading', '##', 'header'],
      run: block((c) => c.toggleHeading({ level: 2 })),
    },
    {
      id: 'heading-3', title: 'Heading 3', hint: 'Small subheading',
      group: 'basic', icon: 'Heading3', keywords: ['h3', '###', 'header'],
      run: block((c) => c.toggleHeading({ level: 3 })),
    },
    {
      id: 'bullet-list', title: 'Bullet list', hint: 'A simple bulleted list',
      group: 'basic', icon: 'List', keywords: ['bullet', 'unordered', 'ul', 'point'],
      run: block((c) => c.toggleBulletList()),
    },
    {
      id: 'numbered-list', title: 'Numbered list', hint: 'A list with ordering',
      group: 'basic', icon: 'ListOrdered', keywords: ['numbered', 'ordered', 'ol', '1.'],
      run: block((c) => c.toggleOrderedList()),
    },
    {
      id: 'quote', title: 'Quote', hint: 'Set apart a passage',
      group: 'basic', icon: 'Quote', keywords: ['blockquote', 'citation'],
      run: block((c) => c.toggleBlockquote()),
    },
    {
      id: 'divider', title: 'Divider', hint: 'A horizontal line',
      group: 'basic', icon: 'Minus', keywords: ['hr', 'rule', 'separator', 'line'],
      run: block((c) => c.setHorizontalRule()),
    },
    {
      id: 'bold', title: 'Bold', hint: 'Heavier weight',
      group: 'basic', icon: 'Bold', keywords: ['strong', 'b'],
      run: block((c) => c.toggleBold()),
    },
    {
      id: 'italic', title: 'Italic', hint: 'Slanted emphasis',
      group: 'basic', icon: 'Italic', keywords: ['em', 'i'],
      run: block((c) => c.toggleItalic()),
    },
    {
      id: 'underline', title: 'Underline', hint: 'Underlined text',
      group: 'basic', icon: 'Underline', keywords: ['u'],
      run: block((c) => c.toggleUnderline()),
    },

    // ── Scripture — bridge to the shipped pickers ───────────────────────
    {
      id: 'insert-verse', title: 'Insert verse', hint: 'Pick a book & verse',
      group: 'scripture', icon: 'BookOpen', keywords: ['verse', 'scripture', 'reference', 'bible', 'ref'],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/verse ').run();
      },
    },
    {
      id: 'lookup-verse', title: 'Look up verse', hint: 'Search scripture by its text',
      group: 'scripture', icon: 'Search', keywords: ['lookup', 'search', 'find', 'verse', 'scripture'],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent('/lookup ').run();
      },
    },
  ];

  return commands;
}

// Rank buckets — lower sorts first. Title-prefix beats keyword-prefix beats any
// substring hit; ties keep registry order (stable sort).
function rank(command: SlashCommand, q: string): number {
  const title = command.title.toLowerCase();
  if (title.startsWith(q)) return 0;
  if (command.keywords.some((k) => k.toLowerCase().startsWith(q))) return 1;
  if (title.includes(q)) return 2;
  if (command.keywords.some((k) => k.toLowerCase().includes(q))) return 3;
  return -1;
}

/**
 * Filter + rank the registry for the text typed after "/". An empty (or
 * whitespace-only) query returns every command in registry order. No match
 * returns []. Pure — no editor, no DOM.
 */
export function filterSlashCommands(all: SlashCommand[], query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...all];

  const scored: { command: SlashCommand; score: number; order: number }[] = [];
  all.forEach((command, order) => {
    const score = rank(command, q);
    if (score >= 0) scored.push({ command, score, order });
  });
  scored.sort((a, b) => (a.score - b.score) || (a.order - b.order));
  return scored.map((s) => s.command);
}
