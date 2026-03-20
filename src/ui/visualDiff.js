/**
 * visualDiff.js
 * Visual Diff view — renders the PDF canvas on the left (with editable text layer)
 * and the extracted HTML on the right (contentEditable).
 * Both sides are editable so users can manually fix extraction errors.
 */

import { state } from '../state.js';
import { renderPDFToCanvas } from './pdfCanvas.js';
import { registerPages } from './pageNav.js';
import { showToast } from './toast.js';

let _rendered = false;

/**
 * Called when the user switches to the visual-diff tab.
 * Renders the PDF into the left pane and mirrors the HTML in the right pane.
 */
export async function activateVisualDiff() {
    if (!state.pdf1.doc) {
        const el = document.getElementById('visual-diff-pdf');
        if (el) el.innerHTML = '<p class="empty-hint">Open a PDF first.</p>';
        return;
    }

    // Only re-render if the doc changed or we haven't rendered yet
    if (!_rendered || state.pdf1._diffDirty) {
        await renderPDFToCanvas(state.pdf1.doc, 'visual-diff-pdf');
        _rendered = true;
        state.pdf1._diffDirty = false;
    }

    // Mirror the extracted HTML into the right pane
    const rightPane = document.getElementById('visual-diff-html');
    if (rightPane && state.pdf1.extractedHTML) {
        const clean = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(state.pdf1.extractedHTML, { ADD_TAGS: ['img'], ALLOW_DATA_ATTR: true })
            : state.pdf1.extractedHTML;
        rightPane.innerHTML = clean;
    }

    // Re-register pages for visual diff pane navigation
    const wrappers = [...document.querySelectorAll('#visual-diff-pdf .page-wrapper')];
    if (wrappers.length) registerPages(wrappers, wrappers.length);
}

/**
 * Mark diff as needing re-render (call when PDF1 changes).
 */
export function markDiffDirty() {
    _rendered = false;
    if (state.pdf1) state.pdf1._diffDirty = true;
}

/**
 * Wire up the resizable divider between the two panes.
 */
export function initDividerResize() {
    const divider = document.getElementById('vd-divider');
    const layout = document.querySelector('.visual-diff-layout');
    if (!divider || !layout) return;

    let dragging = false;
    let startX = 0;
    let startLeftW = 0;

    divider.addEventListener('mousedown', e => {
        dragging = true;
        startX = e.clientX;
        const panes = layout.querySelectorAll('.vd-pane');
        startLeftW = panes[0].getBoundingClientRect().width;
        divider.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const delta = e.clientX - startX;
        const totalW = layout.getBoundingClientRect().width;
        const newLeftW = Math.max(240, Math.min(totalW - 240, startLeftW + delta));
        const leftPct = (newLeftW / totalW) * 100;
        const panes = layout.querySelectorAll('.vd-pane');
        if (panes[0]) panes[0].style.flex = `0 0 ${leftPct}%`;
        if (panes[1]) panes[1].style.flex = `0 0 ${100 - leftPct}%`;
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        divider.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    });
}
