/**
 * pipeline.js
 *
 * Orchestrates PDF → semantic HTML extraction via MuPDF.js + spatial pipeline.
 *
 * Stage order per page:
 *   1. mupdfExtractor ; spatial items (str, x, y, fontSize, isBold, …)
 *   2. headerFooterDetector; strip repeated top/bottom zone text
 *   3. columnDetector ; split items into per-column groups
 *   4. lineClusterer  ; group items → lines → paragraphs (per column)
 *   5. tableDetector  ; find grid/alignment tables (per column)
 *   6. htmlBuilder    ; emit semantic HTML (per column)
 *
 * Header/footer detection is two-pass:
 *   Pre-pass: accumulate candidates across all pages.
 *   Main pass: separate body items and filter by accumulated sets.
 */

import { openDocument, extractPageItems, extractPageImageBBoxes, collectDocStats } from './mupdfExtractor.js';
import { separateHeaderFooter, buildHeaderFooterSets } from './headerFooterDetector.js';
import { detectColumns }                                from './columnDetector.js';
import { clusterIntoLines, groupIntoParagraphs }        from './lineClusterer.js';
import { detectTables }                                 from './tableDetector.js';
import { buildHTML }                                    from './htmlBuilder.js';

/**
 * @param {Uint8Array} pdfBytes
 * @param {(stage:string, done?:number, total?:number) => void} [onProgress]
 * @returns {Promise<string>} full semantic HTML string
 */
export async function extractSemanticHTML(pdfBytes, onProgress) {

    onProgress?.('extracting');

    // ── Open document ────────────────────────────────────────────────────────
    const { doc, numPages } = openDocument(pdfBytes);

    // ── Stage 1: document-wide font statistics ───────────────────────────────
    onProgress?.('stats');
    const stats = collectDocStats(doc);

    // ── Pre-pass: accumulate header/footer candidates across all pages ───────
    // We cache per-page items so we don't re-parse during the main pass.
    onProgress?.('scanning');
    const pageCache = [];
    const headerCandidates = new Map();
    const footerCandidates = new Map();

    for (let p = 0; p < numPages; p++) {
        const { items, pageWidth, pageHeight } = extractPageItems(doc, p);
        pageCache.push({ items, pageWidth, pageHeight });
        separateHeaderFooter(items, pageHeight, headerCandidates, footerCandidates, numPages);
    }

    const { headers, footers } = buildHeaderFooterSets(headerCandidates, footerCandidates, numPages);

    // ── Main pass: process each page ─────────────────────────────────────────
    const pageParts = [];

    for (let p = 0; p < numPages; p++) {
        onProgress?.('rendering', p + 1, numPages);

        const { items, pageWidth, pageHeight } = pageCache[p];

        // ── Stage 2: separate headers/footers ────────────────────────────────
        const bodyItems = separateHeaderFooter(
            items, pageHeight, new Map(), new Map(), numPages
        ).filter(it => !headers.has(it.str.trim()) && !footers.has(it.str.trim()));

        // ── Stage 3: split into columns ───────────────────────────────────────
        const columnGroups = detectColumns(bodyItems, pageWidth);

        // ── Process each column independently ────────────────────────────────
        const columnParts = [];

        for (const colItems of columnGroups) {
            if (!colItems.length) continue;

            // Stage 4a: cluster into lines
            const lines = clusterIntoLines(colItems);
            if (!lines.length) continue;

            // Stage 5: detect tables
            // opList is null; Strategy A (operator-list) is bypassed; Strategy B
            // (column-alignment heuristic) handles tables automatically.
            const tableRegions = detectTables(null, lines, pageWidth, pageHeight);

            // Stage 4b: group lines into paragraphs
            const paragraphs = groupIntoParagraphs(lines);

            // Stage 6: emit HTML
            columnParts.push(buildHTML(paragraphs, tableRegions, lines, stats));
        }

        // ── Append image placeholders ─────────────────────────────────────────
        const imageBBoxes = extractPageImageBBoxes(doc, p);
        const imagePlaceholders = imageBBoxes.map(() => '<figure data-pdf-image></figure>').join('\n');

        const pageHTML = [...columnParts, imagePlaceholders].filter(Boolean).join('\n');
        if (pageHTML.trim()) {
            pageParts.push(`<!-- Page ${p + 1} -->\n${pageHTML}`);
        }
    }

    return pageParts.join('\n\n');
}
