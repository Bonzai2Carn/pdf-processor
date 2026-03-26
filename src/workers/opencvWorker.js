/**
 * opencvWorker.js
 *
 * Web Worker for precise table cell grid extraction via OpenCV.js.
 *
 * Messages:
 *   "init"        → Load OpenCV.js WASM. Posts { type: 'ready' }.
 *   "extractGrid" → Receive ImageBitmap + table bounding box, extract cell grid.
 *                   Posts { type: 'result', grid: { rows: number[], cols: number[] } }.
 *   "dispose"     → Release resources. Posts { type: 'disposed' }.
 *
 * Pipeline:
 *   1. Crop table region from page image
 *   2. Grayscale → adaptive threshold → invert
 *   3. Morphological close with horizontal kernel → detect horizontal lines
 *   4. Morphological close with vertical kernel → detect vertical lines
 *   5. Combine → find intersections → sort into grid
 */

let cv = null;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'init':
                await initOpenCV();
                self.postMessage({ type: 'ready' });
                break;

            case 'extractGrid': {
                if (!cv) throw new Error('OpenCV not initialized. Send "init" first.');
                const grid = extractGrid(
                    data.imageBitmap,
                    data.tableBBox,
                    data.imageWidth,
                    data.imageHeight
                );
                self.postMessage({ type: 'result', grid });
                break;
            }

            case 'dispose':
                cv = null;
                self.postMessage({ type: 'disposed' });
                break;

            default:
                self.postMessage({ type: 'error', error: `Unknown message type: ${type}` });
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};

// ── OPENCV LOADING ────────────────────────────────────────────────────────

async function initOpenCV() {
    if (cv) return;

    // ES module workers can't use importScripts(). Load opencv.js via fetch +
    // Function() to execute it in the worker's global scope.
    const response = await fetch('/wasm/opencv.js');
    if (!response.ok) throw new Error(`Failed to load OpenCV.js: ${response.status}`);
    const scriptText = await response.text();

    // Execute the script in worker scope (opencv.js attaches cv to globalThis)
    const fn = new Function(scriptText);
    fn.call(self);

    // Wait for the WASM module to be ready (opencv.js may init asynchronously)
    if (typeof self.cv === 'function') {
        // opencv.js 4.x exports a factory function
        cv = await self.cv();
    } else if (self.cv && self.cv.Mat) {
        cv = self.cv;
    } else {
        cv = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('OpenCV.js init timed out')), 30000);
            const check = setInterval(() => {
                if (self.cv && self.cv.Mat) {
                    clearInterval(check);
                    clearTimeout(timeout);
                    resolve(self.cv);
                }
            }, 100);
        });
    }
}

// ── GRID EXTRACTION ───────────────────────────────────────────────────────

/**
 * Extract table cell grid from a page image.
 *
 * @param {ImageBitmap} imageBitmap  Full page image
 * @param {{ x: number, y: number, w: number, h: number }} tableBBox  in image pixel coords
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @returns {{ rows: number[], cols: number[], cellBounds: Array }}
 */
function extractGrid(imageBitmap, tableBBox, imageWidth, imageHeight) {
    // Draw ImageBitmap to canvas to get pixel data
    const canvas = new OffscreenCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);

    // Crop table region
    const { x, y, w, h } = tableBBox;
    const cropX = Math.max(0, Math.round(x));
    const cropY = Math.max(0, Math.round(y));
    const cropW = Math.min(Math.round(w), imageWidth - cropX);
    const cropH = Math.min(Math.round(h), imageHeight - cropY);

    if (cropW < 10 || cropH < 10) {
        return { rows: [], cols: [], cellBounds: [] };
    }

    const cropData = ctx.getImageData(cropX, cropY, cropW, cropH);

    // Load into OpenCV Mat
    const src = cv.matFromImageData(cropData);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Adaptive threshold → invert (lines become white on black)
    const thresh = new cv.Mat();
    cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 5);

    // ── Detect horizontal lines ─────────────────────────────────────────
    const hKernelSize = Math.max(Math.round(cropW / 15), 10);
    const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hKernelSize, 1));
    const hLines = new cv.Mat();
    cv.morphologyEx(thresh, hLines, cv.MORPH_OPEN, hKernel);

    // ── Detect vertical lines ───────────────────────────────────────────
    const vKernelSize = Math.max(Math.round(cropH / 15), 10);
    const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vKernelSize));
    const vLines = new cv.Mat();
    cv.morphologyEx(thresh, vLines, cv.MORPH_OPEN, vKernel);

    // ── Combine and find intersections ──────────────────────────────────
    const combined = new cv.Mat();
    cv.add(hLines, vLines, combined);

    // Find contours of horizontal lines to get row boundaries
    const rows = findLineCenters(hLines, 'horizontal', cropH);
    const cols = findLineCenters(vLines, 'vertical', cropW);

    // Add edge boundaries if not already present
    if (rows.length && rows[0] > 3) rows.unshift(0);
    if (rows.length && rows[rows.length - 1] < cropH - 3) rows.push(cropH);
    if (cols.length && cols[0] > 3) cols.unshift(0);
    if (cols.length && cols[cols.length - 1] < cropW - 3) cols.push(cropW);

    // Offset back to full-image coordinates
    const absRows = rows.map(r => r + cropY);
    const absCols = cols.map(c => c + cropX);

    // Build cell bounds
    const cellBounds = [];
    for (let r = 0; r < absRows.length - 1; r++) {
        for (let c = 0; c < absCols.length - 1; c++) {
            cellBounds.push({
                row: r, col: c,
                x: absCols[c], y: absRows[r],
                w: absCols[c + 1] - absCols[c],
                h: absRows[r + 1] - absRows[r],
            });
        }
    }

    // Clean up OpenCV Mats
    src.delete(); gray.delete(); thresh.delete();
    hKernel.delete(); vKernel.delete();
    hLines.delete(); vLines.delete(); combined.delete();

    return { rows: absRows, cols: absCols, cellBounds };
}

/**
 * Find the center Y (or X) positions of detected lines.
 * Projects the binary line image onto the perpendicular axis
 * and finds peaks.
 */
function findLineCenters(lineMat, direction, axisDim) {
    const projection = new Array(axisDim).fill(0);

    const data = lineMat.data;
    const w = lineMat.cols;
    const h = lineMat.rows;

    if (direction === 'horizontal') {
        // Project horizontally: for each row, count white pixels
        for (let row = 0; row < h; row++) {
            let count = 0;
            for (let col = 0; col < w; col++) {
                if (data[row * w + col] > 128) count++;
            }
            projection[row] = count;
        }
    } else {
        // Project vertically: for each col, count white pixels
        for (let col = 0; col < w; col++) {
            let count = 0;
            for (let row = 0; row < h; row++) {
                if (data[row * w + col] > 128) count++;
            }
            projection[col] = count;
        }
    }

    // Find peaks (runs of high values)
    const threshold = direction === 'horizontal' ? w * 0.2 : h * 0.2;
    const centers = [];
    let inPeak = false;
    let peakStart = 0;

    for (let i = 0; i < axisDim; i++) {
        if (projection[i] >= threshold) {
            if (!inPeak) { inPeak = true; peakStart = i; }
        } else {
            if (inPeak) {
                centers.push(Math.round((peakStart + i - 1) / 2));
                inPeak = false;
            }
        }
    }
    if (inPeak) {
        centers.push(Math.round((peakStart + axisDim - 1) / 2));
    }

    return centers;
}
