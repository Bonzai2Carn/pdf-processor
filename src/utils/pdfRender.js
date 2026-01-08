import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.entry';
// import { text } from 'stream/consumers';

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.entry.js';
class PDFRenderer {
    constructor() {
        this.pageContents = [];
    }
    async renderPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdfDoc.numPages;
            const pagesContainer = document.getElementById('pages');

            // Clear existing pages except first
            while (pagesContainer.children.length >= 1) {
                pagesContainer.removeChild(pagesContainer.lastChild);
            }

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const page = await this.processPage(pdfDoc, pageNum);
                pagesContainer.appendChild(page);
            }

            return numPages;
        } catch (error) {
            console.error('PDF Rendering Error:', error);
            throw error;
        }
    }

    async processPage(pdfDoc, pageNum) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        // Create main page div (overlay-only, no canvas)
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page';
        pageDiv.spellcheck = true;
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.minHeight = `${viewport.height}px`;
        pageDiv.style.position = 'relative';

        // Extract text content and create a flowing, editable overlay (no canvas background)
        const textContent = await page.getTextContent({ normalizeWhitespace: true });
        const overlay = this.createFlowOverlay(textContent, viewport);

        // Extract images (we'll append them into the overlay but not rely on canvas positions)
        const images = await this.extractImages(page, viewport);
        if (images && images.length) images.forEach(img => overlay.appendChild(img));

        pageDiv.appendChild(overlay);

        // Add page number
        const pageNumberDiv = document.createElement('div');
        pageNumberDiv.className = 'page-number';
        pageNumberDiv.textContent = `Page ${pageNum}`;
        pageDiv.appendChild(pageNumberDiv);

        return pageDiv;
    }

    createTextLayer(textContent, viewport) {
        const textLayerDiv = document.createElement('div');
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.left = '0';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.pointerEvents = 'none';

        textContent.items.forEach(item => {
            const span = document.createElement('p');
            const transform = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
            );
            span.style.position = 'absolute';
            span.style.left = `${transform[4]}px`;
            span.style.top = `${transform[5]}px`;
            span.style.fontSize = `${viewport.height}px`;
            span.textContent = item.str;
            textLayerDiv.appendChild(span);
        });

        return textLayerDiv;
    }

    // Create a flowing, editable overlay (not absolutely positioned spans) so text can wrap around images.
    createFlowOverlay(textContent, viewport) {
        const overlay = document.createElement('div');
        overlay.className = 'pdf-flow-overlay';
        overlay.contentEditable = true;
        overlay.spellcheck = true;
        // overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = `${viewport.width}px`;
        overlay.style.minHeight = `${viewport.height}px`;
        overlay.style.pointerEvents = 'auto';
        overlay.style.background = 'transparent';
        overlay.style.whiteSpace = 'normal';
        overlay.style.padding = '12px';
        overlay.style.boxSizing = 'border-box';

        // GRID layout (avoid left/right median splitting). Default columns comes from this.columns
        const cols = (this.columns && Number(this.columns) > 0) ? Number(this.columns) : 1;
        overlay.style.display = 'grid';
        overlay.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        overlay.style.gap = '16px';

        // Convert textContent.items into lightweight items with coordinates & font info
        const items = textContent.items.map(item => {
            const t = item.transform || [];
            const transform = pdfjsLib.Util.transform(viewport.transform, item.transform || [1, 0, 0, 1, 0, 0]);
            return {
                str: item.str || '',
                x: transform[4] || 0,
                y: transform[5] || 0,
                width: item.width || 0,
                height: item.height || 0,
                fontName: item.fontName || '',
                fontSize: Math.abs(t[0]) || 12
            };
        }).filter(it => it.str && it.str.trim());

        // Cluster into rows by Y coordinate (top-to-bottom)
        const rows = this.clusterRows(items);

        // Build flowing HTML content; we won't pre-place images/tables — they'll be appended inline when referenced
        let out = '';
        let currentParagraph = '';

        // Compute average font size for heading heuristics
        const avgFontSize = items.length ? items.reduce((s, it) => s + it.fontSize, 0) / items.length : 12;

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const line = this.buildLineFromRow(row);
            if (!line) continue;

            // Warning/Notice/Caution detection
            const warnMatch = line.match(/!\s*(WARNING|NOTICE|CAUTION|ATTENTION)|\b(WARNING|NOTICE|CAUTION|ATTENTION)\b[:\-]\s*(.*)/i);
            if (warnMatch) {
                if (currentParagraph.trim()) { out += `<p>${this.escapeHtml(currentParagraph.trim())}</p>\n`; currentParagraph = ''; }
                let level = (warnMatch[1] || warnMatch[2] || '').toUpperCase();
                const rest = (warnMatch[3] || line.replace(warnMatch[0], '')).trim();
                if (!level) level = 'WARNING';
                let color;
                switch (level) {
                    case 'ATTENTION': color = '#90ee90'; break;
                    case 'WARNING': color = '#ffa500'; break;
                    case 'CAUTION': color = '#ffff00'; break;
                    case 'NOTICE': color = '#00008b'; break;
                    default: color = '#ffa500'; break;
                }
                out += `<table><tbody><tr><th style="background-color:${color}"><span>⚠</span>${level}</th></tr><tr><td>${this.escapeHtml(rest)}</td></tr></tbody></table>`;
                continue;
            }

            // Heading detection (from pdfConverter.html logic)
            const headingTag = this.detectHeading(line, row, avgFontSize);
            if (headingTag) {
                if (currentParagraph.trim()) { out += `<p>${this.escapeHtml(currentParagraph.trim())}</p>\n`; currentParagraph = ''; }
                const processedLine = this.processFigureLinks(line);
                out += `<${headingTag}>${this.escapeHtml(processedLine)}</${headingTag}>\n`;
                continue;
            }

            // Paragraph decision
            if (this.shouldStartNewParagraph(line, currentParagraph)) {
                if (currentParagraph.trim()) { const processedParagraph = this.processFigureLinks(currentParagraph.trim()); out += `<p>${this.escapeHtml(processedParagraph)}</p>\n`; }
                currentParagraph = line;
            } else {
                currentParagraph += (currentParagraph ? ' ' : '') + line;
            }
        }

        if (currentParagraph.trim()) { const processedParagraph = this.processFigureLinks(currentParagraph.trim()); out += `<p>${this.escapeHtml(processedParagraph)}</p>\n`; }

        overlay.innerHTML = out;
        return overlay;
    }
    async extractImages(page, viewport) {
        const imgs = [];
        try {
            // Get page annotations (which can include images)
            const annotations = await page.getAnnotations();

            for (const annotation of annotations) {
                if (annotation.subtype === 'Image') {
                    try {
                        const img = document.createElement('img');
                        const imgData = await page.objs.get(annotation.id);
                        if (imgData && imgData.src) {
                            img.src = imgData.src;
                        } else if (imgData && imgData.data && imgData.width && imgData.height) {
                            const c = document.createElement('canvas');
                            c.width = imgData.width;
                            c.height = imgData.height;
                            const ctx = c.getContext('2d');
                            ctx.putImageData(new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height), 0, 0);
                            img.src = c.toDataURL();
                        } else {
                            continue;
                        }

                        // Decide float based on horizontal position
                        const x = annotation.rect[0];
                        const pageW = viewport.width;
                        const center = (annotation.rect[0] + annotation.rect[2]) / 2;
                        if (center < pageW * 0.33) img.style.cssFloat = 'left';
                        else if (center > pageW * 0.66) img.style.cssFloat = 'right';

                        img.style.maxWidth = '45%';
                        img.style.margin = '8px';
                        imgs.push(img);
                    } catch (e) {
                        // ignore
                    }
                }
            }

            // Extract embedded images from operator list (best-effort)
            const operatorList = await page.getOperatorList();
            for (let i = 0; i < operatorList.fnArray.length; i++) {
                if (operatorList.fnArray[i] === pdfjsLib.OPS.paintImageXObject || operatorList.fnArray[i] === pdfjsLib.OPS.paintImageXObjectRepeat) {
                    try {
                        const imgIndex = operatorList.argsArray[i][0];
                        const imgData = page.objs.get(imgIndex);
                        if (imgData) {
                            const img = document.createElement('img');
                            if (imgData.src) img.src = imgData.src;
                            else if (imgData.data && imgData.width && imgData.height) {
                                const c = document.createElement('canvas');
                                c.width = imgData.width;
                                c.height = imgData.height;
                                const ctx = c.getContext('2d');
                                ctx.putImageData(new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height), 0, 0);
                                img.src = c.toDataURL();
                            } else {
                                continue;
                            }
                            img.style.display = 'block';
                            img.style.maxWidth = '100%';
                            img.style.margin = '8px 0';
                            imgs.push(img);
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting images:', error);
        }
        return imgs;
    }

    // Cluster items into rows by Y coordinate (top -> bottom)
    clusterRows(items) {
        if (!items || items.length === 0) return [];
        // sort by descending y (top to bottom in PDF space may be reversed depending on transforms)
        const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
        const rows = [];
        let current = [sorted[0]];
        const threshold = Math.max(6, (sorted[0].fontSize || 12) * 0.6);
        for (let i = 1; i < sorted.length; i++) {
            const it = sorted[i];
            const last = current[current.length - 1];
            if (Math.abs(it.y - last.y) <= threshold) {
                current.push(it);
            } else {
                rows.push(current.slice().sort((p, q) => p.x - q.x));
                current = [it];
            }
        }
        if (current && current.length) rows.push(current.slice().sort((p, q) => p.x - q.x));
        return rows;
    }

    // Heuristic heading detection adapted from pdfConverter.html
    detectHeading(line, row, avgFontSize) {
        if (!line || !row || row.length === 0) return null;
        const fontSize = row[0].fontSize || 12;
        const fontName = row[0].fontName || '';
        const isAllCaps = line === line.toUpperCase() && line !== line.toLowerCase();
        const isBold = fontName.toLowerCase().includes('bold') || fontName.toLowerCase().includes('black');
        const isLargerThanBody = fontSize > avgFontSize * 1.1;
        const isSameAsBody = Math.abs(fontSize - avgFontSize) <= 1;
        const isUnderlined = line.includes('_') || fontName.toLowerCase().includes('underline');

        if (isAllCaps && isLargerThanBody) return 'h4';
        if (isBold && isLargerThanBody && !isAllCaps) return 'h6';
        if (isBold && isUnderlined) return 'h5';
        if ((isBold || isAllCaps) && isSameAsBody) return null;
        return null;
    }

    processFigureLinks(text) {
        return (text || '').replace(/Fig\.?\s*(\d+)/gi, (match, figNum) => {
            return `<a href="#figure${figNum}" class="figure${figNum}">Fig. ${figNum}</a>`;
        });
    }

    shouldStartNewParagraph(line, currentParagraph) {
        if (!currentParagraph) return true;
        const paragraphStarters = [
            /^\d+\.\s/,
            /^[A-Z]\.\s/,
            /^•\s|^\*\s|^-\s/,
            /^[A-Z][A-Z\s]{10,}/,
            /^\s*$/
        ];
        for (const pattern of paragraphStarters) if (pattern.test(line)) return true;
        const currentEndsWithPeriod = /[.!?]\s*$/.test(currentParagraph.trim());
        const lineStartsCapital = /^[A-Z]/.test(line.trim());
        if (currentEndsWithPeriod && lineStartsCapital) return true;
        return false;
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Allow client to change number of grid columns (1,2,4...)
    setColumns(n) {
        this.columns = Math.max(1, parseInt(n) || 1);
    }

    // Build a line string from a row using spacing heuristics to avoid bad joins/splits
    buildLineFromRow(row) {
        if (!row || row.length === 0) return '';
        // ensure row sorted by x
        const sorted = row.slice().sort((a, b) => a.x - b.x);
        const parts = [];
        for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i];
            const token = String(cur.str || '').trim();
            if (!token) continue;
            parts.push(token);
            if (i < sorted.length - 1) {
                const next = sorted[i + 1];
                const gap = next.x - (cur.x + (cur.width || (cur.fontSize * token.length * 0.5)));
                const threshold = Math.max(2, (cur.fontSize || 12) * 0.35);
                if (gap > threshold) parts.push(' ');
                // if gap is small, don't force extra space (likely split glyphs)
            }
        }
        // Collapse accidental double spaces
        return parts.join('').replace(/\s+/g, ' ').trim();
    }
}

// async function renderPDF(file) {
//     try {
//         console.log('Rendering PDF:', file);

//         const arrayBuffer = await file.arrayBuffer();
//         console.log('Array Buffer:', arrayBuffer);

//         const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
//         console.log('PDF Document:', pdfDoc);

//         const numPages = pdfDoc.numPages;
//         const pagesContainer = document.getElementById('pages');

//         // Keep the first page, remove others
//         while (pagesContainer.children.length > 1) {
//             pagesContainer.removeChild(pagesContainer.lastChild);
//         }

//         for (let pageNum = 1; pageNum <= numPages; pageNum++) {
//             const page = await pdfDoc.getPage(pageNum);

//             // Extract text content
//             const viewport = page.getViewport({ scale: 1.5 });
//             const textContent = await page.getTextContent();

//             // Create a canvas or div to render the pdf contents
//             const canvas = document.createElement('canvas');
//             const context = canvas.getContext('2d');
//             canvas.width = viewport.width;
//             canvas.height = viewport.height;

//             await page.render({
//                 canvasContext: context,
//                 viewport: viewport
//             }).promise;

//             const pageDiv = document.createElement('div');
//             pageDiv.className = 'page';
//             pageDiv.contentEditable = true;
//             pageDiv.spellcheck = true;

//             // Process text items with potential positioning
//             const textLines = [];
//             let currentLine = '';
//             let lastY = null;

//             textContent.items.forEach(item => {
//                 // Check if item is on a new line based on Y transform
//                 if (lastY !== null && Math.abs(item.transform[5] - lastY) > 10) {
//                     // New line detected
//                     textLines.push(currentLine);
//                     currentLine = '';
//                 }

//                 currentLine += item.str + ' ';
//                 lastY = item.transform[5];
//             });

//             // Add last line
//             if (currentLine.trim()) {
//                 textLines.push(currentLine);
//             }

//             // Create paragraphs to preserve some layout
//             pageDiv.innerHTML = textLines.map(line => `<p>${line.trim()}</p>`).join('');
//             pageDiv.appendChild(canvas);

//             const pageNumberDiv = document.createElement('div');
//             pageNumberDiv.className = 'page-number';
//             pageNumberDiv.textContent = `Page ${pageNum} of ${numPages}`;
//             pageDiv.appendChild(pageNumberDiv);

//             pagesContainer.appendChild(pageDiv);
//         }

//         return numPages;
//     } catch (error) {
//         console.error('Detailed PDF Rendering Error:', error);
//         throw error;
//     }
// }



// Add extract table later using VisualGridMapper
export default new PDFRenderer();
