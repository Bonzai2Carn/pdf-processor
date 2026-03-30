/**
 * tableDetector.js; Stage 6
 *
 * Two-strategy table detection:
 *
 * Strategy A (primary): Operator-list grid detection
 *   Uses page.getOperatorList() to find actual drawn horizontal and vertical lines/rectangles.
 *   Real tables in PDFs almost always have drawn cell borders. Intersecting H/V lines
 *   define a grid; text items that fall inside each cell are assigned to it.
 *   This is significantly more reliable than text-position heuristics.
 *
 * Strategy B (fallback): Column-alignment score heuristic
 *   Applied when no drawn grid is found. Detects tables where columns are implied
 *   by consistent X-alignment of text across multiple rows.
 */

// ── OPS CONSTANTS (pdfjs operator codes) ──────────────────────────────────
// We need to import pdfjsLib to access OPS, but to avoid circular worker init,
// we reference the numeric codes directly (stable across pdfjs 2.x):
const OPS = {
    moveTo: 13, lineTo: 14, curveTo: 15, closePath: 17,
    stroke: 19, fill: 24, fillStroke: 28, eoFill: 25,
    constructPath: 91, rectangle: 26, setLineWidth: 48,
    transform: 12,
};

const MIN_LINE_LENGTH = 10; // px; ignore tiny strokes

// ── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Detect tables on a page.
 *
 * @param {{ fnArray: number[], argsArray: any[] }} opList  - pre-fetched operator list (shared with xycut)
 * @param {Array}  lines                                    - from lineClusterer
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @returns {Array<{startIdx:number, endIdx:number, html:string}>}
 */
export function detectTables(opList, lines, pageWidth, pageHeight) {
    // Strategy A; drawn grid lines
    try {
        const gridTables = detectFromOperatorList(opList, lines, pageWidth, pageHeight);
        if (gridTables.length > 0) return gridTables;
    } catch {
        // Operator list parsing failed, fall through to heuristic
    }

    // Strategy B; column-alignment heuristic
    return detectFromAlignment(lines, pageWidth);
}

// ── STRATEGY A: OPERATOR LIST ─────────────────────────────────────────────

function detectFromOperatorList(opList, lines, pageWidth, pageHeight) {
    const { fnArray, argsArray } = opList;

    // Collect path segments in current-transform coordinates
    const hLines = []; // { y, x1, x2 }
    const vLines = []; // { x, y1, y2 }
    const rects  = []; // { x, y, w, h }

    let cx = 0, cy = 0; // current point
    let pathStart = null;
    let ctm = [1, 0, 0, 1, 0, 0]; // current transform matrix

    function applyTransform(x, y) {
        return [
            ctm[0] * x + ctm[2] * y + ctm[4],
            ctm[1] * x + ctm[3] * y + ctm[5],
        ];
    }

    for (let i = 0; i < fnArray.length; i++) {
        const fn   = fnArray[i];
        const args = argsArray[i] || [];

        if (fn === OPS.transform) {
            ctm = args; // replace CTM
            continue;
        }

        if (fn === OPS.rectangle) {
            const [rx, ry, rw, rh] = args;
            const [tx, ty] = applyTransform(rx, ry);
            const [tx2]    = applyTransform(rx + rw, ry);
            const [, ty2]  = applyTransform(rx, ry + rh);
            const w = Math.abs(tx2 - tx), h = Math.abs(ty2 - ty);
            rects.push({ x: Math.min(tx, tx2), y: Math.min(ty, ty2), w, h });
            continue;
        }

        if (fn === OPS.constructPath) {
            // argsArray[i] is [ops, operands]
            const pathOps  = args[0];
            const pathArgs = args[1];
            let ai = 0;
            for (const op of pathOps) {
                if (op === OPS.moveTo) {
                    const [px, py] = applyTransform(pathArgs[ai], pathArgs[ai + 1]);
                    cx = px; cy = py; pathStart = [px, py]; ai += 2;
                } else if (op === OPS.lineTo) {
                    const [px, py] = applyTransform(pathArgs[ai], pathArgs[ai + 1]);
                    classifyLine(cx, cy, px, py, hLines, vLines);
                    cx = px; cy = py; ai += 2;
                } else if (op === OPS.curveTo) {
                    ai += 6; // skip bezier control points
                } else if (op === OPS.closePath && pathStart) {
                    classifyLine(cx, cy, pathStart[0], pathStart[1], hLines, vLines);
                    cx = pathStart[0]; cy = pathStart[1];
                } else if (op === OPS.rectangle) {
                    const [rx, ry, rw, rh] = [pathArgs[ai], pathArgs[ai+1], pathArgs[ai+2], pathArgs[ai+3]];
                    const [tx, ty] = applyTransform(rx, ry);
                    const [tx2]    = applyTransform(rx + rw, ry);
                    const [, ty2]  = applyTransform(rx, ry + rh);
                    const w = Math.abs(tx2 - tx), h = Math.abs(ty2 - ty);
                    rects.push({ x: Math.min(tx, tx2), y: Math.min(ty, ty2), w, h });
                    ai += 4;
                }
            }
            continue;
        }

        if (fn === OPS.moveTo) {
            const [px, py] = applyTransform(args[0], args[1]);
            cx = px; cy = py; pathStart = [px, py];
        } else if (fn === OPS.lineTo) {
            const [px, py] = applyTransform(args[0], args[1]);
            classifyLine(cx, cy, px, py, hLines, vLines);
            cx = px; cy = py;
        } else if (fn === OPS.closePath && pathStart) {
            classifyLine(cx, cy, pathStart[0], pathStart[1], hLines, vLines);
        }
    }

    // Expand rects into 4 border lines
    for (const r of rects) {
        if (r.w > MIN_LINE_LENGTH) {
            hLines.push({ y: r.y,       x1: r.x,       x2: r.x + r.w });
            hLines.push({ y: r.y + r.h, x1: r.x,       x2: r.x + r.w });
        }
        if (r.h > MIN_LINE_LENGTH) {
            vLines.push({ x: r.x,       y1: r.y, y2: r.y + r.h });
            vLines.push({ x: r.x + r.w, y1: r.y, y2: r.y + r.h });
        }
    }

    if (!hLines.length || !vLines.length) return [];

    // Cluster line positions to find unique row/column boundaries
    const rowY  = clusterValues(hLines.map(l => l.y), pageHeight * 0.008);
    const colX  = clusterValues(vLines.map(l => l.x), pageWidth  * 0.008);

    if (rowY.length < 2 || colX.length < 2) return [];

    // Each rectangle formed by consecutive rowY/colX pairs is a cell
    // Map text lines into cells
    return buildTablesFromGrid(rowY, colX, lines, pageHeight);
}

function classifyLine(x1, y1, x2, y2, hLines, vLines) {
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dx > dy && dx > MIN_LINE_LENGTH) {
        hLines.push({ y: (y1 + y2) / 2, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
    } else if (dy > dx && dy > MIN_LINE_LENGTH) {
        vLines.push({ x: (x1 + x2) / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    }
}

function clusterValues(values, tol) {
    const sorted = [...values].sort((a, b) => a - b);
    const clusters = [];
    for (const v of sorted) {
        const last = clusters[clusters.length - 1];
        if (last !== undefined && Math.abs(last - v) < tol) {
            clusters[clusters.length - 1] = (last + v) / 2; // running average
        } else {
            clusters.push(v);
        }
    }
    return clusters;
}

function buildTablesFromGrid(rowY, colX, lines, _pageHeight) {
    // PDF y=0 is bottom; rowY may be in PDF coords. Convert to viewport coords if needed.
    // lines from lineClusterer are also in PDF coords (raw y from transform[5]).
    // rowY comes from operator coords; after applyTransform they should be viewport coords
    // (since viewport.transform is applied during canvas render, not here).
    // For consistency: rowY is in the same space as line.baselineY (PDF raw coords)
    // ONLY if we didn't apply viewport.transform. We didn't; we used raw coords.
    // So rowY is raw PDF coords (y=0 at bottom of page). lines.baselineY is also raw.

    const rowTol = (rowY[1] - rowY[0]) * 0.3 || 3;
    const colTol = (colX[1] - colX[0]) * 0.3 || 3;

    // Build cell grid: cells[row][col] = text[]
    const numRows = rowY.length - 1;
    const numCols = colX.length - 1;
    if (numRows < 1 || numCols < 1) return [];

    const cells = Array.from({ length: numRows }, () => Array(numCols).fill(''));

    // Assign each line item to a cell
    for (const line of lines) {
        for (const item of line.items) {
            const ix = item.x, iy = item.y;
            // Find row: item.y is between rowY[r] and rowY[r+1] (PDF bottom-up, so rowY sorted ascending)
            const r = rowY.findIndex((_ry, i) => i < numRows && iy >= rowY[i] && iy <= rowY[i + 1] + rowTol);
            const c = colX.findIndex((_cx, i) => i < numCols && ix >= colX[i] - colTol && ix <= colX[i + 1] + colTol);
            if (r >= 0 && c >= 0) {
                cells[r][c] = (cells[r][c] + ' ' + item.str).trim();
            }
        }
    }

    // Only emit if at least half the cells have content
    const filledCells = cells.flat().filter(t => t.trim()).length;
    if (filledCells < (numRows * numCols) * 0.35) return [];

    // Find line index range covered by this table
    const tableYMin = rowY[0], tableYMax = rowY[numRows];
    const startIdx = lines.findIndex(l => l.baselineY >= tableYMin && l.baselineY <= tableYMax);
    const endIdx   = lines.reduce((acc, l, i) => l.baselineY >= tableYMin && l.baselineY <= tableYMax ? i : acc, startIdx);

    if (startIdx === -1) return [];

    const html = buildTableHTML(cells);
    return [{ startIdx, endIdx, html }];
}

// ── STRATEGY B: COLUMN-ALIGNMENT HEURISTIC ────────────────────────────────

const MIN_ROWS = 3;
const MIN_ANCHORS = 2;
const ALIGNMENT_THRESHOLD = 0.82;
const ANCHOR_ROW_COVERAGE = 0.45;

function detectFromAlignment(lines, pageWidth) {
    const colTol = pageWidth * 0.018;
    const results = [];

    let i = 0;
    while (i < lines.length) {
        const runStart = i;
        let j = i + 1;
        while (j < lines.length) {
            const gap1   = lines[j - 1].baselineY - lines[j].baselineY;
            const refGap = (lines[runStart + 1])
                ? lines[runStart].baselineY - lines[runStart + 1].baselineY
                : gap1;
            if (refGap <= 0 || Math.abs(gap1 - refGap) / Math.max(refGap, 1) > 0.30) break;
            j++;
        }

        const candidate = lines.slice(runStart, j);
        if (candidate.length >= MIN_ROWS) {
            const result = evaluateCandidate(candidate, colTol);
            if (result.isTable) {
                results.push({ startIdx: runStart, endIdx: j - 1, html: result.html });
                i = j;
                continue;
            }
        }
        i++;
    }

    return results;
}

function evaluateCandidate(lines, colTol) {
    const allX = lines.flatMap(l => l.items.map(it => it.x));
    const anchors = clusterX(allX, colTol);
    if (anchors.length < MIN_ANCHORS) return { isTable: false };

    let totalItems = 0, alignedItems = 0;
    const anchorRowHits = new Array(anchors.length).fill(0);

    for (const line of lines) {
        const rowAnchors = new Set();
        for (const item of line.items) {
            totalItems++;
            const idx = nearestAnchor(anchors, item.x, colTol);
            if (idx !== -1) { alignedItems++; rowAnchors.add(idx); }
        }
        rowAnchors.forEach(idx => anchorRowHits[idx]++);
    }

    if (!totalItems) return { isTable: false };
    const score = alignedItems / totalItems;
    const validAnchors = anchors.filter((_, i) => anchorRowHits[i] >= lines.length * ANCHOR_ROW_COVERAGE);

    if (score < ALIGNMENT_THRESHOLD || validAnchors.length < MIN_ANCHORS) return { isTable: false };

    const cells = lines.map(line => {
        const row = new Array(validAnchors.length).fill('');
        for (const item of line.items) {
            const idx = nearestAnchor(validAnchors, item.x, colTol * 2);
            if (idx !== -1) row[idx] = (row[idx] + ' ' + item.str).trim();
        }
        return row;
    });

    return { isTable: true, html: buildTableHTML(cells) };
}

// ── SHARED HTML BUILDER ────────────────────────────────────────────────────

function buildTableHTML(rows) {
    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isHeaderRow = rows[0]?.every(c => {
        const t = c.trim();
        return t && (t === t.toUpperCase() || /^[A-Z][^a-z]{0,30}$/.test(t));
    });

    let html = '<table>\n';
    if (isHeaderRow) {
        html += '  <thead><tr>' + rows[0].map(c => `<th>${esc(c)}</th>`).join('') + '</tr></thead>\n';
        html += '  <tbody>\n';
        rows.slice(1).forEach(r => { html += '    <tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>\n'; });
        html += '  </tbody>\n';
    } else {
        html += '  <tbody>\n';
        rows.forEach(r => { html += '    <tr>' + r.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>\n'; });
        html += '  </tbody>\n';
    }
    return html + '</table>';
}

// ── HELPERS ────────────────────────────────────────────────────────────────

function clusterX(xPositions, tol) {
    const sorted = [...xPositions].sort((a, b) => a - b);
    const clusters = [];
    for (const x of sorted) {
        const existing = clusters.find(c => Math.abs(c.mean - x) < tol);
        if (existing) { existing.sum += x; existing.count++; existing.mean = existing.sum / existing.count; }
        else clusters.push({ mean: x, sum: x, count: 1 });
    }
    return clusters.map(c => c.mean).sort((a, b) => a - b);
}

function nearestAnchor(anchors, x, tol) {
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(anchors[i] - x);
        if (d < tol && d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}
