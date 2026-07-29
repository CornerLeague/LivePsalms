// src/notepad/onboarding/checklist/ChecklistPanel.tsx

export interface ChecklistPanelProps {
  title: string;
  items: { id: string; label: string; hint?: string }[];
  completed: Record<string, boolean>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDismiss: () => void;
}

export function ChecklistPanel({
  title,
  items,
  completed,
  collapsed,
  onToggleCollapsed,
  onDismiss,
}: ChecklistPanelProps) {
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="px-4 py-2 rounded-full text-xs font-medium"
        style={{
          background: 'var(--deep-umber)',
          color: 'var(--plaster)',
          fontFamily: 'Outfit, sans-serif',
        }}
        aria-label={title}
      >
        {title}
      </button>
    );
  }

  return (
    <div
      className="flex flex-col p-4 rounded-lg max-w-xs"
      style={{
        background: 'var(--alabaster)',
        border: '1px solid var(--pale-stone)',
        fontFamily: 'Outfit, sans-serif',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2
          className="text-sm font-semibold"
          style={{ color: 'var(--deep-umber)' }}
        >
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapsed}
            aria-label="Collapse"
            className="p-1 rounded text-xs hover:opacity-70 transition-opacity"
            style={{ color: 'var(--silica)' }}
          >
            −
          </button>
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="p-1 rounded text-xs hover:opacity-70 transition-opacity"
            style={{ color: 'var(--silica)' }}
          >
            ×
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const isChecked = !!completed[item.id];
          return (
            <li key={item.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  role="checkbox"
                  aria-checked={isChecked}
                  aria-readonly="true"
                  aria-label={item.label}
                  className="w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center text-xs"
                  style={{
                    background: isChecked ? 'var(--deep-umber)' : 'transparent',
                    borderColor: isChecked ? 'var(--deep-umber)' : 'var(--pale-stone)',
                    color: 'var(--plaster)',
                  }}
                >
                  {isChecked ? '✓' : ''}
                </span>
                <span
                  className="text-xs"
                  style={{ color: 'var(--deep-umber)' }}
                >
                  {item.label}
                </span>
              </div>
              {item.hint && (
                <p className="text-xs ml-6" style={{ color: 'var(--silica)' }}>
                  {item.hint}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
