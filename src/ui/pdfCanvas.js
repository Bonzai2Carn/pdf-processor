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

        // Render canvas (graphics only)
        const ctx = canvas.getContext('2d');
        // Suppress text rendering so it doesn't double-draw
        const origFill   = ctx.fillText.bind(ctx);
        const origStroke = ctx.strokeText.bind(ctx);
        ctx.fillText   = () => {};
        ctx.strokeText = () => {};
        await page.render({ canvasContext: ctx, viewport }).promise;
        ctx.fillText   = origFill;
        ctx.strokeText = origStroke;

        // Build transparent text overlay for selection/editing
        const textContent = await page.getTextContent();
        buildTextLayer(textContent, viewport, textLayer);
    }

    return wrappers;
}

function buildTextLayer(textContent, viewport, layerEl) {
    for (const item of textContent.items) {
        if (!item.str) continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

        const scaleX = Math.hypot(tx[0], tx[1]);
        const scaleY = Math.hypot(tx[2], tx[3]);
        const fontSize = scaleY;
        const angle    = Math.atan2(tx[1], tx[0]);
        const x = tx[4];
        const y = tx[5] - fontSize;

        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.cssText = `
            left: ${x}px;
            top: ${y}px;
            font-size: ${fontSize}px;
            transform: rotate(${angle}rad) scaleX(${scaleX / (scaleY || 1)});
        `;
        layerEl.appendChild(span);
    }
}
