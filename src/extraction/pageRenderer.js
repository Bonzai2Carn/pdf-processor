/**
 * pageRenderer.js
 *
 * Renders a PDF page to a high-DPI canvas for AI model input.
 * Uses pdfjs-dist to produce an ImageBitmap that can be transferred
 * to a Web Worker without copying.
 *
 * The rendered image is full-page (text + graphics) at a configurable DPI
 * scale, suitable for feeding into a document layout detection model.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Default render scale: 2x = 144 DPI (good balance of quality vs memory) */
const DEFAULT_SCALE = 2.0;

/**
 * Load a pdfjs document from raw bytes.
 * Cached separately from MuPDF — pdfjs is used only for canvas rendering.
 *
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdfjsDocument(pdfBytes) {
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
    return loadingTask.promise;
}

/**
 * Render a single PDF page to a canvas and return an ImageBitmap.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {number} pageIndex  0-based page index
 * @param {number} [scale=DEFAULT_SCALE]  render scale (1.0 = 72 DPI)
 * @returns {Promise<{ imageBitmap: ImageBitmap, width: number, height: number }>}
 */
export async function renderPageToImage(pdfDoc, pageIndex, scale = DEFAULT_SCALE) {
    const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs uses 1-based
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height)
    );
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const imageBitmap = await createImageBitmap(canvas);

    return {
        imageBitmap,
        width: canvas.width,
        height: canvas.height,
    };
}

/**
 * Render a page and return raw ImageData (for OpenCV processing).
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {number} pageIndex  0-based
 * @param {number} [scale=DEFAULT_SCALE]
 * @returns {Promise<{ imageData: ImageData, width: number, height: number }>}
 */
export async function renderPageToImageData(pdfDoc, pageIndex, scale = DEFAULT_SCALE) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height)
    );
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    return {
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        width: canvas.width,
        height: canvas.height,
    };
}
