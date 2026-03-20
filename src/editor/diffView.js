/**
 * diffView.js
 * Creates and manages the Monaco diff editor for comparing two PDFs' extracted HTML.
 * Provides VS Code / GitHub PR-style inline diff with synchronized scrolling.
 */

import * as monaco from 'monaco-editor';
import { state } from '../state.js';

let originalModel = null;
let modifiedModel = null;

/**
 * Initialize the Monaco diff editor in #monaco-diff-container.
 * Call once on app startup.
 */
export function initDiffEditor() {
    const container = document.getElementById('monaco-diff-container');
    if (!container) return;

    const diffEditor = monaco.editor.createDiffEditor(container, {
        theme: 'vs-dark',
        automaticLayout: true,
        renderSideBySide: true,
        ignoreTrimWhitespace: true,
        wordWrap: 'on',
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        renderOverviewRuler: true,
        originalEditable: false,
        readOnly: false,
    });

    // Initialize with empty models
    originalModel = monaco.editor.createModel('', 'html');
    modifiedModel = monaco.editor.createModel('', 'html');
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });

    state.monacoDiff = diffEditor;
    return diffEditor;
}

/**
 * Update the diff editor with new HTML content for both PDFs.
 * @param {string} html1 - original PDF extracted HTML
 * @param {string} html2 - modified PDF extracted HTML
 */
export function updateDiff(html1, html2) {
    if (!originalModel || !modifiedModel) return;
    originalModel.setValue(html1 || '');
    modifiedModel.setValue(html2 || '');
    // Force layout recalculation in case the panel just became visible
    state.monacoDiff?.layout();
}
