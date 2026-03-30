/**
 * headerFooterDetector.js; Stage 3
 * Items in top 8% or bottom 8% of page height that appear on ≥60% of pages
 * with identical or numerically-incrementing text are classified as headers/footers.
 * Returns { bodyItems, headerTexts, footerTexts }.
 */

const ZONE = 0.08; // 8% of page height
const THRESHOLD = 0.6; // must appear on 60% of pages

/**
 * @param {Array<{str,x,y,fontSize,isBold,isItalic}>} items - enriched items for this page
 * @param {number} pageHeight - raw PDF page height
 * @param {Map<string,number>} headerCandidates - shared accumulator across pages
 * @param {Map<string,number>} footerCandidates - shared accumulator across pages
 * @param {number} totalPages
 */
export function separateHeaderFooter(items, pageHeight, headerCandidates, footerCandidates, totalPages) {
    const topZone = pageHeight * (1 - ZONE); // PDF y=0 is bottom, top of page = large y
    const bottomZone = pageHeight * ZONE;

    const headerItems = items.filter(it => it.y >= topZone);
    const footerItems = items.filter(it => it.y <= bottomZone);
    const bodyItems = items.filter(it => it.y < topZone && it.y > bottomZone);

    // Accumulate text occurrences
    for (const it of headerItems) {
        const key = it.str.trim();
        if (key) headerCandidates.set(key, (headerCandidates.get(key) || 0) + 1);
    }
    for (const it of footerItems) {
        const key = it.str.trim();
        if (key) footerCandidates.set(key, (footerCandidates.get(key) || 0) + 1);
    }

    return bodyItems;
}

/**
 * After all pages processed, determine which candidates are true header/footer strings.
 */
export function buildHeaderFooterSets(headerCandidates, footerCandidates, totalPages) {
    const minOccurrences = Math.floor(totalPages * THRESHOLD);
    const headers = new Set();
    const footers = new Set();
    for (const [text, count] of headerCandidates) {
        if (count >= minOccurrences) headers.add(text);
    }
    for (const [text, count] of footerCandidates) {
        if (count >= minOccurrences) footers.add(text);
    }
    return { headers, footers };
}
