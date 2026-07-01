// List switcher for focus mode: dropdown (desktop) / bottom sheet (mobile). Lists
// saved lists with the active one checkmarked, the unsaved Quick list, "New list…",
// and — when the Quick list is active and savable — a "Save this list…" action.
// Per-list rename and delete are always visible (no edit-mode gate).
// List naming uses an in-component modal instead of window.prompt.
import { useRef, useState } from 'react';
import { Check, ChevronDown, Pencil, Plus, Save, X, Zap } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { QUICK_LIST_ID, type FocusList } from './focus-list-types';
import { useClickOutside } from './useClickOutside';

export interface FocusListSwitcherProps {
  savedLists: FocusList[];
  quickList: FocusList;
  activeListId: string;
  canSave: boolean;
  onSelect: (id: string) => void;
  onNew: (title: string) => void;
  onSaveQuick: (title: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

type ModalState = { mode: 'new' | 'save' | 'rename'; id?: string } | null;

export function FocusListSwitcher({
  savedLists, quickList, activeListId, canSave,
  onSelect, onNew, onSaveQuick, onDelete, onRename,
}: FocusListSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [nameInput, setNameInput] = useState('');
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  // Click/tap anywhere outside closes the dropdown (desktop click + mobile touch).
  useClickOutside(rootRef, open, () => setOpen(false));

  const activeTitle = activeListId === QUICK_LIST_ID
    ? quickList.title
    : savedLists.find((l) => l.id === activeListId)?.title ?? quickList.title;

  const handleNew = () => {
    setModal({ mode: 'new' });
    setNameInput('');
    setOpen(false);
  };
  const handleSaveQuick = () => {
    setModal({ mode: 'save' });
    setNameInput('');
    setOpen(false);
  };
  const handleRename = (l: FocusList) => {
    setModal({ mode: 'rename', id: l.id });
    setNameInput(l.title);
    setOpen(false);
  };

  const confirmModal = () => {
    const name = nameInput.trim();
    if (!name || !modal) return;
    if (modal.mode === 'new') onNew(name);
    else if (modal.mode === 'save') onSaveQuick(name);
    else if (modal.mode === 'rename') onRename(modal.id!, name);
    setModal(null);
  };

  const cancelModal = () => setModal(null);

  const modalLabel =
    modal?.mode === 'new' ? 'New list' :
    modal?.mode === 'save' ? 'Save list' :
    'Rename list';

  const showSaveQuick = activeListId === QUICK_LIST_ID && canSave && quickList.items.length > 0;

  const panel = (
    <div
      className={isMobile
        ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-xl p-3'
        : 'absolute left-0 top-full z-50 mt-1 w-56 rounded-lg p-1'}
      style={{ background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}
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
          <button
            aria-label={`Rename ${l.title}`}
            onClick={() => handleRename(l)}
            className="p-1 rounded hover:bg-black/10"
          >
            <Pencil className="w-3 h-3" style={{ color: 'var(--deep-umber)' }} />
          </button>
          <button
            aria-label={`Delete ${l.title}`}
            onClick={() => onDelete(l.id)}
            className="p-1 rounded hover:bg-black/10"
          >
            <X className="w-3 h-3" style={{ color: '#b45454' }} />
          </button>
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
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded hover:bg-black/5"
        style={{ color: 'var(--deep-umber)' }}
      >
        {activeTitle}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--silica)' }} />
      </button>
      {open && panel}

      {modal !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            className="w-64 rounded-lg p-4"
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--pale-stone)' }}
          >
            <label className="text-[11px]" style={{ color: 'var(--silica)' }}>
              {modalLabel}
            </label>
            <input
              autoFocus
              aria-label="List name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmModal();
                if (e.key === 'Escape') cancelModal();
              }}
              className="text-[13px] p-2 mt-1 w-full rounded"
              style={{ border: '1px solid var(--pale-stone)', color: 'var(--deep-umber)', background: 'transparent' }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={cancelModal}
                className="text-[12px] px-3 py-1 rounded hover:bg-black/5"
                style={{ color: 'var(--deep-umber)' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmModal}
                disabled={!nameInput.trim()}
                className="text-[12px] px-3 py-1 rounded disabled:opacity-40"
                style={{ background: 'var(--lamplight-accent)', color: 'var(--surface-elevated)' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
