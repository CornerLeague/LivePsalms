import { Extension, type Editor } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { matchSlashBeforeCursor } from './slash-menu-matchers';
import { renderSlashMenu } from './slash-menu-renderer';
import { filterSlashCommands, type SlashCommand } from './slash-commands';
import { slashPlusPlugin } from './slash-plus';

export interface SlashMenuOptions {
  /** The command registry, pre-built by the editor host (createSlashCommands). */
  commands: SlashCommand[];
  /** Render the empty-line "+" opener (mobile-forward). Default true. */
  emptyLinePlus: boolean;
}

const SLASH_MENU_KEY = new PluginKey('slashMenu');

/**
 * The unified "/" command launcher. A single @tiptap/suggestion plugin on
 * char "/", whose items come from the pure command registry and whose
 * `command` runs the selected entry's `run(editor, range)`. The matcher cedes
 * "/verse" and "/lookup" to ScriptureRef's shipped pickers, so this coexists
 * with them without stacking a second dropdown.
 */
export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: 'slashMenu',

  addOptions() {
    return { commands: [], emptyLinePlus: true };
  },

  addProseMirrorPlugins() {
    const commands = this.options.commands;

    const suggestion: SuggestionOptions<SlashCommand, SlashCommand> = {
      editor: this.editor,
      pluginKey: SLASH_MENU_KEY,
      char: '/',
      allowSpaces: true,
      startOfLine: false,
      items: ({ query }) => filterSlashCommands(commands, query),
      command: ({ editor, range, props }: { editor: Editor; range: { from: number; to: number }; props: SlashCommand }) =>
        props.run({ editor, range }),
      render: renderSlashMenu,
      findSuggestionMatch: ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = matchSlashBeforeCursor(textBefore);
        if (!m) return null;
        const blockStart = $position.start();
        return { range: { from: blockStart + m.from, to: blockStart + m.to }, query: m.query, text: m.query };
      },
    };

    const plugins = [Suggestion(suggestion)];
    if (this.options.emptyLinePlus) plugins.push(slashPlusPlugin(this.editor));
    return plugins;
  },
});
