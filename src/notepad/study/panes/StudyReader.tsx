// src/notepad/study/panes/StudyReader.tsx
import { BibleReader } from '@/notepad/bible/BibleReader';
import { useBibleTranslation } from '@/notepad/bible/useBibleTranslation';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
}

export function StudyReader({ book, chapter, onPassageChange }: StudyReaderProps) {
  const { translation, setTranslation } = useBibleTranslation();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setTranslation}
      onPassageChange={onPassageChange}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
