export const copy = {
  section01: {
    eyebrow: '— FAITH-BASED DIGITAL NOTEBOOK —',
    h1: 'Your Walk with God isn’t just a Journey, it’s a Story.',
    sub: 'We have carefully crafted an all-in-one digital notebook made to empower your time with God.',
    activeFormLabel: 'ACTIVE FORM',
    shapeNames: ['Pencil', 'Heart', 'Notebook'] as const,
    ctaPrimary: 'Open your notebook →',
    ctaGhost: 'Read what it does',
    ctaNote: 'No account needed to start. Works offline.',
  },
  section02: {
    eyebrow: '— ALL-IN-ONE NOTEBOOK —',
    h2: 'Psalm 119 calls the word a lamp to your feet. A lamp doesn’t flood the entire road. It lights the next step.',
    body: 'The word from that conference. The verse that got you through last spring. It’s scattered across a notes app, three journals, and a sermon bulletin in a drawer.',
    supporting:
      'You don’t need another app to write in. You need one that keeps what you write — and shows you how it all connects.',
  },
  section03: {
    eyebrow: '— CAPTURE —',
    h2: 'We make taking notes effortless, so you actually stay in the moment.',
    points: [
      'Type /verse and the passage drops right into your note.',
      'Cannot remember a reference but you know the words, just type /lookup and the phrase and it finds the verse for you.',
      'Your notes file themselves into the right place on their own.',
      'Bring in your current notes, whether handwritten or living on another app, with ease.',
    ] as const,
  },
  section04: {
    eyebrow: '— LAMPLIGHT —',
    h2: 'Most apps wait for you to type. This one already knows.',
    body: 'Today’s Lamp is a single morning, afternoon, or evening card — built from your own recent notes, anchored in scripture, written for the season you’re actually in.',
    supporting: 'Not a verse-of-the-day. A word for where you are.',
    detail: 'It shows its work: every line names the note and the verse it came from.',
    cta: 'Open your notebook →',
  },
  section05: {
    eyebrow: '— LAMPLIGHT AI —',
    h2: 'Your own Biblical AI to help you in your walk and navigate through the Word.',
    body: 'Lamplight Study is there for the question that comes up mid-reading. Ask it anything, broad or specific, and it helps you make theological and biblical connections, without making you leave the page to go searching for it.',
  },
  section06: {
    eyebrow: '— SPIRITUAL CANVAS —',
    h2: 'A page that actually looks like yours.',
    body: 'Highlight in textures that read like real ink. Drop hand-drawn arrows and marks anywhere on the page. Sort it into folders with their own color and icon. Make it feel more you.',
  },
  section07: {
    eyebrow: '— AUDIO PRESENCE —',
    h2: 'Capture the room, not just your writing.',
    body: 'Record a voice note, a sermon, a bible study. You shouldn’t have to choose between being present and remembering.',
  },
  section08: {
    eyebrow: '— WHAT IS YOURS, STAYS YOURS —',
    h2: 'It’s your personal journey. Your prayer life. Your intimate walk with God.',
    supporting: 'We built it to stay that way.',
    lines: [
      'Lamplight stays off until you invite it.',
      'It never trains on your notes.',
      'Every insight is cited — note, verse, date.',
      'One tap deletes everything it’s ever read.',
      'Start with no account. Write fully offline.',
    ] as const,
  },
  section09: {
    h2: 'The first page is open.',
    ctaPrimary: 'Open your notebook →',
    ctaSecondary: 'Already writing? Sign in →',
  },
} as const;

export type Copy = typeof copy;
