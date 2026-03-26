/**
 * aiPipeline.js
 *
 * AI-assisted PDF → semantic HTML extraction pipeline.
 *
 * Two-track architecture:
 *   Track A: MuPDF WASM → spatial text items (reused from existing pipeline)
 *   Track B: High-DPI canvas → ONNX layout model → labeled bounding boxes
 *
 * Merge: AI regions define structure, MuPDF items provide text content.
 *
 * Stages:
 *   1. MuPDF text extraction + font stats (same as legacy)
 *   2. Header/footer pre-pass (same as legacy)
 *   3. Render page to high-DPI image
 *   4. Layout detection via ONNX worker → AI regions
 *   5. Coordinate normalization + item-to-region assignment
 *   6. Table regions → OpenCV worker → cell grids
 *   7. Reading order via XY-cut on regions
 *   8. Build JSON tree
 *   9. Convert to HTML
 *
 * Falls back to legacy pipeline.js if the AI model is unavailable.
 */

import { openDocument, extractPageItems, extractPageImageBBoxes, collectDocStats } from './mupdfExtractor.js';
import { separateHeaderFooter, buildHeaderFooterSets } from './headerFooterDetector.js';
import { modelToPage, assignItemsToRegions, resolveOverlaps } from './coordNormalizer.js';
import { sortReadingOrder } from './readingOrder.js';
import { treeToHTML } from './treeToHTML.js';
import { loadPdfjsDocument, renderPageToImage } from './pageRenderer.js';
import { clusterIntoLines, groupIntoParagraphs } from './lineClusterer.js';

// ── Worker management ─────────────────────────────────────────────────────

let layoutWorker = null;
let opencvWorker = null;
let layoutWorkerReady = false;
let opencvWorkerReady = false;

/**
 * Initialize the layout detection worker. Call this early (e.g., on page load).
 * Resolves when the model is loaded and ready for inference.
 *
 * @returns {Promise<void>}
 */
export function initLayoutWorker() {
    if (layoutWorker && layoutWorkerReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
        layoutWorker = new Worker(
            new URL('../workers/layoutWorker.js', import.meta.url),
            { type: 'module' }
        );

        layoutWorker.onmessage = (e) => {
            if (e.data.type === 'ready') {
                layoutWorkerReady = true;
                resolve();
            } else if (e.data.type === 'error') {
                reject(new Error(e.data.error));
            }
        };

        layoutWorker.onerror = (err) => reject(err);
        layoutWorker.postMessage({ type: 'init' });
    });
}

/**
 * Initialize the OpenCV worker on demand.
 */
function initOpenCVWorker() {
    if (opencvWorker && opencvWorkerReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
        opencvWorker = new Worker(
            new URL('../workers/opencvWorker.js', import.meta.url),
            { type: 'module' }
        );

        opencvWorker.onmessage = (e) => {
            if (e.data.type === 'ready') {
                opencvWorkerReady = true;
                resolve();
            } else if (e.data.type === 'error') {
                reject(new Error(e.data.error));
            }
        };

        opencvWorker.onerror = (err) => reject(err);
        opencvWorker.postMessage({ type: 'init' });
    });
}

/**
 * Terminate the OpenCV worker (free memory after table processing).
 */
export function disposeOpenCVWorker() {
    if (opencvWorker) {
        opencvWorker.terminate();
        opencvWorker = null;
        opencvWorkerReady = false;
    }
}

/**
 * Check if the layout model is loaded and ready.
 */
export function isModelReady() {
    return layoutWorkerReady;
}

// ── Worker communication helpers ──────────────────────────────────────────

function detectLayout(imageBitmap) {
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            layoutWorker.removeEventListener('message', handler);
            if (e.data.type === 'result') resolve(e.data.regions);
            else reject(new Error(e.data.error || 'Layout detection failed'));
        };
        layoutWorker.addEventListener('message', handler);
        layoutWorker.postMessage(
            { type: 'detect', data: { imageBitmap } },
            [imageBitmap]  // transfer ownership
        );
    });
}

function extractTableGrid(imageBitmap, tableBBox, imageWidth, imageHeight) {
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            opencvWorker.removeEventListener('message', handler);
            if (e.data.type === 'result') resolve(e.data.grid);
            else reject(new Error(e.data.error || 'Grid extraction failed'));
        };
        opencvWorker.addEventListener('message', handler);
        opencvWorker.postMessage({
            type: 'extractGrid',
            data: { imageBitmap, tableBBox, imageWidth, imageHeight },
        });
    });
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────

/**
 * Extract semantic HTML from a PDF using the AI-assisted pipeline.
 *
 * @param {Uint8Array} pdfBytes
 * @param {(stage: string, done?: number, total?: number) => void} [onProgress]
 * @returns {Promise<{ html: string, jsonTree: object }>}
 */
export async function extractWithAI(pdfBytes, onProgress) {
    // ── Ensure layout worker is ready ─────────────────────────────────
    if (!layoutWorkerReady) {
        onProgress?.('loading-model');
        await initLayoutWorker();
    }

    onProgress?.('extracting');

    // ── Stage 1: MuPDF extraction (Track A) ───────────────────────────
    const { doc, numPages } = openDocument(pdfBytes);
    const stats = collectDocStats(doc);

    // Load pdfjs doc for canvas rendering (Track B)
    const pdfjsDoc = await loadPdfjsDocument(pdfBytes);

    // ── Stage 2: Header/footer pre-pass ───────────────────────────────
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

    // ── Main pass: process each page ──────────────────────────────────
    const jsonTree = { pages: [] };
    let hasTableRegions = false;

    for (let p = 0; p < numPages; p++) {
        onProgress?.('analyzing', p + 1, numPages);

        const { items, pageWidth, pageHeight } = pageCache[p];

        // Filter headers/footers from body items
        const bodyItems = items.filter(
            it => !headers.has(it.str.trim()) && !footers.has(it.str.trim())
        );

        // ── Stage 3: Render page to image (Track B) ──────────────────
        const { imageBitmap, width: imgW, height: imgH } = await renderPageToImage(pdfjsDoc, p);

        // ── Stage 4: Layout detection ─────────────────────────────────
        let aiRegions;
        try {
            const rawRegions = await detectLayout(imageBitmap);

            // Convert model-space bboxes to PDF coords
            aiRegions = rawRegions.map((r, i) => ({
                ...r,
                id: `p${p}_r${i}`,
                bbox: modelToPage(r.bbox, pageWidth, pageHeight),
            }));

            // Resolve overlapping regions
            aiRegions = resolveOverlaps(aiRegions);
        } catch (err) {
            console.warn(`AI layout detection failed for page ${p + 1}:`, err);
            // Fallback: create a single "text" region covering the whole page
            aiRegions = [{
                id: `p${p}_fallback`,
                label: 'text',
                confidence: 1.0,
                bbox: { x: 0, y: 0, w: pageWidth, h: pageHeight },
            }];
        }

        // ── Stage 5: Assign text items to regions ─────────────────────
        const { assigned, unassigned } = assignItemsToRegions(bodyItems, aiRegions);

        // Build region data with text
        const regions = aiRegions.map(region => {
            const regionItems = assigned.get(region.id) || [];
            // Sort items top-to-bottom, left-to-right within the region
            regionItems.sort((a, b) => b.y - a.y || a.x - b.x);

            // Compute text and style from items
            const lines = clusterItemsIntoText(regionItems);
            const text = lines.join(' ').replace(/\s+/g, ' ').trim();

            const styles = computeStyles(regionItems);
            const isTable = region.label === 'table';
            if (isTable) hasTableRegions = true;

            return {
                ...region,
                text,
                items: regionItems,
                styles,
                grid: null,  // populated in Phase 3 for tables
                htmlTag: resolveHTMLTag(region.label),
            };
        });

        // Handle unassigned items — cluster into paragraphs using legacy logic
        if (unassigned.length > 0) {
            const fallbackLines = clusterIntoLines(unassigned);
            const fallbackParas = groupIntoParagraphs(fallbackLines);

            for (const para of fallbackParas) {
                regions.push({
                    id: `p${p}_unassigned_${regions.length}`,
                    label: 'text',
                    confidence: 0,
                    bbox: computeBBox(para.lines.flatMap(l => l.items)),
                    readingOrder: -1,
                    text: para.text,
                    items: para.lines.flatMap(l => l.items),
                    styles: computeStyles(para.lines.flatMap(l => l.items)),
                    grid: null,
                    htmlTag: 'p',
                });
            }
        }

        // ── Stage 7: Reading order ────────────────────────────────────
        const orderedRegions = sortReadingOrder(regions, pageWidth, pageHeight);

        // Get image bboxes for picture placeholders
        const imageBBoxes = extractPageImageBBoxes(doc, p);

        jsonTree.pages.push({
            pageIndex: p,
            width: pageWidth,
            height: pageHeight,
            regions: orderedRegions,
            imageBBoxes,
        });
    }

    // ── Stage 6: Table refinement via OpenCV ──────────────────────────
    if (hasTableRegions) {
        onProgress?.('refining-tables');
        try {
            await initOpenCVWorker();

            for (const page of jsonTree.pages) {
                const tableRegions = page.regions.filter(r => r.label === 'table');
                if (!tableRegions.length) continue;

                // Re-render page for OpenCV (need a fresh ImageBitmap since we transferred the previous one)
                const { imageBitmap, width: imgW, height: imgH } = await renderPageToImage(pdfjsDoc, page.pageIndex);

                for (const tableRegion of tableRegions) {
                    try {
                        // Convert PDF bbox to image pixel coords for OpenCV
                        const scaleX = imgW / page.width;
                        const scaleY = imgH / page.height;
                        const imgBBox = {
                            x: tableRegion.bbox.x * scaleX,
                            y: (page.height - tableRegion.bbox.y - tableRegion.bbox.h) * scaleY,
                            w: tableRegion.bbox.w * scaleX,
                            h: tableRegion.bbox.h * scaleY,
                        };

                        const grid = await extractTableGrid(imageBitmap, imgBBox, imgW, imgH);
                        if (grid.rows.length > 1 && grid.cols.length > 1) {
                            // Assign text items to cells
                            tableRegion.grid = buildCellText(tableRegion.items, grid, page.width, page.height, imgW, imgH);
                        }
                    } catch (err) {
                        console.warn('Table grid extraction failed:', err);
                    }
                }
            }

            disposeOpenCVWorker();
        } catch (err) {
            console.warn('OpenCV worker initialization failed:', err);
        }
    }

    // ── Stage 9: Convert JSON tree to HTML ────────────────────────────
    onProgress?.('building-html');
    const html = treeToHTML(jsonTree, stats);

    return { html, jsonTree };
}

// ── HELPERS ───────────────────────────────────────────────────────────────

/**
 * Simple text clustering from items (without full line clustering).
 */
function clusterItemsIntoText(items) {
    if (!items.length) return [];

    // Group by approximate Y position
    const lines = [];
    for (const item of items) {
        const tol = (item.fontSize || 10) * 0.35;
        let found = false;
        for (const line of lines) {
            if (Math.abs(line.y - item.y) <= tol) {
                line.items.push(item);
                found = true;
                break;
            }
        }
        if (!found) {
            lines.push({ y: item.y, items: [item] });
        }
    }

    // Sort lines top-to-bottom, items left-to-right
    lines.sort((a, b) => b.y - a.y);
    return lines.map(l => {
        l.items.sort((a, b) => a.x - b.x);
        return l.items.map(i => i.str).join(' ');
    });
}

function computeStyles(items) {
    if (!items.length) return { bold: false, italic: false, fontSize: 12 };
    const allBold = items.every(i => i.isBold);
    const allItalic = items.every(i => i.isItalic);
    const maxFontSize = Math.max(...items.map(i => i.fontSize || 12));
    return { bold: allBold, italic: allItalic, fontSize: maxFontSize };
}

function computeBBox(items) {
    if (!items.length) return { x: 0, y: 0, w: 0, h: 0 };
    const minX = Math.min(...items.map(i => i.x));
    const minY = Math.min(...items.map(i => i.y));
    const maxX = Math.max(...items.map(i => i.x + (i.width || i.fontSize * 0.5)));
    const maxY = Math.max(...items.map(i => i.y + (i.height || i.fontSize)));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function resolveHTMLTag(label) {
    const map = {
        'title': 'h1',
        'section-heading': 'h2',
        'text': 'p',
        'list-item': 'li',
        'table': 'table',
        'picture': 'figure',
        'caption': 'figcaption',
        'formula': 'div',
        'footnote': 'aside',
    };
    return map[label] || 'p';
}

/**
 * Build a 2D array of cell text from items and OpenCV grid.
 * Grid rows/cols are in image pixel coords — convert to PDF coords for matching.
 */
function buildCellText(items, grid, pageWidth, pageHeight, imgW, imgH) {
    const { rows, cols, cellBounds } = grid;
    if (!cellBounds || !cellBounds.length) return null;

    const scaleX = pageWidth / imgW;
    const scaleY = pageHeight / imgH;

    const numRows = rows.length - 1;
    const numCols = cols.length - 1;
    const cells = Array.from({ length: numRows }, () => Array(numCols).fill(''));

    for (const item of items) {
        // Item center in image coords
        const imgCx = item.x / scaleX + (item.width || item.fontSize * 0.3) / (2 * scaleX);
        // PDF y=0=bottom → image y=0=top
        const imgCy = (pageHeight - item.y) / scaleY;

        // Find which cell contains this point
        for (const cell of cellBounds) {
            if (imgCx >= cell.x && imgCx <= cell.x + cell.w &&
                imgCy >= cell.y && imgCy <= cell.y + cell.h) {
                cells[cell.row][cell.col] += (cells[cell.row][cell.col] ? ' ' : '') + item.str;
                break;
            }
        }
    }

    return { rows, cols, cells };
}
