// src/notepad/study/panes/StudyReader.tsx
import { BibleReader, type VerseRef } from '@/notepad/bible/BibleReader';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
  onSelectVerse?: (ref: VerseRef) => void;
}

export function StudyReader({ book, chapter, onPassageChange, onSelectVerse }: StudyReaderProps) {
  const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout, textSize, setLocalTextSize } = useBiblePrefs();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setLocalTranslation}
      verseLayout={verseLayout}
      onVerseLayoutChange={setLocalVerseLayout}
      textSize={textSize}
      onTextSizeChange={setLocalTextSize}
      onPassageChange={onPassageChange}
      onSelectVerse={onSelectVerse}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
