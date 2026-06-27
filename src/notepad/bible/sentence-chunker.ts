// src/notepad/bible/sentence-chunker.ts
//
// Groups streamed text deltas into whole sentence/paragraph chunks so the UI can
// reveal complete units instead of jittering character-by-character. A boundary is
// either a sentence-ender (. ! ?) immediately followed by at least one whitespace
// char, OR a literal paragraph break (\n\n). The emitted chunk INCLUDES the
// boundary punctuation and its trailing whitespace. A trailing sentence-ender with
// no following whitespace is NOT a boundary — it stays buffered until more input
// arrives or flush() is called.

// Matches the FIRST boundary in the buffer:
//   - a sentence-ender + following whitespace ([.!?]\s), captured up to and
//     including that single whitespace char, OR
//   - a literal \n\n.
// `m` lets `.` exclude newlines while still allowing multiline buffers.
const BOUNDARY = /[.!?]\s|\n\n/;

export function createSentenceChunker(): {
  push(delta: string): string[];
  flush(): string;
} {
  let buf = '';

  return {
    push(delta: string): string[] {
      buf += delta;
      const chunks: string[] = [];
      let match: RegExpMatchArray | null;
      // Loop so a single delta containing several boundaries emits several chunks.
      while ((match = buf.match(BOUNDARY)) !== null && match.index !== undefined) {
        const end = match.index + match[0].length;
        chunks.push(buf.slice(0, end));
        buf = buf.slice(end);
      }
      return chunks;
    },
    flush(): string {
      const tail = buf;
      buf = '';
      return tail;
    },
  };
}
