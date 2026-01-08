import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/build/pdf.worker.entry';

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.entry.js';

async function extractPageText(page) {
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map(item => item.str).join(' ');
    return textItems;
}

async function renderPDF(file) {
    try {
        console.log('Rendering PDF:', file);

        const arrayBuffer = await file.arrayBuffer();
        console.log('Array Buffer:', arrayBuffer);

        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        console.log('PDF Document:', pdfDoc);

        const numPages = pdfDoc.numPages;
        const pagesContainer = document.getElementById('pages');

        // Keep the first page, remove others
        while (pagesContainer.children.length > 1) {
            pagesContainer.removeChild(pagesContainer.lastChild);
        }

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);

            // Extract text content
            const viewport = page.getViewport({ scale: 1.5 });
            const textContent = await page.getTextContent();

            // We'll use the canvas as a placeholder/container and mark the active page.
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-canvas';
            canvas.dataset.pageNumber = pageNum;
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            // Mark the first page (or whatever page should be active) for styling/interaction
            if (pageNum === 1) {
                canvas.classList.add('active');
            }

            const pageDiv = document.createElement('div');
            pageDiv.className = 'page';
            pageDiv.contentEditable = true;
            pageDiv.spellcheck = true;
            pageDiv.style.position = 'relative';
            pageDiv.style.width = `${viewport.width}px`;
            pageDiv.style.height = `${viewport.height}px`;

            // Create a text layer and position each text item absolutely to keep layout & casing
            const textLayer = document.createElement('div');
            textLayer.className = 'textLayer';
            textLayer.style.position = 'absolute';
            textLayer.style.left = '0';
            textLayer.style.top = '0';
            textLayer.contentEditable = true;
            textLayer.spellcheck = true;
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            textLayer.style.pointerEvents = 'auto';
            textLayer.style.overflow = 'visible';

            // Convert raw items into positioned spans
            const positionedItems = textContent.items.map(item => {
                // convert PDF text coordinates to viewport coordinates
                const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                // approximate font size from transform matrix
                const fontSize = Math.hypot(item.transform[0], item.transform[1]) * viewport.scale;
                // font info if available
                const style = textContent.styles && textContent.styles[item.fontName] ? textContent.styles[item.fontName] : {};
                return {
                    str: item.str,
                    x,
                    y,
                    fontSize,
                    fontFamily: style.fontFamily || 'sans-serif',
                    fontName: item.fontName
                };
            });

            // Helper: cluster rows by Y (small tolerance) to detect lines/rows
            function clusterByY(items, tol = 6) {
                const rows = [];
                items.forEach(it => {
                    const found = rows.find(r => Math.abs(r.y - it.y) <= tol);
                    if (found) {
                        found.items.push(it);
                        // keep representative y (average)
                        found.y = (found.y * (found.items.length - 1) + it.y) / found.items.length;
                    } else {
                        rows.push({ y: it.y, items: [it] });
                    }
                });
                // sort rows top-to-bottom
                rows.sort((a, b) => a.y - b.y);
                // sort items in row left-to-right
                rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
                return rows;
            }

            const rows = clusterByY(positionedItems);

            // Basic table detection: consistent column x positions across multiple rows
            function detectTable(rows, columnTolerance = 8) {
                if (rows.length < 2) return null;

                // Build dynamic columns by assigning each item to the nearest existing column
                const columns = [];
                const usage = [];

                function addColumn(x) {
                    columns.push(x);
                    usage.push(1);
                }

                function updateColumn(idx, x) {
                    const prev = columns[idx];
                    const count = usage[idx];
                    columns[idx] = (prev * count + x) / (count + 1);
                    usage[idx] = count + 1;
                }

                function findClosestIndex(cols, x) {
                    let best = -1;
                    let bestDist = Infinity;
                    for (let i = 0; i < cols.length; i++) {
                        const d = Math.abs(cols[i] - x);
                        if (d < bestDist) {
                            bestDist = d;
                            best = i;
                        }
                    }
                    return best;
                }

                rows.forEach(r => {
                    r.items.forEach(it => {
                        if (columns.length === 0) {
                            addColumn(it.x);
                            return;
                        }
                        const idx = findClosestIndex(columns, it.x);
                        const dist = Math.abs(columns[idx] - it.x);
                        if (dist <= columnTolerance) {
                            updateColumn(idx, it.x);
                        } else {
                            addColumn(it.x);
                        }
                    });
                });

                // Sort columns left-to-right, carry usage counts
                const pairs = columns.map((c, i) => ({ x: c, u: usage[i] }));
                pairs.sort((a, b) => a.x - b.x);
                const sortedCols = pairs.map(p => p.x);

                // Map rows to sorted columns and count per-column row appearances
                const colRowCounts = new Array(sortedCols.length).fill(0);
                rows.forEach(r => {
                    const seen = new Array(sortedCols.length).fill(false);
                    r.items.forEach(it => {
                        const idx = findClosestIndex(sortedCols, it.x);
                        if (Math.abs(sortedCols[idx] - it.x) <= columnTolerance) seen[idx] = true;
                    });
                    seen.forEach((v, i) => { if (v) colRowCounts[i]++; });
                });

                // Filter out sparse columns (appear in very few rows)
                const minRowAppear = Math.max(1, Math.floor(rows.length / 6)); // tuneable
                const finalCols = sortedCols.filter((c, i) => colRowCounts[i] >= minRowAppear);

                if (finalCols.length < 2) return null;

                // Check overall consistency: enough rows should map to the detected columns
                let consistentRows = 0;
                rows.forEach(r => {
                    const mapped = finalCols.map(cx => r.items.some(it => Math.abs(it.x - cx) <= columnTolerance));
                    if (mapped.filter(Boolean).length >= Math.max(1, Math.floor(finalCols.length / 2))) consistentRows++;
                });

                if (consistentRows >= Math.max(2, Math.floor(rows.length / 3))) {
                    return finalCols;
                }
                return null;
            }

            const columns = detectTable(rows);

            if (columns) {
                //create absolutely positioned spans preserving case and approximate styles
                // Use visual gridmapper to map it to a <p> for each sentence/line
                positionedItems.forEach(it => {
                    const span = document.createElement('span');
                    span.textContent = it.str;
                    span.style.position = 'absolute';
                    // top in viewport coordinates: PDF y is baseline; adjust by fontSize
                    span.style.left = `${it.x}px`;
                    span.style.top = `${it.y - it.fontSize}px`;
                    span.style.fontSize = `${it.fontSize}px`;
                    span.style.fontFamily = it.fontFamily;
                    span.style.whiteSpace = 'pre';
                    textLayer.appendChild(span);
                });
                pageDiv.appendChild(textLayer);
            }

            pageDiv.appendChild(canvas);

            const pageNumberDiv = document.createElement('div');
            pageNumberDiv.className = 'page-number';
            pageNumberDiv.textContent = `Page ${pageNum} of ${numPages}`;
            pageDiv.appendChild(pageNumberDiv);

            pagesContainer.appendChild(pageDiv);
        }

        return numPages;
    } catch (error) {
        console.error('Detailed PDF Rendering Error:', error);
        throw error;
    }
}

export default { renderPDF };
