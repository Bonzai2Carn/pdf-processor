/**
 * contextMenu.js
 * Right-click context menu for inserting images (URL or file upload)
 * into any contentEditable area (PDF text layer, HTML preview, visual diff panes).
 */

let _savedRange = null;

export function initContextMenu() {
    const menu = document.getElementById('ctx-menu');
    const imgUrlBtn = document.getElementById('ctx-img-url');
    const imgFileBtn = document.getElementById('ctx-img-file');
    const fileInput = document.getElementById('ctx-file-input');

    // Show menu on right-click inside editable areas
    const editableSelectors = [
        '#pdf-canvas-container',
        '#html-preview',
        '#visual-diff-pdf',
        '#visual-diff-html',
    ];

    document.addEventListener('contextmenu', e => {
        const inside = editableSelectors.some(sel => {
            const el = document.querySelector(sel);
            return el && el.contains(e.target);
        });
        if (!inside) return;

        e.preventDefault();
        _savedRange = saveSelection();

        const { clientX: x, clientY: y } = e;
        const menuW = 200, menuH = 90;
        const left = Math.min(x, window.innerWidth  - menuW - 8);
        const top  = Math.min(y, window.innerHeight - menuH - 8);

        menu.style.left = left + 'px';
        menu.style.top  = top  + 'px';
        menu.hidden = false;
    });

    // Dismiss on any click outside the menu
    document.addEventListener('click', e => {
        if (!menu.contains(e.target)) menu.hidden = true;
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') menu.hidden = true;
    });

    // Insert image from URL
    imgUrlBtn.addEventListener('click', () => {
        menu.hidden = true;
        const url = prompt('Enter image URL:');
        if (url && url.trim()) insertImage(url.trim());
    });

    // Insert image from file upload
    imgFileBtn.addEventListener('click', () => {
        menu.hidden = true;
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => insertImage(e.target.result);
        reader.readAsDataURL(file);
        fileInput.value = '';
    });
}

function insertImage(src) {
    restoreSelection(_savedRange);
    const img = document.createElement('img');
    img.src = src;
    img.style.maxWidth = '100%';
    img.alt = '';

    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        // Fallback: append to html-preview
        const target = document.getElementById('html-preview') ||
                        document.getElementById('visual-diff-html');
        if (target) target.appendChild(img);
    }
}

function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) return sel.getRangeAt(0).cloneRange();
    return null;
}

function restoreSelection(range) {
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}
