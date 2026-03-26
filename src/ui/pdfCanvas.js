/**
 * pdfCanvas.js
 * Renders a pdfjs document to canvas elements in a given container.
 * Returns array of page-wrapper elements for navigation registration.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.5;

/**
 * Render all pages of a pdfjs document into the given container.
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {string} [containerId='pdf-canvas-container']
 * @returns {Promise<HTMLElement[]>} array of page-wrapper divs
 */
export async function renderPDFToCanvas(pdfDoc, containerId = 'pdf-canvas-container') {
    const container = document.getElementById(containerId);
    if (!container) return [];
    container.innerHTML = '';

    const wrappers = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: SCALE });

        const wrapper = document.createElement('div');
        wrapper.className = 'page-wrapper';
        wrapper.style.width  = viewport.width  + 'px';
        wrapper.style.height = viewport.height + 'px';
        wrapper.dataset.page = pageNum;
        wrapper.contentEditable = 'true';

        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.display = 'block';
        canvas.contentEditable = 'false'; // canvas itself not editable
        wrapper.appendChild(canvas);

        const textLayer = document.createElement('div');
        textLayer.className = 'editable-text-layer';
        wrapper.appendChild(textLayer);

        container.appendChild(wrapper);
        wrappers.push(wrapper);

        // Render canvas perfectly via native PDF.js
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
    }

    return wrappers;
}
