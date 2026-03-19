import * as pdfjsLib from 'pdfjs-dist';
// import * as dfd from 'danfojs';
// import { GlobalWorkerOptions } from 'pdfjs-dist';
// Use the outdated table-parser. The new one doesn't work properly
// import { extractPdfTable } from '@mkas3/pdf-table-parser';
// import { PdfDocument } from 'pdf-tables-parser';

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@5.4.530/build/pdf.worker.mjs?url';

async function extractPageText(page) {
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map(item => item.str).join(' ');
    return textItems;
}

// Detect headings based on formatting and relative size
// detectHeading(line, row, avgFontSize) {
//     if (!line || !row || row.length === 0) return null;

//     const fontSize = row[0].fontSize || 12;
//     const fontName = (row[0].fontName || '').toString();
//     const isAllCaps = line === line.toUpperCase() && line !== line.toLowerCase();
//     const isBold = fontName.toLowerCase().includes('bold') || fontName.toLowerCase().includes('black');
//     const isLargerThanBody = fontSize > avgFontSize * 1.1;
//     const isSameAsBody = Math.abs(fontSize - avgFontSize) <= 1;
//     const isUnderlined = line.includes('_') || fontName.toLowerCase().includes('underline') || (row[0].el && (row[0].el.style.textDecoration || '').toLowerCase().includes('underline'));

//     if (isAllCaps && isLargerThanBody) {
//         return 'h4';
//     }

//     if (isBold && isLargerThanBody && !isAllCaps) {
//         return 'h6';
//     }

//     if (isBold && isUnderlined) {
//         return 'h5';
//     }

//     if ((isBold || isAllCaps) && isSameAsBody) {
//         return null;
//     }

//     return null;
// }

// Determine if a new paragraph should start based on patterns and punctuation. 
// Heuristic to also find lists andn bulletings.
function shouldStartNewParagraph(line, currentParagraph) {
    if (!currentParagraph) return true;

    const paragraphStarters = [
        /^\d+\.\s/,           // Numbered lists (1. 2. etc.)
        /^[A-Z]\.\s/,         // Letter lists (A. B. etc.)
        /^•\s|^\*\s|^-\s/,    // Bullet points
        /^[A-Z][A-Z\s]{10,}/,  // All caps lines (likely headings)
        /^\s*$/               // Empty lines
    ];

    for (const pattern of paragraphStarters) {
        if (pattern.test(line)) return true;
    }

    const currentEndsWithPeriod = /[.!?]\s*$/.test(currentParagraph.trim());
    const lineStartsCapital = /^[A-Z]/.test(line.trim());

    if (currentEndsWithPeriod && lineStartsCapital) {
        return true;
    }

    return false;
}

/* ============Images and Figure Linkings=====================*/
function processFigureLinks(text) {
    return text.replace(/Fig\.\s*(\d+)/gi, (match, figNum) => {
        return `<a href="#figure${figNum}" class="figure${figNum}">Fig. ${figNum}</a>`;
    });
}

function processImageCode(text) {
    // if (text) {
    return text.replace(/\b([AL]\d{5,6}[a-zA-Z]?$)\b/ig, (m, code) => {
        const src = code ? `https://techdocs.mlctraining.com/techdocs/IMAGES/${code}.svg` : null;
        return src ? `<div class="img-wrap"><img src="${src}" alt="${code}"><span class="code">${code}</span></div>` : `<div class="code">${code} Not Processed</div>`;
    });
}

function processWarningBlocks(htmlContent) {
    const colors = {
        'ATTENTION': '#90ee90', // lightgreen
        'WARNING': '#ffa500',   // orange
        'CAUTION': '#ffff00',   // yellow
        'NOTICE': '#00008b'     // darkblue
    };

    // Helper to escape HTML characters
    const escapeHtml = (str) => str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

    // re.DOTALL is 's' flag, re.IGNORECASE is 'i' flag
    const startPattern = line.match(/!\s*(WARNING|NOTICE|CAUTION|ATTENTION)|\b(WARNING|NOTICE|CAUTION|ATTENTION)\b[:\-]\s*(.*)/i);
    //might not be using pTagPattern -instead of using pTag, we will use ShouldStartNewParagraph to identify subsequent lines
    const pTagPattern = /<p[^>]*>(.*?)<\/p>/gsi;

    let outParts = [];
    let lastPos = 0;

    // matchAll provides an iterator similar to re.finditer
    for (const m of htmlContent.matchAll(startPattern)) { //iterate through all the contents and match start patterns (eg. WARNING, NOTICE, CAUTION, etc.)
        outParts.push(htmlContent.substring(lastPos, m.index)); //push them into the array until the match start index

        const level = (m[1] || "").toUpperCase();
        if (!colors[level]) {
            outParts.push(m[0]);
            lastPos = m.index + m[0].length;
            continue;
        }

        // Susequent Lines until next heading or non-empty line
        let j = m.index + m[0].length;
        let descParagraphs = [];

        while (true) {
            pTagPattern.lastIndex = j; // Start search from current position (This is currently using a pTag pattern, may later change it to use ShouldStartNewParagraph)
            const nextP = pTagPattern.exec(htmlContent);
            if (!nextP) break;

            const inter = htmlContent.substring(j, nextP.index);
            if (inter.trim() !== "") break;

            const inner = nextP[1].trim();
            const plainText = inner.replace(/<[^>]+>/g, '').trim();

            // Check if heading: all caps, letters/digits/dots, length >= 2
            if (/^[A-Z][A-Z0-9\.\s\-]*$/.test(plainText) && plainText.length >= 2) {
                break;
            }

            descParagraphs.push(inner);
            j = nextP.index + nextP[0].length;
        }

        const descriptionHtml = descParagraphs.map(p => `<p>${p}</p>`).join("").trim();
        const color = colors[level];

        const warningBlock = `
                <table class="warning-block" style="border-collapse:collapse;margin:8px 0;width:100%;">
                  <tbody>
                    <tr>
                      <th style="text-align:left;background-color:${color};padding:8px;border:1px solid #ddd;">
                        ⚠&nbsp;${escapeHtml(level)}
                      </th>
                    </tr>
                    <tr>
                      <td style="padding:8px;border:1px solid #ddd;">
                        ${descriptionHtml}
                      </td>
                    </tr>
                  </tbody>
                </table>`.trim();

        outParts.push(warningBlock);
        lastPos = j;
    }

    outParts.push(htmlContent.substring(lastPos));
    return outParts.join("");
}


// async function renderPDF(file) {
//     try {
//         console.log('Rendering PDF:', file);
//         // add file array:
//         const fileArray = Array.isArray(file) ? file : [file];

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

//             // We'll use the canvas as a placeholder/container and mark the active page.
//             const canvas = document.createElement('canvas');
//             canvas.className = 'pdf-canvas';
//             canvas.dataset.pageNumber = pageNum;
//             canvas.width = viewport.width;
//             canvas.height = viewport.height;

//             // Mark the first page (or whatever page should be active) for styling/interaction
//             if (pageNum === 1) {
//                 canvas.classList.add('active');
//             }

//             const pageDiv = document.createElement('div');
//             pageDiv.className = 'page';
//             pageDiv.contentEditable = true;
//             pageDiv.spellcheck = true;
//             pageDiv.style.position = 'relative';
//             pageDiv.style.width = `${viewport.width}px`;
//             pageDiv.style.height = `${viewport.height}px`;

//             // Create a text layer and position each text item absolutely to keep layout & casing
//             const textLayer = document.createElement('div');
//             textLayer.className = 'textLayer';
//             textLayer.style.position = 'absolute';
//             textLayer.style.left = '0';
//             textLayer.style.top = '0';
//             textLayer.contentEditable = true;
//             textLayer.spellcheck = true;
//             textLayer.style.width = `${viewport.width}px`;
//             textLayer.style.height = `${viewport.height}px`;
//             textLayer.style.pointerEvents = 'auto';
//             textLayer.style.overflow = 'visible';

//             // Convert raw items into positioned spans
//             const positionedItems = textContent.items.map(item => {
//                 // convert PDF text coordinates to viewport coordinates
//                 const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
//                 // approximate font size from transform matrix
//                 const fontSize = Math.hypot(item.transform[0], item.transform[1]) * viewport.scale;
//                 // font info if available
//                 const style = textContent.styles && textContent.styles[item.fontName] ? textContent.styles[item.fontName] : {};
//                 return {
//                     str: item.str,
//                     x,
//                     y,
//                     fontSize,
//                     fontFamily: 'sans-serif',
//                     fontName: item.fontName
//                 };
//             });

//             // Helper: cluster rows by Y (small tolerance) to detect lines/rows
//             function clusterByY(items, tol = 6) {
//                 const rows = [];
//                 items.forEach(it => {
//                     const found = rows.find(r => Math.abs(r.y - it.y) <= tol);
//                     if (found) {
//                         found.items.push(it);
//                         // keep representative y (average)
//                         found.y = (found.y * (found.items.length - 1) + it.y) / found.items.length;
//                     } else {
//                         rows.push({ y: it.y, items: [it] });
//                     }
//                 });
//                 // sort rows top-to-bottom
//                 rows.sort((a, b) => a.y - b.y);
//                 // sort items in row left-to-right
//                 rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
//                 return rows;
//             }

//             const rows = clusterByY(positionedItems);

//             // Basic table detection: consistent column x positions across multiple rows
//             function detectTable(rows, columnTolerance = 8) {
//                 if (rows.length < 2) return null;

//                 // Build dynamic columns by assigning each item to the nearest existing column
//                 const columns = [];
//                 const usage = [];

//                 function addColumn(x) {
//                     columns.push(x);
//                     usage.push(1);
//                 }

//                 function updateColumn(idx, x) {
//                     const prev = columns[idx];
//                     const count = usage[idx];
//                     columns[idx] = (prev * count + x) / (count + 1);
//                     usage[idx] = count + 1;
//                 }

//                 function findClosestIndex(cols, x) {
//                     let best = -1;
//                     let bestDist = Infinity;
//                     for (let i = 0; i < cols.length; i++) {
//                         const d = Math.abs(cols[i] - x);
//                         if (d < bestDist) {
//                             bestDist = d;
//                             best = i;
//                         }
//                     }
//                     return best;
//                 }

//                 rows.forEach(r => {
//                     r.items.forEach(it => {
//                         if (columns.length === 0) {
//                             addColumn(it.x);
//                             return;
//                         }
//                         const idx = findClosestIndex(columns, it.x);
//                         const dist = Math.abs(columns[idx] - it.x);
//                         if (dist <= columnTolerance) {
//                             updateColumn(idx, it.x);
//                         } else {
//                             addColumn(it.x);
//                         }
//                     });
//                 });

//                 // Sort columns left-to-right, carry usage counts
//                 const pairs = columns.map((c, i) => ({ x: c, u: usage[i] }));
//                 pairs.sort((a, b) => a.x - b.x);
//                 const sortedCols = pairs.map(p => p.x);

//                 // Map rows to sorted columns and count per-column row appearances
//                 const colRowCounts = new Array(sortedCols.length).fill(0);
//                 rows.forEach(r => {
//                     const seen = new Array(sortedCols.length).fill(false);
//                     r.items.forEach(it => {
//                         const idx = findClosestIndex(sortedCols, it.x);
//                         if (Math.abs(sortedCols[idx] - it.x) <= columnTolerance) seen[idx] = true;
//                     });
//                     seen.forEach((v, i) => { if (v) colRowCounts[i]++; });
//                 });

//                 // Filter out sparse columns (appear in very few rows)
//                 const minRowAppear = Math.max(1, Math.floor(rows.length / 6)); // tuneable
//                 const finalCols = sortedCols.filter((c, i) => colRowCounts[i] >= minRowAppear);

//                 if (finalCols.length < 2) return null;

//                 // Check overall consistency: enough rows should map to the detected columns
//                 let consistentRows = 0;
//                 rows.forEach(r => {
//                     const mapped = finalCols.map(cx => r.items.some(it => Math.abs(it.x - cx) <= columnTolerance));
//                     if (mapped.filter(Boolean).length >= Math.max(1, Math.floor(finalCols.length / 2))) consistentRows++;
//                 });

//                 if (consistentRows >= Math.max(2, Math.floor(rows.length / 3))) {
//                     return finalCols;
//                 }
//                 return null;
//             }

//             const columns = detectTable(rows);

//             if (columns) {
//                 //create absolutely positioned spans preserving case and approximate styles
//                 // Use visual gridmapper to map it to a <p> for each sentence/line
//                 positionedItems.forEach(it => {
//                     const span = document.createElement('span');
//                     span.textContent = it.str;
//                     span.style.position = 'absolute';
//                     // top in viewport coordinates: PDF y is baseline; adjust by fontSize
//                     span.style.left = `${it.x}px`;
//                     span.style.top = `${it.y - it.fontSize}px`;
//                     span.style.fontSize = `${it.fontSize}px`;
//                     span.style.fontFamily = it.fontFamily;
//                     span.style.whiteSpace = 'pre';
//                     textLayer.appendChild(span);
//                 });
//                 pageDiv.appendChild(textLayer);
//             }

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

async function renderPDF(files) {
    try {
        // Normalize input: accept single file or array
        const fileArray = Array.isArray(files) ? files : [files];

        if (fileArray.length === 0) {
            throw new Error('No files provided');
        }

        // Clear container
        const pagesContainer = document.getElementById('pages');
        pagesContainer.innerHTML = '';

        // Single PDF view
        if (fileArray.length === 1) {
            return await renderSinglePDF(fileArray[0], pagesContainer);
        }

        // Multiple PDFs: side-by-side diff view
        if (fileArray.length === 2) {
            return await renderPDFDiffView(fileArray[0], fileArray[1], pagesContainer);
        }

        // More than 2 PDFs: render sequentially
        if (fileArray.length > 2) {
            console.warn(`${fileArray.length} PDFs provided. Rendering first two in diff view.`);
            return await renderPDFDiffView(fileArray[0], fileArray[1], pagesContainer);
        }

    } catch (error) {
        console.error('PDF Rendering Error:', error);
        throw error;
    }
}

async function renderSinglePDF(file, container) {
    console.log('Rendering single PDF:', file.name);

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdfDoc.numPages;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const textContent = await page.getTextContent();

        // Render canvas - Only render the images.
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.dataset.pageNumber = pageNum;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (pageNum === 1) {
            canvas.classList.add('active');
        }

        // Grab everything on the pdf and place it on the canvas
        const context = canvas.getContext('2d');
        // HIJACK CANVAS TEXT METHODS
        const originalFillText = context.fillText;
        const originalStrokeText = context.strokeText;
        context.fillText = () => { }; //set text to null;
        context.strokeText = () => { };


        await page.render({ canvasContext: context, viewport }).promise;

        context.fillText = originalFillText;
        context.strokeText = originalStrokeText;

        // Create page wrapper
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page';
        pageDiv.style.position = 'relative';
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;

        // Add text layer
        const textLayer = createTextLayer(textContent, viewport, pageDiv);
        pageDiv.appendChild(textLayer);
        pageDiv.appendChild(canvas);

        // Add page number
        const pageNumberDiv = document.createElement('div');
        pageNumberDiv.className = 'page-number';
        pageNumberDiv.textContent = `Page ${pageNum} of ${numPages}`;
        pageDiv.appendChild(pageNumberDiv);

        container.appendChild(pageDiv);
    }

    return numPages;
}

async function renderPDFDiffView(file1, file2, container) {
    console.log('Rendering side-by-side diff view:', file1.name, 'vs', file2.name);

    // Load both PDFs
    const pdf1 = await loadPDFData(file1);
    console.log("pdf 1", pdf1);
    const pdf2 = await loadPDFData(file2);
    console.log("pdf 1", pdf2);

    const maxPages = Math.max(pdf1.numPages, pdf2.numPages);

    // Create diff container
    const diffContainer = document.createElement('div');
    diffContainer.className = 'pdf-diff-container';
    diffContainer.style.display = 'flex';
    diffContainer.style.gap = '10px';
    diffContainer.style.overflow = 'auto';

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const pageComparisonDiv = document.createElement('div');
        pageComparisonDiv.className = 'page-comparison';
        pageComparisonDiv.style.display = 'flex';
        pageComparisonDiv.style.gap = '10px';
        pageComparisonDiv.style.marginBottom = '20px';
        pageComparisonDiv.style.width = '100%';

        // Left side (Original)
        const leftDiv = document.createElement('div');
        leftDiv.className = 'pdf-side original';
        leftDiv.style.flex = '1';
        leftDiv.style.minWidth = '0';

        if (pageNum <= pdf1.numPages) {
            const page = await pdf1.doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const textContent = await page.getTextContent();

            // Render canvas - Only render the images.
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.dataset.pageNumber = pageNum;
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            if (pageNum === 1) {
                canvas.classList.add('active');
            }

            // Grab everything on the pdf and place it on the canvas
            const context = canvas.getContext('2d');
            // HIJACK CANVAS TEXT METHODS
            const originalFillText = context.fillText;
            const originalStrokeText = context.strokeText;
            context.fillText = () => { }; //set text to null;
            context.strokeText = () => { };


            await page.render({ canvasContext: context, viewport }).promise;

            context.fillText = originalFillText;
            context.strokeText = originalStrokeText;
            await page.render({ canvasContext: context, viewport }).promise;

            const pageWrapper = document.createElement('div');
            pageWrapper.style.position = 'relative';
            pageWrapper.style.width = `${viewport.width}px`;
            pageWrapper.style.height = `${viewport.height}px`;

            const textLayer = createTextLayer(textContent, viewport, pageWrapper);
            pageWrapper.appendChild(textLayer);
            pageWrapper.appendChild(canvas);

            leftDiv.appendChild(pageWrapper);
        } else {
            leftDiv.innerHTML = '<p style="text-align: center; color: #999;">No page</p>';
        }

        const leftLabel = document.createElement('div');
        leftLabel.className = 'diff-label original-label';
        leftLabel.textContent = `${file1.name} - Page ${pageNum}`;
        leftLabel.style.fontSize = '12px';
        leftLabel.style.fontWeight = 'bold';
        leftLabel.style.marginBottom = '5px';
        leftDiv.insertBefore(leftLabel, leftDiv.firstChild);

        // Right side (Modified)
        const rightDiv = document.createElement('div');
        rightDiv.className = 'pdf-side modified';
        rightDiv.style.flex = '1';
        rightDiv.style.minWidth = '0';

        if (pageNum <= pdf2.numPages) {
            const page = await pdf2.doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const textContent = await page.getTextContent();

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport }).promise;

            const pageWrapper = document.createElement('div');
            pageWrapper.style.position = 'relative';
            pageWrapper.style.width = `${viewport.width}px`;
            pageWrapper.style.height = `${viewport.height}px`;

            const textLayer = createTextLayer(textContent, viewport, pageWrapper);
            pageWrapper.appendChild(textLayer);
            pageWrapper.appendChild(canvas);

            rightDiv.appendChild(pageWrapper);
        } else {
            rightDiv.innerHTML = '<p style="text-align: center; color: #999;">No page</p>';
        }

        const rightLabel = document.createElement('div');
        rightLabel.className = 'diff-label modified-label';
        rightLabel.textContent = `${file2.name} - Page ${pageNum}`;
        rightLabel.style.fontSize = '12px';
        rightLabel.style.fontWeight = 'bold';
        rightLabel.style.marginBottom = '5px';
        rightDiv.insertBefore(rightLabel, rightDiv.firstChild);

        pageComparisonDiv.appendChild(leftDiv);
        pageComparisonDiv.appendChild(rightDiv);
        diffContainer.appendChild(pageComparisonDiv);
    }

    container.appendChild(diffContainer);
    return maxPages;
}

async function loadPDFData(file) {
    console.log('Loading PDF:', file.name);
    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    return {
        file: file,
        doc: doc,
        numPages: doc.numPages
    };
}

function createTextLayer(textContent, viewport, pageWrapper) {
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    textLayer.style.pointerEvents = 'auto';
    textLayer.style.overflow = 'visible';

    const positionedItems = textContent.items.map(item => {
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontSize = Math.hypot(item.transform[0], item.transform[1]) * viewport.scale;

        return {
            str: item.str,
            x,
            y,
            fontSize,
            fontFamily: 'sans-serif',
            fontName: item.fontName
        };
    });

    positionedItems.forEach(it => {
        const span = document.createElement('span');
        span.textContent = it.str;
        span.style.position = 'absolute';
        span.style.left = `${it.x}px`;
        span.style.top = `${it.y - it.fontSize}px`;
        span.style.fontSize = `${it.fontSize}px`;
        span.style.fontFamily = it.fontFamily;
        span.style.whiteSpace = 'pre';
        textLayer.appendChild(span);
    });

    return textLayer;
}


export default { renderPDF };
