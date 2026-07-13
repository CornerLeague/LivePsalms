// src/notepad/study/panes/StudyReader.tsx
import { BibleReader, type VerseRef } from '@/notepad/bible/BibleReader';
import { useBiblePrefs } from '@/notepad/bible/prefs/bible-prefs-context';
import { useMemorizeCards } from '@/notepad/study/memorize/useMemorizeCards';

export interface StudyReaderProps {
  book: string;
  chapter: number;
  onPassageChange: (ref: { book: string; chapter: number }) => void;
  onSelectVerse?: (ref: VerseRef) => void;
}

export function StudyReader({ book, chapter, onPassageChange, onSelectVerse }: StudyReaderProps) {
  const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();
  const { addCards } = useMemorizeCards();
  return (
    <BibleReader
      initialBook={book}
      initialChapter={chapter}
      translation={translation}
      onTranslationChange={setLocalTranslation}
      verseLayout={verseLayout}
      onVerseLayoutChange={setLocalVerseLayout}
      onPassageChange={onPassageChange}
      onSelectVerse={onSelectVerse}
      onAddToMemorize={(ref, text) => { void addCards([{ ...ref, translation, text }]); }}
      verseNumberColor="var(--study-verse-num)"
    />
  );
}
