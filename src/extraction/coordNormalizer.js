/**
 * coordNormalizer.js
 *
 * Coordinate transforms between three spaces:
 *   1. PDF space  ; MuPDF items: y=0 at BOTTOM, increasing upward.
 *   2. Image space; rendered canvas / AI model input: y=0 at TOP, increasing down.
 *   3. Model space; 640x640 normalized input to YOLOv8.
 *
 * All transforms are pure linear maps (no rotation).
 */

/**
 * Convert a bounding box from model space (640x640) to PDF coordinate space.
 *
 * @param {{ x: number, y: number, w: number, h: number }} modelBox
 * @param {number} pageWidth   PDF page width in points
 * @param {number} pageHeight  PDF page height in points
 * @param {number} [modelSize=640]  Model input dimension
 * @returns {{ x: number, y: number, w: number, h: number }}  PDF coords (y=0=bottom)
 */
export function modelToPage(modelBox, pageWidth, pageHeight, modelSize = 640) {
    const scaleX = pageWidth / modelSize;
    const scaleY = pageHeight / modelSize;

    const x = modelBox.x * scaleX;
    const w = modelBox.w * scaleX;
    // Model y=0 at top → PDF y=0 at bottom: flip vertically
    const imgY = modelBox.y * scaleY;
    const h = modelBox.h * scaleY;
    const y = pageHeight - imgY - h;

    return { x, y, w, h };
}

/**
 * Convert a bounding box from PDF space to model space (640x640).
 *
 * @param {{ x: number, y: number, w: number, h: number }} pdfBox  y=0=bottom
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {number} [modelSize=640]
 * @returns {{ x: number, y: number, w: number, h: number }}  model coords (y=0=top)
 */
export function pageToModel(pdfBox, pageWidth, pageHeight, modelSize = 640) {
    const scaleX = modelSize / pageWidth;
    const scaleY = modelSize / pageHeight;

    const x = pdfBox.x * scaleX;
    const w = pdfBox.w * scaleX;
    // PDF y=0 at bottom → model y=0 at top: flip vertically
    const imgY = pageHeight - pdfBox.y - pdfBox.h;
    const y = imgY * scaleY;
    const h = pdfBox.h * scaleY;

    return { x, y, w, h };
}

/**
 * Convert a bounding box from rendered image pixel space to PDF space.
 *
 * @param {{ x: number, y: number, w: number, h: number }} imgBox  pixel coords (y=0=top)
 * @param {number} imgWidth   rendered image width in pixels
 * @param {number} imgHeight  rendered image height in pixels
 * @param {number} pageWidth  PDF page width in points
 * @param {number} pageHeight PDF page height in points
 * @returns {{ x: number, y: number, w: number, h: number }}  PDF coords (y=0=bottom)
 */
export function imageToPage(imgBox, imgWidth, imgHeight, pageWidth, pageHeight) {
    const scaleX = pageWidth / imgWidth;
    const scaleY = pageHeight / imgHeight;

    const x = imgBox.x * scaleX;
    const w = imgBox.w * scaleX;
    const h = imgBox.h * scaleY;
    const y = pageHeight - (imgBox.y * scaleY) - h;

    return { x, y, w, h };
}

/**
 * Assign MuPDF text items into AI-detected regions by center-point containment.
 * Items not contained by any region are collected into an `unassigned` array.
 *
 * @param {Array<{str, x, y, width, height, fontSize, fontName, isBold, isItalic}>} items
 *        MuPDF items in PDF coords (y=0=bottom)
 * @param {Array<{id, label, confidence, bbox:{x,y,w,h}}>} regions
 *        AI regions with bboxes in PDF coords (y=0=bottom)
 * @returns {{ assigned: Map<string, Array>, unassigned: Array }}
 */
export function assignItemsToRegions(items, regions) {
    const assigned = new Map();
    for (const r of regions) assigned.set(r.id, []);

    const unassigned = [];

    for (const item of items) {
        // Center point of the text item
        const cx = item.x + (item.width || item.fontSize * 0.3) / 2;
        const cy = item.y + (item.height || item.fontSize) / 2;

        let bestRegion = null;
        let bestArea = Infinity;

        for (const region of regions) {
            const b = region.bbox;
            if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
                // Prefer the smallest containing region (most specific)
                const area = b.w * b.h;
                if (area < bestArea) {
                    bestArea = area;
                    bestRegion = region;
                }
            }
        }

        if (bestRegion) {
            assigned.get(bestRegion.id).push(item);
        } else {
            unassigned.push(item);
        }
    }

    return { assigned, unassigned };
}

/**
 * Resolve overlapping AI regions. When two regions overlap significantly,
 * prefer the one with higher confidence or more specific label.
 *
 * Label specificity (higher = more specific):
 *   title, section-heading > list-item, caption, footnote > table, picture > text
 *
 * @param {Array<{id, label, confidence, bbox:{x,y,w,h}}>} regions
 * @param {number} [iouThreshold=0.5]  IoU above which regions are considered overlapping
 * @returns {Array} filtered regions
 */
export function resolveOverlaps(regions, iouThreshold = 0.5) {
    const SPECIFICITY = {
        'title': 6, 'section-heading': 5,
        'list-item': 4, 'caption': 4, 'footnote': 4, 'formula': 4,
        'table': 3, 'picture': 3,
        'text': 2,
        'page-header': 1, 'page-footer': 1,
    };

    const suppressed = new Set();
    const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);

    for (let i = 0; i < sorted.length; i++) {
        if (suppressed.has(sorted[i].id)) continue;
        for (let j = i + 1; j < sorted.length; j++) {
            if (suppressed.has(sorted[j].id)) continue;
            const iou = computeIoU(sorted[i].bbox, sorted[j].bbox);
            if (iou >= iouThreshold) {
                // Suppress the less specific or less confident one
                const specI = SPECIFICITY[sorted[i].label] || 0;
                const specJ = SPECIFICITY[sorted[j].label] || 0;
                if (specJ > specI) {
                    suppressed.add(sorted[i].id);
                } else {
                    suppressed.add(sorted[j].id);
                }
            }
        }
    }

    return regions.filter(r => !suppressed.has(r.id));
}

/**
 * Compute Intersection over Union for two bboxes.
 * @param {{ x, y, w, h }} a
 * @param {{ x, y, w, h }} b
 * @returns {number} IoU in [0, 1]
 */
function computeIoU(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);

    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const inter = interW * interH;

    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    const union = areaA + areaB - inter;

    return union > 0 ? inter / union : 0;
}
