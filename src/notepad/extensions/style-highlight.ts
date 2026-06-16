import { Mark, mergeAttributes } from '@tiptap/core';
import { getStyleAsset } from '../styles/manifest';
import { emitOnboardingEvent } from '../onboarding/onboarding-events';

export type HighlightAction =
  | { type: 'unset' }
  | { type: 'set'; swatchId: string }
  | { type: 'none' };

// Decide what Mod-Shift-H should do: remove an active highlight, otherwise apply
// the last-used swatch (or a configured default). Pure so it can be unit-tested.
export function nextHighlightAction(
  isActive: boolean,
  lastSwatchId: string | null,
  defaultSwatchId: string | null,
): HighlightAction {
  if (isActive) return { type: 'unset' };
  const swatchId = lastSwatchId ?? defaultSwatchId;
  return swatchId ? { type: 'set', swatchId } : { type: 'none' };
}

export interface StyleHighlightOptions {
  defaultSwatchId: string | null;
}
export interface StyleHighlightStorage {
  lastSwatchId: string | null;
}

export function highlightBackgroundStyle(displayUrl: string | undefined): string {
  if (!displayUrl) return '';
  // Cover-and-center the swatch instead of stretching one copy to fit each
  // fragment. `cover` preserves the texture's aspect ratio and crops to the
  // swatch's solid interior (dropping the feathered/rounded edges that would
  // otherwise tile into visible seams), so the highlight reads as one smooth,
  // even-density wash across any length and continues consistently on every
  // wrapped line rather than squishing and restarting per word/line.
  return (
    `background-image:url(${displayUrl});` +
    'background-size:cover;' +
    'background-position:center;' +
    'background-repeat:no-repeat;' +
    'border-radius:3px;' +
    'padding:0 2px;' +
    '-webkit-box-decoration-break:clone;' +
    'box-decoration-break:clone;'
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    styleHighlight: {
      setStyleHighlight: (swatchId: string) => ReturnType;
      unsetStyleHighlight: () => ReturnType;
      toggleStyleHighlight: (swatchId: string) => ReturnType;
    };
  }
}

export const StyleHighlight = Mark.create<StyleHighlightOptions, StyleHighlightStorage>({
  name: 'styleHighlight',

  addOptions() {
    return { defaultSwatchId: null };
  },

  addStorage() {
    return { lastSwatchId: null };
  },

  addAttributes() {
    return {
      swatchId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-style-highlight'),
        renderHTML: (attrs) => ({ 'data-style-highlight': attrs.swatchId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-style-highlight]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const swatchId = HTMLAttributes['data-style-highlight'] as string | undefined;
    const asset = swatchId ? getStyleAsset(swatchId) : undefined;
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        style: highlightBackgroundStyle(asset?.displayUrl),
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setStyleHighlight:
        (swatchId) =>
        ({ commands }) => {
          const applied = commands.setMark(this.name, { swatchId });
          if (applied) {
            this.storage.lastSwatchId = swatchId;
            emitOnboardingEvent('highlight-created');
          }
          return applied;
        },
      unsetStyleHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleStyleHighlight:
        (swatchId) =>
        ({ commands }) => {
          const applied = commands.toggleMark(this.name, { swatchId });
          if (applied) this.storage.lastSwatchId = swatchId;
          return applied;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => {
        const action = nextHighlightAction(
          this.editor.isActive(this.name),
          this.storage.lastSwatchId,
          this.options.defaultSwatchId,
        );
        if (action.type === 'unset') return this.editor.commands.unsetStyleHighlight();
        if (action.type === 'set') return this.editor.commands.setStyleHighlight(action.swatchId);
        return false;
      },
    };
  },
});
