// src/notepad/study/panes/StudyReader.tsx
import { BibleReader } from '@/notepad/bible/BibleReader';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
}

export function StudyReader({ book, chapter, onPassageChange }: StudyReaderProps) {
  const { translation, setTranslation, verseLayout, setVerseLayout } = useBiblePrefs();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setTranslation}
      verseLayout={verseLayout}
      onVerseLayoutChange={setVerseLayout}
      onPassageChange={onPassageChange}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
