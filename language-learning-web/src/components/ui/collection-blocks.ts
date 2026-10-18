import { Node } from '@tiptap/core'

export const CollectionHorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'hr[data-collection-divider]' }],
  renderHTML: () => ['hr', { 'data-collection-divider': '' }],
})

export const CollectionSectionDivider = Node.create({
  name: 'sectionDivider',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ title: {
    default: '',
    parseHTML: (element) => element.getAttribute('data-title') ?? '',
    renderHTML: ({ title }) => ({ 'data-title': title }),
  } }),
  parseHTML: () => [{ tag: 'div[data-collection-section]' }],
  renderHTML: ({ node }) => ['div', { 'data-collection-section': '', 'data-title': node.attrs.title }, ['span', {}, node.attrs.title]],
})

export const CollectionSummaryBlock = Node.create({
  name: 'summaryBlock',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes: () => ({ color: {
    default: 'blue',
    parseHTML: (element) => element.getAttribute('data-color') ?? 'blue',
    renderHTML: ({ color }) => ({ 'data-color': color }),
  } }),
  parseHTML: () => [{ tag: 'aside[data-collection-summary]' }],
  renderHTML: ({ node }) => ['aside', { 'data-collection-summary': '', 'data-color': node.attrs.color }, 0],
})
