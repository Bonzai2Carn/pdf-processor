/**
 * monacoSetup.js
 * Creates and manages the Monaco HTML editor instance.
 * vite-plugin-monaco-editor handles the worker configuration automatically.
 */

import * as monaco from 'monaco-editor';
import { state } from '../state.js';

/**
 * Initialize the Monaco HTML editor in #monaco-editor-container.
 * Call once on app startup.
 */
export function initMonacoEditor() {
    const container = document.getElementById('monaco-editor-container');
    if (!container) return;

    const editor = monaco.editor.create(container, {
        value: '',
        language: 'html',
        theme: 'vs-dark',
        automaticLayout: true,
        wordWrap: 'on',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        tabSize: 2,
        formatOnPaste: true,
    });

    state.monacoEditor = editor;

    // Sync editor changes → HTML Preview
    editor.onDidChangeModelContent(() => {
        const html = editor.getValue();
        updateHTMLPreview(html);
        // Keep state in sync
        state.pdf1.extractedHTML = html;
    });

    return editor;
}

function updateHTMLPreview(html) {
    const preview = document.getElementById('html-preview');
    preview.contentEditable = true; // Allow text selection
    if (!preview) return;
    try {
        const clean = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(html, { ADD_TAGS: ['img'], ALLOW_DATA_ATTR: true })
            : html;
        preview.innerHTML = clean;
    } catch {
        // Silent — editor may produce incomplete HTML mid-type
    }
}
