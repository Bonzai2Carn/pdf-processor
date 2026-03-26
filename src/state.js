/**
 * state.js
 * Shared application state. Plain object — no framework needed.
 */

export const state = {
    pdf1: { file: null, doc: null, bytes: null, extractedHTML: '', jsonTree: null },
    pdf2: { file: null, doc: null, bytes: null, extractedHTML: '', jsonTree: null },
    activeView: 'pdf',
    monacoEditor: null,   // monaco.editor instance (HTML editor)
    monacoDiff: null,     // monaco.editor diff instance

    // AI pipeline state
    useAIPipeline: true,   // toggle between AI and legacy extraction
    modelReady: false,     // true once ONNX layout model is loaded
};
