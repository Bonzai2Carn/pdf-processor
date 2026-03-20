/**
 * htmlBuilder.js — Stage 7
 * Converts classified paragraphs and detected table regions into semantic HTML.
 */

const BULLET_RE = /^([\u2022\u25CF\u25AA\u2013\-\*]|\d+[.)]|[a-zA-Z][.)]|\([a-zA-Z]\))\s+/;

/**
 * @param {Array} paragraphs  - from lineClusterer.groupIntoParagraphs()
 * @param {Array} tableRegions - from tableDetector.detectTables() (line indices → html)
 * @param {Array} allLines    - flat array of all lines (for table index lookup)
 * @param {{bodyFontSize:number, uniqueSizes:number[]}} stats
 * @returns {string} HTML string
 */
export function buildHTML(paragraphs, tableRegions, allLines, stats) {
    const { bodyFontSize, uniqueSizes } = stats;

    // Build a set of line indices that are inside a table
    const tableLineSet = new Set();
    for (const region of tableRegions) {
        for (let i = region.startIdx; i <= region.endIdx; i++) tableLineSet.add(i);
    }

    // Map each paragraph's first line to its index in allLines
    const lineToIdx = new Map(allLines.map((l, i) => [l, i]));

    const parts = [];
    let listBuffer = []; // accumulate <li> items
    let listType = null; // 'ul' or 'ol'
    let tableInserted = new Set();

    // Interleave paragraphs and table regions in document order
    // We process paragraphs sequentially; when a paragraph's line falls inside a table,
    // emit the table HTML instead.
    for (const para of paragraphs) {
        const firstLine = para.lines[0];
        const lineIdx = lineToIdx.get(firstLine);
        const tableRegion = lineIdx !== undefined
            ? tableRegions.find(r => lineIdx >= r.startIdx && lineIdx <= r.endIdx)
            : null;

        if (tableRegion) {
            if (!tableInserted.has(tableRegion.startIdx)) {
                flushList(parts, listBuffer, listType);
                listBuffer = []; listType = null;
                tableInserted.add(tableRegion.startIdx);
                parts.push(tableRegion.html);
            }
            continue;
        }

        const tag = classifyParagraph(para, bodyFontSize, uniqueSizes);

        if (tag === 'li') {
            const currentListType = BULLET_RE.test(para.text) && /^\d/.test(para.text.trim()) ? 'ol' : 'ul';
            if (listType && listType !== currentListType) {
                flushList(parts, listBuffer, listType);
                listBuffer = [];
            }
            listType = currentListType;
            listBuffer.push(para.text.replace(BULLET_RE, '').trim());
        } else {
            if (listBuffer.length) { flushList(parts, listBuffer, listType); listBuffer = []; listType = null; }
            const text = escapeHTML(para.text);
            if (tag === 'p') {
                const styled = applyInlineStyles(para, text);
                parts.push(`<p>${styled}</p>`);
            } else {
                parts.push(`<${tag}>${text}</${tag}>`);
            }
        }
    }

    if (listBuffer.length) flushList(parts, listBuffer, listType);

    return parts.join('\n');
}

function classifyParagraph(para, bodyFontSize, uniqueSizes) {
    if (!para.text.trim()) return null;

    // Bullet/list detection
    if (BULLET_RE.test(para.text)) return 'li';

    const fontSize = para.maxFontSize;
    const firstItem = para.firstItem;
    const isBold = firstItem?.isBold || false;
    const text = para.text.trim();

    // Find rank among unique sizes
    const rank = uniqueSizes.findIndex(s => Math.abs(s - fontSize) < 0.8);

    if (fontSize > bodyFontSize * 1.15) {
        if (rank === 0) return isBold ? 'h1' : 'h2';
        if (rank === 1) return isBold ? 'h2' : 'h3';
        if (rank >= 2) return 'h3';
    }

    // Body-size bold short text → h4
    if (isBold && text.length < 120 && !text.endsWith('.') && !text.endsWith(',')) return 'h4';

    // ALL CAPS short bold → h4
    if (isBold && text === text.toUpperCase() && text !== text.toLowerCase() && text.length < 80) return 'h4';

    return 'p';
}

function applyInlineStyles(para, escapedText) {
    // If all items in the paragraph are bold, wrap in <strong>
    const allBold = para.lines.every(l => l.items.every(i => i.isBold));
    const allItalic = para.lines.every(l => l.items.every(i => i.isItalic));
    if (allBold) return `<strong>${escapedText}</strong>`;
    if (allItalic) return `<em>${escapedText}</em>`;
    return escapedText;
}

function flushList(parts, items, type) {
    if (!items.length || !type) return;
    const tag = type;
    const lis = items.map(t => `  <li>${escapeHTML(t)}</li>`).join('\n');
    parts.push(`<${tag}>\n${lis}\n</${tag}>`);
}

function escapeHTML(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
