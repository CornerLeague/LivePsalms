// The focus-mode body: control row (switcher + Add + verse-count dropdown), the
// optional Add panel, and a single-verse reader with Prev/Next navigation.
// The verse-count dropdown also holds per-verse reorder/remove controls.
// Verse text is fetched/assembled by useFocusListVerseText so the reader reads
// in the active translation.
import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import type { BibleTranslation } from '../translations';
import type { VerseSearchDeps } from '../verse-search-types';
import type { UseScriptureFocusListsResult } from './useScriptureFocusLists';
import { useFocusListVerseText } from './useFocusListVerseText';
import { FocusListSwitcher } from './FocusListSwitcher';
import { AddVersePanel } from './AddVersePanel';
import { useClickOutside } from './useClickOutside';

export interface FocusListViewProps {
  focus: UseScriptureFocusListsResult;
  translation: BibleTranslation;
  searchDeps: VerseSearchDeps;
}

export function FocusListView({ focus, translation, searchDeps }: FocusListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [countOpen, setCountOpen] = useState(false);
  const countRef = useRef<HTMLDivElement>(null);
  // Click/tap anywhere outside closes the verse dropdown (desktop click + mobile touch).
  useClickOutside(countRef, countOpen, () => setCountOpen(false));
  const { itemTexts } = useFocusListVerseText(focus.activeList.items, translation);

  const count = focus.activeList.items.length;
  const safeIndex = count === 0 ? 0 : Math.min(currentIndex, count - 1);
  const currentItem = count > 0 ? itemTexts[safeIndex] : null;

  return (
    <div style={{ fontFamily: 'Outfit, sans-serif' }}>
      {/* control row */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--pale-stone)' }}>
        <FocusListSwitcher
          savedLists={focus.savedLists}
          quickList={focus.quickList}
          activeListId={focus.activeListId}
          canSave={focus.canSave}
          onSelect={focus.selectList}
          onNew={focus.newList}
          onSaveQuick={focus.saveQuickList}
          onDelete={focus.deleteList}
          onRename={focus.renameList}
        />
        <button
          aria-label="Add verses"
          aria-pressed={showAdd}
          onClick={() => setShowAdd((s) => !s)}
          className="p-1.5 rounded hover:bg-black/5"
          style={{ background: showAdd ? 'rgba(196,154,120,0.22)' : 'transparent' }}
        >
          <Plus className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
        </button>
        {count > 0 && (
          <div className="relative ml-auto" ref={countRef}>
            <button
              aria-label="Verses"
              aria-expanded={countOpen}
              onClick={() => setCountOpen((o) => !o)}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded hover:bg-black/5"
              style={{ color: 'var(--deep-umber)' }}
            >
              {safeIndex + 1} / {count}
              <ChevronDown className="w-3 h-3" style={{ color: 'var(--silica)' }} />
            </button>
            {countOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg p-1"
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}
              >
                {itemTexts.map((it, i) => (
                  <div key={it.item.id} className="flex items-center">
                    <button
                      onClick={() => { setCurrentIndex(i); setCountOpen(false); }}
                      className={`flex-1 text-[12px] text-left px-2 py-1.5 rounded hover:bg-black/5${i === safeIndex ? ' font-semibold' : ''}`}
                      style={{ color: 'var(--deep-umber)' }}
                    >
                      {i + 1}. {it.item.label}
                    </button>
                    <span className="flex items-center gap-0.5">
                      <button
                        aria-label={`Move ${it.item.label} up`}
                        disabled={i === 0}
                        onClick={() => focus.reorderItem(it.item.id, 'up')}
                        className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                      >
                        <ArrowUp className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
                      </button>
                      <button
                        aria-label={`Move ${it.item.label} down`}
                        disabled={i === itemTexts.length - 1}
                        onClick={() => focus.reorderItem(it.item.id, 'down')}
                        className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                      >
                        <ArrowDown className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
                      </button>
                      <button
                        aria-label={`Remove ${it.item.label}`}
                        onClick={() => focus.removeItem(it.item.id)}
                        className="p-0.5 rounded hover:bg-black/10"
                      >
                        <X className="w-3 h-3" style={{ color: '#b45454' }} />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAdd && (
        <AddVersePanel onAddRefs={focus.addRefs} searchDeps={searchDeps} translation={translation} />
      )}

      {/* single verse reader */}
      <div className="px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {count === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            No verses yet. Tap ＋ to add a verse, or paste a list of references.
          </p>
        ) : currentItem && (
          <>
            <div className="flex items-center">
              <button
                aria-label="Previous verse"
                disabled={safeIndex === 0}
                onClick={() => setCurrentIndex(safeIndex - 1)}
                className="p-0.5 rounded hover:bg-black/5 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
              </button>
              <span
                className="flex-1 text-center text-[10px] font-semibold tracking-[0.14em]"
                style={{ color: 'var(--lamplight-accent)', fontFamily: 'Outfit, sans-serif' }}
              >
                {currentItem.item.label.toUpperCase()}
              </span>
              <button
                aria-label="Next verse"
                disabled={safeIndex === count - 1}
                onClick={() => setCurrentIndex(safeIndex + 1)}
                className="p-0.5 rounded hover:bg-black/5 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
              </button>
            </div>
            {currentItem.missing ? (
              <p className="text-[12px] italic" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                Not available in {translation}.
              </p>
            ) : (
              <p className="text-[13px] leading-[1.9]" style={{ color: 'var(--deep-umber)' }}>
                {currentItem.lines.map((l) => l.text).join(' ')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
