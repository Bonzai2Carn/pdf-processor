/**
 * readingOrder.js
 *
 * Determines reading order for AI-detected regions using a recursive XY-cut
 * on region bounding boxes. Reuses the gap-finding logic from xycut.js but
 * operates on regions rather than individual text items.
 *
 * Reading order convention:
 *   - Vertical cuts → left column first (lower x)
 *   - Horizontal cuts → top section first (higher y in PDF coords, y=0=bottom)
 */

const MAX_DEPTH = 8;

/**
 * Sort AI regions into reading order using recursive XY-cut.
 *
 * @param {Array<{id, label, confidence, bbox:{x,y,w,h}}>} regions
 *        Bboxes in PDF coords (y=0=bottom)
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {Array} regions sorted in reading order, with `readingOrder` index set
 */
export function sortReadingOrder(regions, pageWidth, pageHeight) {
    if (regions.length <= 1) {
        if (regions.length === 1) regions[0].readingOrder = 0;
        return regions;
    }

    const pageBBox = { x: 0, y: 0, w: pageWidth, h: pageHeight };
    const tree = xyCutRegions(regions, pageBBox, 0);
    const sorted = flattenRegionTree(tree);

    sorted.forEach((r, i) => { r.readingOrder = i; });
    return sorted;
}

/**
 * Recursive XY-cut on region bounding boxes.
 */
function xyCutRegions(regions, bbox, depth) {
    if (regions.length <= 1 || depth > MAX_DEPTH) {
        return { type: 'leaf', regions, bbox };
    }

    // Minimum gap thresholds for splitting
    const minVGap = bbox.w * 0.04;
    const minHGap = bbox.h * 0.015;

    // Try vertical cut (columns)
    const vGaps = findGapsOnAxis(regions, bbox, 'x');
    const bestV = vGaps[0];

    if (bestV && bestV.size >= minVGap) {
        const splitX = (bestV.start + bestV.end) / 2;
        const left = regions.filter(r => r.bbox.x + r.bbox.w / 2 < splitX);
        const right = regions.filter(r => r.bbox.x + r.bbox.w / 2 >= splitX);

        if (left.length && right.length) {
            const leftBBox = { ...bbox, w: splitX - bbox.x };
            const rightBBox = { ...bbox, x: splitX, w: bbox.x + bbox.w - splitX };
            return {
                type: 'vcut', bbox,
                children: [
                    xyCutRegions(left, leftBBox, depth + 1),
                    xyCutRegions(right, rightBBox, depth + 1),
                ],
            };
        }
    }

    // Try horizontal cut (sections)
    const hGaps = findGapsOnAxis(regions, bbox, 'y');
    const bestH = hGaps[0];

    if (bestH && bestH.size >= minHGap) {
        const splitY = (bestH.start + bestH.end) / 2;
        // PDF y=0=bottom: "top" regions have higher y
        const top = regions.filter(r => r.bbox.y + r.bbox.h / 2 >= splitY);
        const bottom = regions.filter(r => r.bbox.y + r.bbox.h / 2 < splitY);

        if (top.length && bottom.length) {
            const topBBox = { ...bbox, y: splitY, h: bbox.y + bbox.h - splitY };
            const bottomBBox = { ...bbox, h: splitY - bbox.y };
            return {
                type: 'hcut', bbox,
                children: [
                    xyCutRegions(top, topBBox, depth + 1),     // top first
                    xyCutRegions(bottom, bottomBBox, depth + 1),
                ],
            };
        }
    }

    return { type: 'leaf', regions, bbox };
}

/**
 * Find gaps on the X or Y axis for region bounding boxes.
 */
function findGapsOnAxis(regions, bbox, axis) {
    const isX = axis === 'x';
    const intervals = regions.map(r => ({
        start: isX ? r.bbox.x : r.bbox.y,
        end: isX ? r.bbox.x + r.bbox.w : r.bbox.y + r.bbox.h,
    }));

    const axisMin = isX ? bbox.x : bbox.y;
    const axisMax = isX ? bbox.x + bbox.w : bbox.y + bbox.h;

    const sorted = intervals.filter(iv => iv.end > iv.start).sort((a, b) => a.start - b.start);

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

/**
 * Flatten XY-cut tree into reading-order array of regions.
 */
function flattenRegionTree(node) {
    if (!node) return [];
    if (node.type === 'leaf') {
        // Within a leaf, sort top-to-bottom then left-to-right
        return [...node.regions].sort((a, b) => {
            const dy = (b.bbox.y + b.bbox.h) - (a.bbox.y + a.bbox.h); // top first (higher y)
            if (Math.abs(dy) > 5) return dy;
            return a.bbox.x - b.bbox.x; // left first
        });
    }

    const children = node.children || [];
    if (node.type === 'vcut') {
        // Left first (lower x)
        const sorted = [...children].sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
        return sorted.flatMap(flattenRegionTree);
    }
    // hcut: top first (higher y)
    const sorted = [...children].sort((a, b) => (b.bbox?.y ?? 0) - (a.bbox?.y ?? 0));
    return sorted.flatMap(flattenRegionTree);
}
