/**
 * itemEnricher.js — Stage 2
 * Adds computed properties to raw pdfjs text items.
 * Returns enriched items sorted top-to-bottom, left-to-right in PDF coordinate space.
 */

export function enrichItems(rawItems, styles) {
    const enriched = rawItems
        .filter(item => item.str && item.str.trim())
        .map(item => {
            const fontSize = Math.hypot(item.transform[0], item.transform[1]);
            const fontName = item.fontName || '';
            const style = styles?.[fontName] || {};
            const familyStr = (style.fontFamily || fontName).toLowerCase();

            return {
                str: item.str,
                x: item.transform[4],
                y: item.transform[5], // PDF y=0 is bottom
                width: item.width,
                fontSize,
                fontName,
                isBold: /bold|black|heavy|demi|semibold/.test(familyStr),
                isItalic: /italic|oblique/.test(familyStr),
            };
        });

    // Sort top-to-bottom (descending y since PDF y=0 is bottom), then left-to-right
    enriched.sort((a, b) => b.y - a.y || a.x - b.x);
    return enriched;
}
