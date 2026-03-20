/**
 * viewController.js
 * Manages the 5-tab view system: PDF | HTML | Editor | Visual Diff | Code Diff
 */

import { state } from '../state.js';

const VIEWS = ['pdf', 'html', 'editor', 'visual-diff', 'diff'];

export function initViewTabs() {
    document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            switchView(btn.dataset.view);
        });
    });
}

export async function switchView(viewName) {
    if (!VIEWS.includes(viewName)) return;

    VIEWS.forEach(v => {
        const panel = document.getElementById(`view-${v}`);
        if (panel) panel.classList.toggle('active', v === viewName);
    });

    document.querySelectorAll('.tab-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    state.activeView = viewName;

    // Monaco needs layout() call when made visible
    if (viewName === 'editor' && state.monacoEditor) state.monacoEditor.layout();
    if (viewName === 'diff'   && state.monacoDiff)   state.monacoDiff.layout();

    // Visual diff needs its own activation logic
    if (viewName === 'visual-diff') {
        const { activateVisualDiff } = await import('./visualDiff.js');
        activateVisualDiff();
    }
}

export function enableDiffTab() {
    const btn = document.getElementById('diff-tab-btn');
    if (btn) btn.disabled = false;
}

export function disableDiffTab() {
    const btn = document.getElementById('diff-tab-btn');
    if (btn) btn.disabled = true;
    if (state.activeView === 'diff') switchView('pdf');
}

export function showStatus(msg, progress = '') {
    const bar  = document.getElementById('status-bar');
    const msgEl = document.getElementById('status-msg');
    const progEl = document.getElementById('status-progress');
    if (bar)  bar.hidden = false;
    if (msgEl)  msgEl.textContent  = msg;
    if (progEl) progEl.textContent = progress;
}

export function hideStatus() {
    const bar = document.getElementById('status-bar');
    if (bar) bar.hidden = true;
}
