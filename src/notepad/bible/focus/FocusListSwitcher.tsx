// List switcher for focus mode: dropdown (desktop) / bottom sheet (mobile). Lists
// saved lists with the active one checkmarked, the unsaved Quick list, "New list…",
// and — when the Quick list is active and savable — a "Save this list…" action.
// v1 names lists via window.prompt (a styled dialog is a deferred polish item).
import { useState } from 'react';
import { Check, ChevronDown, Plus, Save, X, Zap } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { QUICK_LIST_ID, type FocusList } from './focus-list-types';

export interface FocusListSwitcherProps {
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  canSave: boolean;
  onSelect: (id: string) => void;
  onNew: (title: string) => void;
  onSaveQuick: (title: string) => void;
  onDelete: (id: string) => void;
  editMode: boolean;
}

export function FocusListSwitcher({
  savedLists, quickList, activeListId, canSave,
  onSelect, onNew, onSaveQuick, onDelete, editMode,
}: FocusListSwitcherProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const activeTitle = activeListId === QUICK_LIST_ID
    ? quickList.title
    : savedLists.find((l) => l.id === activeListId)?.title ?? quickList.title;

  const promptName = (): string | null => {
    const name = window.prompt('Name this list');
    const trimmed = name?.trim();
    return trimmed ? trimmed : null;
  };

  const handleNew = () => {
    const name = promptName();
    if (name) { onNew(name); setOpen(false); }
  };
  const handleSaveQuick = () => {
    const name = promptName();
    if (name) { onSaveQuick(name); setOpen(false); }
  };

  const showSaveQuick = activeListId === QUICK_LIST_ID && canSave && quickList.items.length > 0;

  const panel = (
    <div
      className={isMobile
        ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-xl p-3'
        : 'absolute left-0 top-full z-50 mt-1 w-56 rounded-lg p-1'}
      style={{ background: '#fff', border: '1px solid var(--pale-stone)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}
    >
      {savedLists.map((l) => (
        <div key={l.id} className="flex items-center">
          <button
            onClick={() => { onSelect(l.id); setOpen(false); }}
            className="flex-1 flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
            style={{ color: 'var(--deep-umber)' }}
          >
            <Check className="w-3 h-3 shrink-0" style={{ opacity: l.id === activeListId ? 1 : 0 }} />
            {l.title}
          </button>
          {editMode && (
            <button
              aria-label={`Delete ${l.title}`}
              onClick={() => onDelete(l.id)}
              className="p-1 rounded hover:bg-black/10"
            >
              <X className="w-3 h-3" style={{ color: '#b45454' }} />
            </button>
          )}
        </div>
      ))}

      <div className="my-1" style={{ borderTop: '1px solid var(--pale-stone)' }} />

      <button
        onClick={() => { onSelect(QUICK_LIST_ID); setOpen(false); }}
        className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        <Zap className="w-3 h-3 shrink-0" /> Quick list (unsaved)
      </button>

      <button
        onClick={handleNew}
        className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        <Plus className="w-3 h-3 shrink-0" /> New list…
      </button>

      {showSaveQuick && (
        <button
          onClick={handleSaveQuick}
          className="w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded hover:bg-black/5"
          style={{ color: 'var(--deep-umber)' }}
        >
          <Save className="w-3 h-3 shrink-0" /> Save this list…
        </button>
      )}
    </div>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        {activeTitle}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--silica)' }} />
      </button>
      {open && panel}
    </div>
  );
}
