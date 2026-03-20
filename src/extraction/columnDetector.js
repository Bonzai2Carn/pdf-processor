/**
 * columnDetector.js — Stage 4
 * Detects multi-column layouts by checking for X-coverage gaps in the middle of the page.
 * Returns an array of item groups, one per column, each sorted top-to-bottom.
 */

export function detectColumns(items, pageWidth) {
    if (items.length < 10) return [items]; // too few items to detect columns

    const midLow = pageWidth * 0.38;
    const midHigh = pageWidth * 0.62;
    const midItems = items.filter(it => it.x >= midLow && it.x <= midHigh);
    const midRatio = midItems.length / items.length;

    if (midRatio < 0.03) {
        // Two-column: gap in the middle
        const mid = pageWidth / 2;
        const left = items.filter(it => it.x < mid).sort((a, b) => b.y - a.y || a.x - b.x);
        const right = items.filter(it => it.x >= mid).sort((a, b) => b.y - a.y || a.x - b.x);
        return [left, right];
    }

    // Check for three columns (gaps at 33% and 66%)
    const thirdLow1 = pageWidth * 0.28, thirdHigh1 = pageWidth * 0.38;
    const thirdLow2 = pageWidth * 0.62, thirdHigh2 = pageWidth * 0.72;
    const gap1 = items.filter(it => it.x >= thirdLow1 && it.x <= thirdHigh1).length / items.length;
    const gap2 = items.filter(it => it.x >= thirdLow2 && it.x <= thirdHigh2).length / items.length;
    if (gap1 < 0.03 && gap2 < 0.03) {
        const t1 = pageWidth / 3, t2 = pageWidth * 2 / 3;
        const col1 = items.filter(it => it.x < t1).sort((a, b) => b.y - a.y || a.x - b.x);
        const col2 = items.filter(it => it.x >= t1 && it.x < t2).sort((a, b) => b.y - a.y || a.x - b.x);
        const col3 = items.filter(it => it.x >= t2).sort((a, b) => b.y - a.y || a.x - b.x);
        return [col1, col2, col3];
    }

    return [items];
}
