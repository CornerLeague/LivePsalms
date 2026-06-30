// The focus-mode body: control row (switcher + Add + Edit + count), the optional
// Add panel, and the ordered verse stack (with per-row reorder/remove in edit mode
// and a friendly empty state). Verse text is fetched/assembled by
// useFocusListVerseText so the stack reads in the active translation.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react';
import type { BibleTranslation } from '../translations';
import type { VerseSearchDeps } from '../verse-search-types';
import type { UseScriptureFocusListsResult } from './useScriptureFocusLists';
import { useFocusListVerseText } from './useFocusListVerseText';
import { FocusListSwitcher } from './FocusListSwitcher';
import { AddVersePanel } from './AddVersePanel';

export interface FocusListViewProps {
  focus: UseScriptureFocusListsResult;
  translation: BibleTranslation;
  searchDeps: VerseSearchDeps;
}

export function FocusListView({ focus, translation, searchDeps }: FocusListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const { itemTexts } = useFocusListVerseText(focus.activeList.items, translation);

  const count = focus.activeList.items.length;

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
          editMode={editMode}
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
        <button
          aria-label="Edit list"
          aria-pressed={editMode}
          onClick={() => setEditMode((e) => !e)}
          className="p-1.5 rounded hover:bg-black/5"
          style={{ background: editMode ? 'rgba(196,154,120,0.22)' : 'transparent' }}
        >
          <Pencil className="w-4 h-4" style={{ color: 'var(--deep-umber)' }} />
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--silica)' }}>
          {count} verse{count === 1 ? '' : 's'}
        </span>
      </div>

      {showAdd && (
        <AddVersePanel onAddRefs={focus.addRefs} searchDeps={searchDeps} translation={translation} />
      )}

      {/* verse stack */}
      <div className="px-4 py-3" style={{ fontFamily: 'Georgia, serif' }}>
        {count === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
            No verses yet. Tap ＋ to add a verse, or paste a list of references.
          </p>
        ) : (
          itemTexts.map((it, idx) => (
            <div key={it.item.id} className="mb-4">
              <div className="flex items-center gap-1 mb-1">
                <span
                  className="text-[10px] font-semibold tracking-[0.14em]"
                  style={{ color: 'var(--lamplight-accent)', fontFamily: 'Outfit, sans-serif' }}
                >
                  {it.item.label.toUpperCase()}
                </span>
                {editMode && (
                  <span className="ml-auto flex items-center gap-0.5">
                    <button
                      aria-label={`Move ${it.item.label} up`}
                      disabled={idx === 0}
                      onClick={() => focus.reorderItem(it.item.id, 'up')}
                      className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30"
                    >
                      <ArrowUp className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
                    </button>
                    <button
                      aria-label={`Move ${it.item.label} down`}
                      disabled={idx === itemTexts.length - 1}
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
                )}
              </div>
              {it.missing ? (
                <p className="text-[12px] italic" style={{ color: 'var(--silica)', fontFamily: 'Outfit, sans-serif' }}>
                  Not available in {translation}.
                </p>
              ) : (
                <p className="text-[13px] leading-[1.9]" style={{ color: 'var(--deep-umber)' }}>
                  {it.lines.map((l) => l.text).join(' ')}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
