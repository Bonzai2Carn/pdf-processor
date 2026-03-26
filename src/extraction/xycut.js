/**
 * xycut.js
 * XY-Cut recursive page layout analysis.
 *
 * The algorithm recursively slices a page region by its largest whitespace gap.
 * Vertical cuts (V-cut) create columns; horizontal cuts (H-cut) create sections.
 *
 * Reading order output: V-cut children sorted left→right,
 *                       H-cut children sorted top→bottom (high PDF-y first).
 *
 * Also provides extractImageBBoxesFromOpList() which reads a pre-fetched
 * pdfjs operator list and tracks the CTM to find where images are drawn.
 * Sharing the operator list with tableDetector avoids a second getOperatorList() call.
 */

const MAX_DEPTH = 10;

// pdfjs 2.x operator codes (stable across 2.x releases)
const OP_SAVE         = 1;   // q
const OP_RESTORE      = 2;   // Q
const OP_CONCAT       = 12;  // cm  — sets new CTM
const OP_PAINT_JPEG   = 82;  // paintJpegXObject
const OP_PAINT_IMAGE  = 85;  // paintImageXObject
const OP_PAINT_INLINE = 86;  // paintInlineImageXObject
const OP_PAINT_REPEAT = 88;  // paintImageXObjectRepeat

// ── IMAGE BBOX EXTRACTION ──────────────────────────────────────────────────

/**
 * Extract image bounding boxes from a pre-fetched operator list.
 * Tracks save/restore/concat operators to maintain the CTM stack.
 *
 * @param {{ fnArray: number[], argsArray: any[] }} opList
 * @returns {Array<{x, y, width, height, name}>}  in raw PDF coordinate space (y=0=bottom)
 */
export function extractImageBBoxesFromOpList(opList) {
    const { fnArray, argsArray } = opList;

    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack = [];
    const images = [];

    for (let i = 0; i < fnArray.length; i++) {
        const fn   = fnArray[i];
        const args = argsArray[i];

        if (fn === OP_SAVE) {
            ctmStack.push([...ctm]);
            continue;
        }
        if (fn === OP_RESTORE) {
            if (ctmStack.length) ctm = ctmStack.pop();
            continue;
        }
        if (fn === OP_CONCAT) {
            ctm = matMul(ctm, args);
            continue;
        }
        if (fn === OP_PAINT_JPEG || fn === OP_PAINT_IMAGE || fn === OP_PAINT_INLINE || fn === OP_PAINT_REPEAT) {
            // An image is drawn into the unit square [0,0]→[1,0]→[1,1]→[0,1]
            // transformed by the current CTM. Compute all four corners.
            const corners = [
                applyCtm(ctm, 0, 0),
                applyCtm(ctm, 1, 0),
                applyCtm(ctm, 0, 1),
                applyCtm(ctm, 1, 1),
            ];
            const xs = corners.map(c => c[0]);
            const ys = corners.map(c => c[1]);
            const xMin = Math.min(...xs), xMax = Math.max(...xs);
            const yMin = Math.min(...ys), yMax = Math.max(...ys);
            const w = xMax - xMin, h = yMax - yMin;

            if (w > 4 && h > 4) { // skip 1-pixel decorations
                images.push({ x: xMin, y: yMin, width: w, height: h, name: args?.[0] ?? null });
            }
        }
    }
    return images;
}

// ── XY-CUT ALGORITHM ───────────────────────────────────────────────────────

/**
 * Recursively partition a page region into a layout tree.
 *
 * @param {Array}  items        enriched text items {x, y, width, fontSize, ...}
 * @param {Array}  imageBBoxes  image bboxes from extractImageBBoxesFromOpList
 * @param {{x,y,width,height}} bbox   current region (PDF coords, y=0=bottom)
 * @param {{bodyFontSize:number}} stats
 * @param {number} [depth=0]
 * @returns layout node
 */
export function xyCut(items, imageBBoxes, bbox, stats, depth = 0) {
    if ((!items.length && !imageBBoxes.length) || depth > MAX_DEPTH) {
        return makeLeaf(items, imageBBoxes, bbox);
    }

    // Minimum gap thresholds — tune these for accuracy vs. over-splitting
    const minVGap = Math.max(bbox.width  * 0.020, stats.bodyFontSize * 0.6); // column separator
    const minHGap = Math.max(bbox.height * 0.003, stats.bodyFontSize * 0.35); // section separator

    // ── Try vertical cut (columns) ────────────────────────────────────────
    const vGaps = findXGaps(items, imageBBoxes, bbox);
    const bestV = vGaps[0];

    if (bestV && bestV.size >= minVGap) {
        const leftBbox  = { ...bbox, width: bestV.start - bbox.x };
        const rightBbox = { ...bbox, x: bestV.end, width: bbox.x + bbox.width - bestV.end };

        const tol = 1; // 1-unit tolerance for floating-point edge items
        const leftItems  = items.filter(it => it.x + Math.max(it.width || 0, it.fontSize * 0.3) <= bestV.start + tol);
        const rightItems = items.filter(it => it.x >= bestV.end - tol);
        const leftImgs   = imageBBoxes.filter(img => img.x + img.width <= bestV.start + tol);
        const rightImgs  = imageBBoxes.filter(img => img.x >= bestV.end - tol);

        // Only commit to the cut if both sides have content
        if ((leftItems.length + leftImgs.length) && (rightItems.length + rightImgs.length)) {
            return {
                type: 'vcut', bbox,
                children: [
                    xyCut(leftItems,  leftImgs,  leftBbox,  stats, depth + 1),
                    xyCut(rightItems, rightImgs, rightBbox, stats, depth + 1),
                ].filter(Boolean),
            };
        }
    }

    // ── Try horizontal cut (sections) ────────────────────────────────────
    const hGaps = findYGaps(items, imageBBoxes, bbox);
    const bestH = hGaps[0];

    if (bestH && bestH.size >= minHGap) {
        // PDF y=0=bottom: "top" of page = high y value
        const topBbox    = { ...bbox, y: bestH.end,  height: bbox.y + bbox.height - bestH.end };
        const bottomBbox = { ...bbox,                 height: bestH.start - bbox.y             };

        const tol = 1;
        const topItems    = items.filter(it => it.y >= bestH.end - tol);
        const bottomItems = items.filter(it => it.y + (it.fontSize || 12) <= bestH.start + tol);
        const topImgs     = imageBBoxes.filter(img => img.y >= bestH.end - tol);
        const bottomImgs  = imageBBoxes.filter(img => img.y + img.height <= bestH.start + tol);

        if ((topItems.length + topImgs.length) || (bottomItems.length + bottomImgs.length)) {
            return {
                type: 'hcut', bbox,
                children: [
                    xyCut(topItems,    topImgs,    topBbox,    stats, depth + 1),
                    xyCut(bottomItems, bottomImgs, bottomBbox, stats, depth + 1),
                ].filter(Boolean),
            };
        }
    }

    return makeLeaf(items, imageBBoxes, bbox);
}

/**
 * Flatten the XY-Cut tree into an in-order list of leaf nodes.
 * H-cut: top leaf first (higher y in PDF coords).
 * V-cut: left leaf first (lower x).
 *
 * @param {Object} node
 * @returns {Array<{type:'leaf', items, imageBBoxes, bbox}>}
 */
export function flattenTree(node) {
    if (!node) return [];
    if (node.type === 'leaf') return [node];

    const sorted = [...(node.children || [])].sort((a, b) => {
        if (node.type === 'hcut') return (b.bbox?.y ?? 0) - (a.bbox?.y ?? 0); // top-first
        return (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0);                           // left-first
    });

    return sorted.flatMap(flattenTree);
}

// ── GAP FINDING ────────────────────────────────────────────────────────────

function findXGaps(items, images, bbox) {
    const intervals = [
        ...items.map(it => ({
            start: it.x,
            end:   it.x + Math.max(it.width || 0, it.fontSize * 0.3),
        })),
        ...images.map(img => ({ start: img.x, end: img.x + img.width })),
    ];
    return findGaps(intervals, bbox.x, bbox.x + bbox.width);
}

function findYGaps(items, images, bbox) {
    const intervals = [
        ...items.map(it => ({ start: it.y, end: it.y + (it.fontSize || 12) })),
        ...images.map(img => ({ start: img.y, end: img.y + img.height })),
    ];
    return findGaps(intervals, bbox.y, bbox.y + bbox.height);
}

/**
 * Given a list of [start, end] intervals and an axis range,
 * return empty gaps sorted by size (largest first).
 */
function findGaps(intervals, axisMin, axisMax) {
    if (!intervals.length) {
        return [{ start: axisMin, end: axisMax, size: axisMax - axisMin }];
    }

    const filtered = intervals.filter(iv => iv.end > iv.start);
    const sorted   = filtered.sort((a, b) => a.start - b.start);

    // Merge overlapping intervals
    const merged = [];
    for (const iv of sorted) {
        const last = merged[merged.length - 1];
        if (!last || iv.start > last.end + 0.5) {
            merged.push({ start: iv.start, end: iv.end });
        } else {
            last.end = Math.max(last.end, iv.end);
        }
    }

    // Collect gaps
    const gaps = [];
    let prev = axisMin;
    for (const iv of merged) {
        if (iv.start > prev + 0.5) {
            gaps.push({ start: prev, end: iv.start, size: iv.start - prev });
        }
        prev = Math.max(prev, iv.end);
    }
    if (prev < axisMax - 0.5) {
        gaps.push({ start: prev, end: axisMax, size: axisMax - prev });
    }

    return gaps.sort((a, b) => b.size - a.size);
}

// ── HELPERS ────────────────────────────────────────────────────────────────

function makeLeaf(items, imageBBoxes, bbox) {
    return { type: 'leaf', items, imageBBoxes, bbox };
}

function applyCtm(m, x, y) {
    return [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5],
    ];
}

/** 3×3 affine matrix multiply: result = a * b (column-major 2D transform). */
function matMul(a, b) {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}
