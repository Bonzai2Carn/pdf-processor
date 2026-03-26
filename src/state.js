/**
 * state.js
 * Shared application state. Plain object — no framework needed.
 */

export const state = {
    pdf1: { file: null, doc: null, bytes: null, extractedHTML: '' },
    pdf2: { file: null, doc: null, bytes: null, extractedHTML: '' },
    activeView: 'pdf',
    monacoEditor: null,   // monaco.editor instance (HTML editor)
    monacoDiff: null,     // monaco.editor diff instance
};
