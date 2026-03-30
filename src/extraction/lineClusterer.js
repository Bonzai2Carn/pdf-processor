/**
 * lineClusterer.js; Stage 5
 * Groups enriched items into lines (by Y proximity) then groups lines into paragraphs.
 * Returns an array of paragraph objects: { items, text, tag, indent }
 */

const BULLET_RE = /^[\u2022\u25CF\u25AA\u2013\-\*]\s+|^\d+[.)]\s+|^[a-zA-Z][.)]\s+|^\([a-zA-Z]\)\s+/;

export function clusterIntoLines(items) {
    if (!items.length) return [];

    const lines = [];

    for (const item of items) {
        const tol = (item.fontSize || 10) * 0.35;
        // Find the closest existing line within tolerance (not just the first match)
        let best = null, bestDist = Infinity;
        for (const l of lines) {
            const dist = Math.abs(l.baselineY - item.y);
            if (dist <= tol && dist < bestDist) { best = l; bestDist = dist; }
        }
        if (best) {
            best.items.push(item);
            best.maxFontSize = Math.max(best.maxFontSize, item.fontSize);
            best.minX = Math.min(best.minX, item.x);
        } else {
            lines.push({
                baselineY: item.y,
                items: [item],
                maxFontSize: item.fontSize,
                minX: item.x,
            });
        }
    }

    // Sort each line's items left-to-right
    for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x);
        line.text = line.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
    }

    // Sort lines top-to-bottom (descending y)
    lines.sort((a, b) => b.baselineY - a.baselineY);

    return lines;
}

/**
 * Compute the median line spacing (gap between consecutive baselines).
 */
function medianLineSpacing(lines) {
    if (lines.length < 2) return 14;
    const gaps = [];
    for (let i = 0; i < lines.length - 1; i++) {
        gaps.push(lines[i].baselineY - lines[i + 1].baselineY);
    }
    gaps.sort((a, b) => a - b);
    return gaps[Math.floor(gaps.length / 2)] || 14;
}

/**
 * Group lines into paragraphs.
 * Each paragraph: { lines, text, isBullet, indent }
 */
export function groupIntoParagraphs(lines) {
    if (!lines.length) return [];

    const normalSpacing = medianLineSpacing(lines);
    const paragraphs = [];
    let current = [lines[0]];

    for (let i = 1; i < lines.length; i++) {
        const prev = lines[i - 1];
        const curr = lines[i];
        const gap = prev.baselineY - curr.baselineY;
        const isLargeGap = gap > normalSpacing * 1.5;
        // Require a meaningful indent shift (≥40px) to avoid false breaks from
        // minor alignment differences in justified or mixed-size text
        const indentChange = Math.abs(curr.minX - prev.minX) > Math.max(normalSpacing * 2, 40);
        const prevWasHeading = isHeadingCandidate(prev);

        if (isLargeGap || indentChange || prevWasHeading) {
            paragraphs.push(finalize(current));
            current = [curr];
        } else {
            current.push(curr);
        }
    }
    if (current.length) paragraphs.push(finalize(current));

    return paragraphs;
}

function finalize(lines) {
    const text = lines.map(l => l.text).join(' ').replace(/\s+/g, ' ').trim();
    return {
        lines,
        text,
        isBullet: BULLET_RE.test(text),
        indent: lines[0]?.minX || 0,
        maxFontSize: Math.max(...lines.map(l => l.maxFontSize)),
        firstItem: lines[0]?.items[0] || null,
    };
}

function isHeadingCandidate(line) {
    return line.items.some(i => i.isBold) && line.items.length < 15;
}
