/**
 * imageRenderer.js
 *
 * Renders image regions from a PDF page as base64 PNG data URLs.
 *
 * Strategy:
 *   1. Render the full page to an off-screen canvas with text drawing suppressed
 *      (so only graphics / raster images appear).
 *   2. For each image bbox from the operator list, clip that region into a
 *      separate canvas and export as a data URL.
 *
 * The page canvas is rendered once per call regardless of how many images exist.
 *
 * Coordinate conversion:
 *   PDF coords:    y=0 at BOTTOM, y increases upward.
 *   Canvas coords: y=0 at TOP,    y increases downward.
 *
 *   canvasX = bbox.x  * scale
 *   canvasY = (pageHeight - bbox.y - bbox.height) * scale
 *   where pageHeight is the viewport height in PDF units (viewport.height / scale).
 */

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {Array<{x,y,width,height,name}>}    imageBBoxes  — PDF coord space
 * @param {number} [scale=1.5]
 * @returns {Promise<Array<{bbox, dataUrl:string}>>}
 */
export async function renderImageRegions(page, imageBBoxes, scale = 1.5) {
    if (!imageBBoxes.length) return [];

    const viewport   = page.getViewport({ scale });
    const pdfHeight  = viewport.height / scale; // page height in PDF units

    // Full-page canvas with text suppressed (graphics only)
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');

    // Suppress text rendering so only graphics/raster images appear.
    // pdfjs calls these directly on the context object — override them before render.
    const noop = () => {};
    ctx.fillText         = noop;
    ctx.strokeText       = noop;
    // Also suppress text character positioning calls used by some pdfjs versions
    ctx.showText         = noop;
    ctx.showSpacedText   = noop;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Clip each image region
    const results = [];
    for (const bbox of imageBBoxes) {
        const canvasX = bbox.x    * scale;
        const canvasY = (pdfHeight - bbox.y - bbox.height) * scale;
        const canvasW = bbox.width  * scale;
        const canvasH = bbox.height * scale;

        const x = Math.round(canvasX);
        const y = Math.round(canvasY);
        const w = Math.round(canvasW);
        const h = Math.round(canvasH);

        // Guard against out-of-bounds clips
        if (w < 4 || h < 4 || x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) {
            continue;
        }

        const clip = document.createElement('canvas');
        clip.width  = w;
        clip.height = h;
        clip.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);

        results.push({ bbox, dataUrl: clip.toDataURL('image/png') });
    }

    return results;
}
