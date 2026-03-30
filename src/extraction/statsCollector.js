/**
 * statsCollector.js; Stage 1
 * Samples all pages and builds a font-size histogram.
 * Returns { bodyFontSize, uniqueSizes } where uniqueSizes is sorted largest→smallest.
 */

export async function collectDocumentStats(pdfDoc) {
    const sizeCounts = new Map();

    const samplePages = Math.min(pdfDoc.numPages, 10);
    for (let p = 1; p <= samplePages; p++) {
        const page = await pdfDoc.getPage(p);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
            if (!item.str.trim()) continue;
            const fontSize = Math.round(Math.hypot(item.transform[0], item.transform[1]) * 2) / 2; // round to 0.5
            sizeCounts.set(fontSize, (sizeCounts.get(fontSize) || 0) + item.str.length);
        }
    }

    if (sizeCounts.size === 0) return { bodyFontSize: 12, uniqueSizes: [12] };

    // Body font size = size with most character coverage
    let bodyFontSize = 12;
    let maxCount = 0;
    for (const [size, count] of sizeCounts) {
        if (count > maxCount) { maxCount = count; bodyFontSize = size; }
    }

    // Unique sizes sorted descending, deduplicated within 0.5pt tolerance
    const rawSizes = [...sizeCounts.keys()].sort((a, b) => b - a);
    const uniqueSizes = [];
    for (const s of rawSizes) {
        if (!uniqueSizes.some(u => Math.abs(u - s) < 0.6)) uniqueSizes.push(s);
    }

    return { bodyFontSize, uniqueSizes };
}
