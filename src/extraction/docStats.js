/**
 * docStats.js
 *
 * Infers document-level statistics from the raw text pages produced by pdf-parse.
 * Since pdf-parse v2 getText() gives us strings (no font metadata), we derive
 * structural signals from line-length and casing patterns.
 *
 * Returns:
 *   {
 *     medianLineLen  : number   — median non-empty line length (proxy for body width)
 *     shortThreshold : number   — lines shorter than this are heading candidates
 *     totalLines     : number
 *   }
 */

export function collectDocStats(pages) {
    const lengths = [];

    for (const page of pages) {
        for (const line of page.lines) {
            const t = line.trim();
            if (t.length > 0) lengths.push(t.length);
        }
    }

    if (lengths.length === 0) {
        return { medianLineLen: 80, shortThreshold: 60, totalLines: 0 };
    }

    lengths.sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];

    return {
        medianLineLen:  median,
        // Lines at ≤60% of median width are "short" — heading candidates
        shortThreshold: Math.round(median * 0.60),
        totalLines:     lengths.length,
    };
}
