/**
 * pdfExtractor.js
 *
 * Thin wrapper around pdf-parse v2 (browser build).
 * Exposes three extraction methods per document:
 *
 *   extractText(bytes)   → { pages: [{num, lines: string[], rawText: string}], total }
 *   extractTables(bytes) → { pages: [{num, tables: string[][][]}], total }
 *   extractImages(bytes) → { pages: [{num, images: [{dataUrl, width, height}]}], total }
 *
 * Worker must be at /js/pdf-parse-worker.mjs (copied there by viteStaticCopy or public/).
 *
 * Usage:
 *   import { extractText, extractTables, extractImages } from './pdfExtractor.js';
 */

import { PDFParse } from 'pdf-parse';

let workerSet = false;

function ensureWorker() {
    if (!workerSet) {
        PDFParse.setWorker('/js/pdf-parse-worker.mjs');
        workerSet = true;
    }
}

/**
 * Extract per-page text with line breaks preserved.
 *
 * getText() is called with:
 *   lineEnforce: true    — inserts \n when baseline Y shifts (respects natural lines)
 *   lineThreshold: 5     — Y delta (viewport px) that triggers a new line
 *
 * The raw text per page is then split into lines and returned alongside the
 * full page string so callers can choose which form to work with.
 *
 * @param {Uint8Array} bytes  — raw PDF bytes
 * @returns {Promise<{pages: Array<{num:number, lines:string[], rawText:string}>, total:number}>}
 */
export async function extractText(bytes) {
    ensureWorker();
    const parser = new PDFParse({ data: bytes });
    try {
        const result = await parser.getText({
            lineEnforce: true,
            lineThreshold: 5,
        });

        return {
            total: result.total,
            pages: result.pages.map(p => ({
                num: p.num,
                rawText: p.text,
                // Split into non-empty lines, preserving paragraph gaps as empty strings
                lines: p.text.split('\n'),
            })),
        };
    } finally {
        await parser.destroy();
    }
}

/**
 * Extract tables detected from drawn grid lines in the PDF operator list.
 *
 * Each table is a 2-D array: table[row][col] = cell text string.
 * Pages with no tables return an empty tables array.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{pages: Array<{num:number, tables:string[][][]}>, total:number}>}
 */
export async function extractTables(bytes) {
    ensureWorker();
    const parser = new PDFParse({ data: bytes });
    try {
        const result = await parser.getTable();
        return {
            total: result.total,
            pages: result.pages.map(p => ({
                num: p.num,
                tables: p.tables,   // string[][][]
            })),
        };
    } finally {
        await parser.destroy();
    }
}

/**
 * Extract embedded images from the PDF as PNG data URLs.
 *
 * Images smaller than imageThreshold (px) on either dimension are skipped.
 *
 * @param {Uint8Array} bytes
 * @param {number} [imageThreshold=20]
 * @returns {Promise<{pages: Array<{num:number, images:Array<{dataUrl,width,height,name}>}>, total:number}>}
 */
export async function extractImages(bytes, imageThreshold = 20) {
    ensureWorker();
    const parser = new PDFParse({ data: bytes });
    try {
        const result = await parser.getImage({
            imageDataUrl: true,
            imageThreshold,
        });
        return {
            total: result.total,
            pages: result.pages.map(p => ({
                num: p.pageNumber,
                images: (p.images || []).map(img => ({
                    dataUrl: img.dataUrl,
                    width:   img.width,
                    height:  img.height,
                    name:    img.name,
                })),
            })),
        };
    } finally {
        await parser.destroy();
    }
}

/**
 * Run all three extractions in one pass (shares the same bytes, but three
 * separate parser instances since pdf-parse v2 doesn't support combined calls).
 *
 * @param {Uint8Array} bytes
 * @param {(stage:string)=>void} [onStage]
 * @returns {Promise<{text, tables, images}>}
 */
export async function extractAll(bytes, onStage) {
    onStage?.('text');
    const text   = await extractText(bytes);
    onStage?.('tables');
    const tables = await extractTables(bytes);
    onStage?.('images');
    const images = await extractImages(bytes);
    return { text, tables, images };
}
