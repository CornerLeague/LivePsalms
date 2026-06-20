// src/notepad/study/panes/StudyReader.tsx
import { BibleReader } from '@/notepad/bible/BibleReader';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
}

export function StudyReader({ book, chapter, onPassageChange }: StudyReaderProps) {
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      onPassageChange={onPassageChange}
    />
  );
}
