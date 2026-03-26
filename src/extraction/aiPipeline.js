/**
 * aiPipeline.js
 *
 * AI-assisted PDF → semantic HTML extraction pipeline using a Pure Vision architecture.
 *
 * Stages:
 *   1. Render page to high-DPI image (PDF.js)
 *   2. Layout detection via YOLOv8 ONNX worker → semantic regions
 *   3. Coordinate normalization and reading order
 *   4. Crop region bounding boxes from Canvas
 *   5. TrOCR ONNX worker reads crops natively 
 *   6. Convert JSON tree → HTML
 */

import { openDocument, extractPageImageBBoxes, collectDocStats } from './mupdfExtractor.js';
import { loadPdfjsDocument, renderPageToImage } from './pageRenderer.js';
import { modelToPage, resolveOverlaps } from './coordNormalizer.js';
import { sortReadingOrder } from './readingOrder.js';
import { treeToHTML } from './treeToHTML.js';

// ── Worker management ─────────────────────────────────────────────────────

let layoutWorker = null;
let ocrWorker = null;
let layoutWorkerReady = false;
let ocrWorkerReady = false;

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

export function initOcrWorker(onProgress) {
    if (ocrWorker && ocrWorkerReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
        ocrWorker = new Worker(
            new URL('../workers/ocrWorker.js', import.meta.url),
            { type: 'module' }
        );

        ocrWorker.onmessage = (e) => {
            if (e.data.type === 'ready') {
                ocrWorkerReady = true;
                resolve();
            } else if (e.data.type === 'progress') {
                onProgress?.('loading-ocr-progress', e.data);
            } else if (e.data.type === 'error') {
                reject(new Error(e.data.error));
            }
        };

        ocrWorker.onerror = (err) => reject(err);
        ocrWorker.postMessage({ type: 'init' });
    });
}

export function disposeWorkers() {
    if (layoutWorker) {
        layoutWorker.terminate();
        layoutWorker = null;
        layoutWorkerReady = false;
    }
    if (ocrWorker) {
        ocrWorker.terminate();
        ocrWorker = null;
        ocrWorkerReady = false;
    }
}

export function isModelReady() {
    return layoutWorkerReady && ocrWorkerReady;
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
        // Do not transfer imageBitmap here because we need it for OCR crops
        layoutWorker.postMessage({ type: 'detect', data: { imageBitmap } });
    });
}

function extractTextForCrop(imageBitmap) {
    return new Promise((resolve, reject) => {
        const handler = (e) => {
            ocrWorker.removeEventListener('message', handler);
            if (e.data.type === 'result') resolve(e.data.text);
            else reject(new Error(e.data.error || 'OCR failed'));
        };
        ocrWorker.addEventListener('message', handler);
        ocrWorker.postMessage(
            { type: 'extract', data: { imageBitmap } },
            [imageBitmap] // Hand over ownership to save memory
        );
    });
}

async function createCrop(imageBitmap, bboxX, bboxY, bboxW, bboxH) {
    const canvas = new OffscreenCanvas(bboxW, bboxH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, bboxX, bboxY, bboxW, bboxH, 0, 0, bboxW, bboxH);
    return await createImageBitmap(canvas);
}

// ── MAIN PIPELINE ─────────────────────────────────────────────────────────

export async function extractWithAI(pdfBytes, onProgress) {
    if (!layoutWorkerReady) {
        onProgress?.('loading-layout-model');
        await initLayoutWorker();
    }
    if (!ocrWorkerReady) {
        onProgress?.('loading-ocr-model');
        await initOcrWorker(onProgress);
    }

    onProgress?.('extracting');

    const { doc, numPages } = openDocument(pdfBytes);
    const stats = collectDocStats(doc);
    const pdfjsDoc = await loadPdfjsDocument(pdfBytes);

    const jsonTree = { pages: [] };

    for (let p = 0; p < numPages; p++) {
        onProgress?.('analyzing', p + 1, numPages);

        const { imageBitmap, width: imgW, height: imgH } = await renderPageToImage(pdfjsDoc, p);

        // Fetch physical page metrics for HTML coordinate positioning
        const pageNode = doc.loadPage(p);
        const bounds = pageNode.getBounds(); // [x0, y0, x1, y1]
        const pageWidth = bounds[2] - bounds[0];
        const pageHeight = bounds[3] - bounds[1];

        // ── Stage 1: Layout Detection (YOLO) 
        let aiRegions;
        try {
            const rawRegions = await detectLayout(imageBitmap);

            aiRegions = rawRegions.map((r, i) => ({
                ...r,
                id: `p${p}_r${i}`,
                bbox: modelToPage(r.bbox, pageWidth, pageHeight),
            }));

            aiRegions = resolveOverlaps(aiRegions);
        } catch (err) {
            console.warn(`AI layout detection failed for page ${p + 1}:`, err);
            aiRegions = [{
                id: `p${p}_fallback`,
                label: 'text',
                confidence: 1.0,
                bbox: { x: 0, y: 0, w: pageWidth, h: pageHeight },
            }];
        }

        // ── Stage 2: Reading Order Sorting
        const orderedRegions = sortReadingOrder(aiRegions, pageWidth, pageHeight);

        // ── Stage 3: Vision Text Generation (TrOCR)
        for (const region of orderedRegions) {
            const isNonText = ['picture', 'formula'].includes(region.label);

            if (!isNonText) {
                try {
                    // Convert PDF layout bounds back into Image bounds for cropping
                    const scaleX = imgW / pageWidth;
                    const scaleY = imgH / pageHeight;

                    const cropX = Math.round(region.bbox.x * scaleX);
                    // y axis inversion (PDF has y=0 at bottom, image has y=0 at top)
                    const cropY = Math.round((pageHeight - region.bbox.y - region.bbox.h) * scaleY);
                    const cropW = Math.round(region.bbox.w * scaleX);
                    const cropH = Math.round(region.bbox.h * scaleY);

                    // Constrain bounds to prevent canvas errors
                    const cX = Math.max(0, cropX);
                    const cY = Math.max(0, cropY);
                    const cW = Math.min(imgW - cX, cropW);
                    const cH = Math.min(imgH - cY, cropH);

                    if (cW > 0 && cH > 0) {
                        const cropBitmap = await createCrop(imageBitmap, cX, cY, cW, cH);
                        const text = await extractTextForCrop(cropBitmap);
                        region.text = text || '';
                        
                        // If it's a table, TrOCR sometimes returns Markdown we might want to flag
                        if (region.label === 'table') {
                            region.grid = null; // Removed OpenCV dependency
                        }
                    } else {
                        region.text = '';
                    }
                } catch (e) {
                    console.warn('OCR failed for region:', region.id, e);
                    region.text = '';
                }
            } else {
                region.text = '';
            }

            // Fill stub information for legacy `treeToHTML` backwards compatibility
            region.items = [];
            region.styles = { bold: false, italic: false, fontSize: 12 };
            region.htmlTag = resolveHTMLTag(region.label);
        }

        const imageBBoxes = extractPageImageBBoxes(doc, p);

        jsonTree.pages.push({
            pageIndex: p,
            width: pageWidth,
            height: pageHeight,
            regions: orderedRegions,
            imageBBoxes,
        });

        // Clear top-level image Bitmap after processing all crops to free RAM early
        imageBitmap.close();
    }

    onProgress?.('building-html');
    const html = treeToHTML(jsonTree, stats);

    return { html, jsonTree };
}

// ── HELPERS ───────────────────────────────────────────────────────────────

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
