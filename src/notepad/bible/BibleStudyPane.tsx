// src/notepad/bible/BibleStudyPane.tsx
import { useCallback, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAuthSession } from '@/auth/context/useAuthSession';
import { useLamplightSettings } from '@/notepad/hooks/useLamplightSettings';
import { useLamplightEntitlement } from '@/notepad/hooks/useLamplightEntitlement';
import type { LamplightAdapter } from '@/notepad/storage/lamplight-adapter';
import { SignInGate } from '@/notepad/components/lamplight/SignInGate';
import { PaywallCard } from '@/notepad/components/lamplight/PaywallCard';
import { LamplightChat } from '@/notepad/components/lamplight/chat/LamplightChat';
import type { InvokeFn } from './lamplight-chat-client';
import { BibleReader, type PassageRef } from './BibleReader';
import { useBiblePrefs } from './prefs/bible-prefs-context';
import { useBibleHighlights } from './highlights/useBibleHighlights';
import { bookByAbbrev } from './bible-books';
import { SplitResizeHandle } from './SplitResizeHandle';
import { useDragResize } from './useDragResize';
import { loadBiblePassage, saveBiblePassage } from '@/notepad/session/session-storage';

export interface BibleStudyPaneProps {
  lamplightAdapter: LamplightAdapter | null;
  invoke: InvokeFn;
}

export function BibleStudyPane({ lamplightAdapter, invoke }: BibleStudyPaneProps) {
  const { user } = useAuthSession();
  const userId = user?.id ?? null;
  const [chatOpen, setChatOpen] = useState(false);
  const [passage, setPassage] = useState<PassageRef>(() => {
    const stored = loadBiblePassage();
    if (stored) {
      const meta = bookByAbbrev(stored.book);
      // Only restore when the book is real and the chapter is in range.
      if (meta && stored.chapter >= 1 && stored.chapter <= meta.chapterCount) {
        return { book: stored.book, chapter: stored.chapter };
      }
    }
    return { book: 'jhn', chapter: 1 };
  });
  const splitRef = useRef<HTMLDivElement | null>(null);
  const { fraction, handleProps } = useDragResize(splitRef);

  // Dedupe so an unchanged book/chapter keeps the same state reference. The real
  // BibleReader only fires onPassageChange from a useEffect, but defensive callers
  // (and tests) may re-emit the same passage every render; returning the previous
  // object short-circuits a render loop.
  const handlePassageChange = useCallback((ref: PassageRef) => {
    setPassage((prev) => {
      if (prev.book === ref.book && prev.chapter === ref.chapter) return prev;
      saveBiblePassage(ref);
      return ref;
    });
  }, []);

  const { translation, setLocalTranslation, verseLayout, setLocalVerseLayout } = useBiblePrefs();

  const { swatchByVerse, setHighlight, removeHighlight } = useBibleHighlights(
    passage.book,
    passage.chapter,
  );

  // Hooks are always called (Rules of Hooks); they no-op on a null adapter/user.
  const settings = useLamplightSettings({ adapter: lamplightAdapter as LamplightAdapter, userId: lamplightAdapter ? userId : null });
  const entitlement = useLamplightEntitlement({ adapter: lamplightAdapter as LamplightAdapter, userId: lamplightAdapter ? userId : null });

  const lamplightOn = settings.settings?.enabled === true;
  // Only block a SIGNED-IN user who has loaded settings with Lamplight off. Signed-out
  // users keep the existing flow (button opens → SignInGate); they can't act on a
  // "turn it on in Settings" hint anyway.
  const chatDisabled = !!user && !settings.isLoading && !lamplightOn;

  const renderChatArea = () => {
    if (!user) return <SignInGate />;
    if (settings.isLoading || entitlement.isLoading) {
      return <div className="p-4 text-[11px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>Loading…</div>;
    }
    if (!lamplightOn) {
      return (
        <div className="p-4 text-[11px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
          Lamplight is off. <a href="/profile" style={{ color: '#8a6c50', textDecoration: 'underline' }}>Enable it in Settings</a> to chat.
        </div>
      );
    }
    if (!entitlement.hasAccess('chat')) return <PaywallCard />;
    return <LamplightChat book={passage.book} chapter={passage.chapter} userId={user.id} invoke={invoke} />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col items-end gap-1 px-3 py-2 shrink-0">
        <button
          onClick={() => { if (!chatDisabled) setChatOpen((o) => !o); }}
          disabled={chatDisabled}
          aria-disabled={chatDisabled}
          className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider px-2.5 py-1 rounded-full"
          style={{
            fontFamily: 'Outfit, sans-serif',
            background: chatOpen ? '#C49A78' : '#fff',
            color: chatDisabled ? '#b8ab99' : chatOpen ? '#fff' : '#8a6c50',
            border: '1px solid #e2d7c8',
            cursor: chatDisabled ? 'not-allowed' : 'pointer',
            opacity: chatDisabled ? 0.6 : 1,
          }}
        >
          <Sparkles className="w-3 h-3" /> Lamplight Chat {chatOpen ? '●' : '○'}
        </button>
        {chatDisabled && (
          <a
            href="/profile"
            className="text-[10px]"
            style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--silica)', textDecoration: 'underline' }}
          >
            Enable Lamplight in Settings to chat
          </a>
        )}
      </div>

      <div ref={splitRef} className={chatOpen ? 'flex-1 min-h-0 flex flex-col' : 'flex-1 min-h-0'}>
        <div
          className={chatOpen ? 'min-h-0 overflow-hidden' : 'h-full'}
          style={chatOpen ? { flexGrow: 1 - fraction, flexBasis: 0 } : undefined}
        >
          <BibleReader
            initialBook={passage.book}
            initialChapter={passage.chapter}
            translation={translation}
            onTranslationChange={setLocalTranslation}
            verseLayout={verseLayout}
            onVerseLayoutChange={setLocalVerseLayout}
            onPassageChange={handlePassageChange}
            highlightSwatchByVerse={swatchByVerse}
            onSetHighlight={setHighlight}
            onRemoveHighlight={removeHighlight}
          />
        </div>
        {chatOpen && (
          <>
            <SplitResizeHandle {...handleProps} />
            <div className="min-h-0" style={{ flexGrow: fraction, flexBasis: 0 }}>
              {renderChatArea()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
