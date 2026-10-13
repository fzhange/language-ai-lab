import Highlight from '@tiptap/extension-highlight'

export const PaletteHighlight = Highlight.extend({
  addKeyboardShortcuts() { return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight({ color: '#fff3d6' }) } },
  addInputRules() { return [] },
  addPasteRules() { return [] },
}).configure({ multicolor: true })
