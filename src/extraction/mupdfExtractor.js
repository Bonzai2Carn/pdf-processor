/**
 * mupdfExtractor.js
 *
 * Replaces pdfExtractor.js + itemEnricher.js + statsCollector.js.
 * Uses MuPDF.js (WASM) for spatially-accurate text extraction.
 *
 * Actual MuPDF.js JSON structure (verified against installed package):
 *   block  → { type:'text'|'image', bbox:{x,y,w,h}, lines:[] }
 *   line   → { wmode, bbox:{x,y,w,h,flags}, font:{name,family,weight,style,size},
 *               x, y, text }
 *
 *   NOTE: There is no 'spans' level. Each line IS a single styled span.
 *         'x','y' on the line are the text-origin (baseline-left) in MuPDF coords.
 *         'bbox' is the visual bounding box.
 *
 * Coordinate convention:
 *   MuPDF returns y=0 at TOP (screen/device space), increasing downward.
 *   All outputs flip to PDF convention: y=0 at BOTTOM, increasing upward.
 *   This keeps every downstream stage (lineClusterer, columnDetector,
 *   headerFooterDetector, tableDetector) working without modification.
 *
 * Item shape (matches itemEnricher.js output contract):
 *   { str, x, y, width, height, fontSize, fontName, isBold, isItalic }
 */

import * as mupdf from 'mupdf';

// ── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Open a PDF document from raw bytes.
 *
 * @param {Uint8Array} bytes
 * @returns {{ doc: object, numPages: number }}
 */
export function openDocument(bytes) {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    return { doc, numPages: doc.countPages() };
}

/**
 * Extract enriched spatial items for one page.
 *
 * Each item is one MuPDF line (= a single styled text run). The `y` value
 * is the text baseline in PDF convention (y=0 at bottom, large = near top).
 *
 * @param {object}  doc        MuPDF document from openDocument()
 * @param {number}  pageIndex  0-based page index
 * @returns {{ items: Array, pageWidth: number, pageHeight: number }}
 */
export function extractPageItems(doc, pageIndex) {
    const page      = doc.loadPage(pageIndex);
    const bounds    = page.getBounds();          // [x0, y0, x1, y1]
    const pageWidth  = bounds[2] - bounds[0];
    const pageHeight = bounds[3] - bounds[1];

    const stext = page.toStructuredText('preserve-whitespace,preserve-spans');
    const { blocks } = JSON.parse(stext.asJSON());

    const items = [];

    for (const block of blocks) {
        if (block.type !== 'text') continue;
        for (const line of block.lines) {
            const str = (line.text || '').trim();
            if (!str) continue;

            const font = line.font || {};

            items.push({
                str,
                x:        line.bbox.x,
                // Flip: MuPDF line.y is the baseline measured from the top
                y:        pageHeight - line.y,
                width:    line.bbox.w,
                height:   line.bbox.h,
                fontSize: font.size  || 12,
                fontName: font.name  || '',
                isBold:   font.weight === 'bold',
                isItalic: font.style  === 'italic',
            });
        }
    }

    // Sort top-to-bottom (descending y in PDF convention), then left-to-right
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    return { items, pageWidth, pageHeight };
}

/**
 * Return bounding boxes for all image blocks on a page.
 * Coordinates are in PDF convention (y=0 at bottom).
 *
 * MuPDF structured text may not expose embedded XObject images; this
 * captures any image blocks it does report.
 *
 * @param {object} doc
 * @param {number} pageIndex  0-based
 * @returns {Array<{ x:number, y:number, width:number, height:number }>}
 */
export function extractPageImageBBoxes(doc, pageIndex) {
    const page   = doc.loadPage(pageIndex);
    const bounds = page.getBounds();
    const pageHeight = bounds[3] - bounds[1];

    const stext = page.toStructuredText('preserve-images');
    const { blocks } = JSON.parse(stext.asJSON());

    return blocks
        .filter(b => b.type === 'image')
        .map(b => ({
            x:      b.bbox.x,
            y:      pageHeight - (b.bbox.y + b.bbox.h),
            width:  b.bbox.w,
            height: b.bbox.h,
        }));
}

/**
 * Collect document-wide font statistics by sampling up to 10 pages.
 * Returns { bodyFontSize, uniqueSizes } — same shape as the old statsCollector.js.
 *
 * @param {object} doc
 * @returns {{ bodyFontSize: number, uniqueSizes: number[] }}
 */
export function collectDocStats(doc) {
    const sizeCounts = new Map();
    const samplePages = Math.min(doc.countPages(), 10);

    for (let p = 0; p < samplePages; p++) {
        const page   = doc.loadPage(p);
        const stext  = page.toStructuredText('preserve-whitespace');
        const { blocks } = JSON.parse(stext.asJSON());

        for (const block of blocks) {
            if (block.type !== 'text') continue;
            for (const line of block.lines) {
                const text = (line.text || '').trim();
                if (!text) continue;
                // Round to nearest 0.5pt for histogram bucketing
                const size = Math.round((line.font?.size || 12) * 2) / 2;
                sizeCounts.set(size, (sizeCounts.get(size) || 0) + text.length);
            }
        }
    }

    if (sizeCounts.size === 0) return { bodyFontSize: 12, uniqueSizes: [12] };

    // Body size = size with the most character coverage
    let bodyFontSize = 12, maxCount = 0;
    for (const [size, count] of sizeCounts) {
        if (count > maxCount) { maxCount = count; bodyFontSize = size; }
    }

    // Unique sizes sorted largest → smallest, de-duped within 0.5pt
    const rawSizes = [...sizeCounts.keys()].sort((a, b) => b - a);
    const uniqueSizes = [];
    for (const s of rawSizes) {
        if (!uniqueSizes.some(u => Math.abs(u - s) < 0.6)) uniqueSizes.push(s);
    }

    return { bodyFontSize, uniqueSizes };
}
