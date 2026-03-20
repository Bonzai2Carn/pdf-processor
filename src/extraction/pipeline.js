/**
 * pipeline.js
 * Orchestrates all 7 extraction stages for a pdfjs document.
 * Returns a semantic HTML string representing the full document.
 */

import { collectDocumentStats } from './statsCollector.js';
import { enrichItems } from './itemEnricher.js';
import { separateHeaderFooter, buildHeaderFooterSets } from './headerFooterDetector.js';
import { detectColumns } from './columnDetector.js';
import { clusterIntoLines, groupIntoParagraphs } from './lineClusterer.js';
import { detectTables } from './tableDetector.js';
import { buildHTML } from './htmlBuilder.js';

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @param {(done:number, total:number) => void} [onProgress]
 * @returns {Promise<string>} full semantic HTML
 */
export async function extractSemanticHTML(pdfDoc, onProgress) {
    // Stage 1 — document-wide font statistics
    const stats = await collectDocumentStats(pdfDoc);

    const headerCandidates = new Map();
    const footerCandidates = new Map();

    // Pass 1 — load all pages, collect header/footer candidates
    const pageData = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
        const page     = await pdfDoc.getPage(p);
        const viewport = page.getViewport({ scale: 1.0 });
        const textContent = await page.getTextContent();
        const items    = enrichItems(textContent.items, textContent.styles);
        const bodyItems = separateHeaderFooter(
            items, viewport.height, headerCandidates, footerCandidates, pdfDoc.numPages
        );
        pageData.push({ page, bodyItems, pageWidth: viewport.width, pageHeight: viewport.height });
        onProgress?.(p, pdfDoc.numPages);
    }

    const { headers, footers } = buildHeaderFooterSets(
        headerCandidates, footerCandidates, pdfDoc.numPages
    );

    // Pass 2 — extract semantic HTML per page
    const pageParts = [];
    for (let p = 0; p < pageData.length; p++) {
        const { page, bodyItems, pageWidth, pageHeight } = pageData[p];

        const filteredItems = bodyItems.filter(
            it => !headers.has(it.str.trim()) && !footers.has(it.str.trim())
        );

        // Stage 4 — column detection
        const columns = detectColumns(filteredItems, pageWidth);

        // Stage 5 — line clustering (across all columns)
        let allLines = [];
        for (const colItems of columns) {
            allLines = allLines.concat(clusterIntoLines(colItems));
        }

        // Stage 6 — table detection (operator-list first, heuristic fallback)
        const tableRegions = await detectTables(page, allLines, pageWidth, pageHeight);

        // Stage 7 — emit semantic HTML
        const paragraphs = groupIntoParagraphs(allLines);
        const pageHTML   = buildHTML(paragraphs, tableRegions, allLines, stats);

        if (pageHTML.trim()) pageParts.push(`<!-- Page ${p + 1} -->\n${pageHTML}`);
    }

    return pageParts.join('\n\n');
}
