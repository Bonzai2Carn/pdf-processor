/**
 * pageNav.js
 * Page navigation (prev/next/jump/counter) and formatting toolbar handlers.
 * Works with: PDF canvas view, HTML view, visual diff view.
 */

import { state } from '../state.js';

let _totalPages = 0;
let _currentPage = 1;
let _pageWrappers = []; // Array of .page-wrapper elements in current canvas container

export function initToolbar() {
    // Format commands; apply to whatever contentEditable has focus
    document.getElementById('btn-bold')?.addEventListener('click', () => fmt('bold'));
    document.getElementById('btn-italic')?.addEventListener('click', () => fmt('italic'));
    document.getElementById('btn-underline')?.addEventListener('click', () => fmt('underline'));
    document.getElementById('btn-ul')?.addEventListener('click', () => fmt('insertUnorderedList'));
    document.getElementById('btn-ol')?.addEventListener('click', () => fmt('insertOrderedList'));
    document.getElementById('sel-block')?.addEventListener('change', e => {
        const v = e.target.value;
        fmt('formatBlock', v || 'p');
        e.target.value = '';
    });
    document.getElementById('btn-2col')?.addEventListener('click', toggle2col);
    document.getElementById('btn-add-page')?.addEventListener('click', addEditorPage);

    // Page nav
    document.getElementById('btn-prev-page')?.addEventListener('click', prevPage);
    document.getElementById('btn-next-page')?.addEventListener('click', nextPage);
    document.getElementById('page-jump')?.addEventListener('change', e => jumpToPage(+e.target.value));
}

function fmt(cmd, val) {
    document.execCommand(cmd, false, val || null);
}

function toggle2col() {
    const active = document.querySelector('.prose-area.active, #html-preview, #visual-diff-html');
    if (!active) return;
    active.style.columnCount = active.style.columnCount === '2' ? '' : '2';
    active.style.columnGap = active.style.columnCount === '2' ? '32px' : '';
}

function addEditorPage() {
    // Adds a blank section separator into the HTML view
    const preview = document.getElementById('html-preview');
    if (!preview) return;
    preview.focus();
    const div = document.createElement('div');
    div.style.cssText = 'page-break-before:always; border-top:2px dashed #d1d5db; margin:40px 0 20px; padding-top:20px;';
    div.innerHTML = '<p>New page content here…</p>';
    const sel = window.getSelection();
    if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        range.collapse(false);
        range.insertNode(div);
    } else {
        preview.appendChild(div);
    }
}

// ── PDF PAGE NAVIGATION ────────────────────────────────────────────────────

/**
 * Register page wrappers for navigation.
 * Called from pdfCanvas.js / visualDiff.js after rendering.
 */
export function registerPages(wrappers, total) {
    _pageWrappers = wrappers;
    _totalPages = total;
    _currentPage = 1;
    updateCounter(1, total);
    buildJumpSelect(total);
    setupIntersectionObserver();
}

export function prevPage() {
    if (_currentPage > 1) scrollToPage(_currentPage - 1);
}

export function nextPage() {
    if (_currentPage < _totalPages) scrollToPage(_currentPage + 1);
}

export function jumpToPage(n) {
    if (n >= 1 && n <= _totalPages) scrollToPage(n);
}

function scrollToPage(n) {
    const wrapper = _pageWrappers[n - 1];
    if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
        _currentPage = n;
        updateCounter(n, _totalPages);
        const jump = document.getElementById('page-jump');
        if (jump) jump.value = n;
    }
}

function updateCounter(current, total) {
    const el = document.getElementById('page-counter');
    if (el) el.textContent = `Page ${current} of ${total}`;
}

function buildJumpSelect(total) {
    const jump = document.getElementById('page-jump');
    if (!jump) return;
    jump.innerHTML = '';
    for (let i = 1; i <= total; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Page ${i}`;
        jump.appendChild(opt);
    }
}

function setupIntersectionObserver() {
    if (!_pageWrappers.length) return;
    const observer = new IntersectionObserver(entries => {
        let mostVisible = null, maxRatio = 0;
        for (const entry of entries) {
            if (entry.intersectionRatio > maxRatio) {
                maxRatio = entry.intersectionRatio;
                mostVisible = entry.target;
            }
        }
        if (mostVisible) {
            const idx = _pageWrappers.indexOf(mostVisible);
            if (idx !== -1 && idx + 1 !== _currentPage) {
                _currentPage = idx + 1;
                updateCounter(_currentPage, _totalPages);
                const jump = document.getElementById('page-jump');
                if (jump) jump.value = _currentPage;
            }
        }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    _pageWrappers.forEach(w => observer.observe(w));
}
