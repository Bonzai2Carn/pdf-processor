/**
 * treeToHTML.js
 *
 * Converts the JSON tree (AI-detected regions with assigned text) into
 * semantic HTML. Each region has a label from the layout model that
 * directly determines the HTML tag.
 *
 * Label → Tag mapping:
 *   title           → h1
 *   section-heading  → h2-h4 (resolved by font size rank)
 *   text            → p
 *   list-item       → li (grouped into ul/ol)
 *   table           → table (from OpenCV grid)
 *   picture         → figure
 *   caption         → figcaption
 *   formula         → div.formula
 *   footnote        → aside.footnote
 *   page-header     → (skipped)
 *   page-footer     → (skipped)
 */

const BULLET_RE = /^([\u2022\u25CF\u25AA\u2013\-\*]|\d+[.)]|[a-zA-Z][.)]|\([a-zA-Z]\))\s+/;

/**
 * Convert a full JSON tree into an HTML string.
 *
 * @param {{ pages: Array<{ regions: Array }> }} tree
 * @param {{ bodyFontSize: number, uniqueSizes: number[] }} stats
 * @returns {string} HTML
 */
export function treeToHTML(tree, stats) {
    const pageParts = [];

    for (const page of tree.pages) {
        const pageHTML = pageRegionsToHTML(page.regions, stats);
        if (pageHTML.trim()) {
            pageParts.push(`<!-- Page ${page.pageIndex + 1} -->\n${pageHTML}`);
        }
    }

    return pageParts.join('\n\n');
}

/**
 * Convert a page's regions (sorted in reading order) into HTML.
 */
function pageRegionsToHTML(regions, stats) {
    const parts = [];
    let listBuffer = [];
    let listType = null;

    for (const region of regions) {
        const { label } = region;

        // Skip headers/footers
        if (label === 'page-header' || label === 'page-footer') continue;

        // Handle list items — buffer them for grouping
        if (label === 'list-item') {
            const text = region.text || '';
            const currentType = BULLET_RE.test(text) && /^\d/.test(text.trim()) ? 'ol' : 'ul';
            if (listType && listType !== currentType) {
                flushList(parts, listBuffer, listType);
                listBuffer = [];
            }
            listType = currentType;
            listBuffer.push(text.replace(BULLET_RE, '').trim());
            continue;
        }

        // Flush any pending list
        if (listBuffer.length) {
            flushList(parts, listBuffer, listType);
            listBuffer = [];
            listType = null;
        }

        switch (label) {
            case 'title':
                parts.push(`<h1>${escapeHTML(region.text)}</h1>`);
                break;

            case 'section-heading':
                parts.push(buildHeading(region, stats));
                break;

            case 'text':
                parts.push(buildParagraph(region));
                break;

            case 'table':
                parts.push(buildTable(region));
                break;

            case 'picture':
                parts.push('<figure data-pdf-image></figure>');
                break;

            case 'caption':
                parts.push(`<figcaption>${escapeHTML(region.text)}</figcaption>`);
                break;

            case 'formula':
                parts.push(`<div class="formula">${escapeHTML(region.text)}</div>`);
                break;

            case 'footnote':
                parts.push(`<aside class="footnote">${escapeHTML(region.text)}</aside>`);
                break;

            default:
                // Unknown label — treat as paragraph
                if (region.text?.trim()) {
                    parts.push(`<p>${escapeHTML(region.text)}</p>`);
                }
        }
    }

    // Flush trailing list
    if (listBuffer.length) {
        flushList(parts, listBuffer, listType);
    }

    return parts.join('\n');
}

/**
 * Resolve heading level for section-heading regions using font size ranking.
 */
function buildHeading(region, stats) {
    const { bodyFontSize, uniqueSizes } = stats;
    const fontSize = region.styles?.fontSize || bodyFontSize;
    const isBold = region.styles?.bold || false;
    const text = escapeHTML(region.text);

    // Find rank among unique sizes (0 = largest)
    const rank = uniqueSizes.findIndex(s => Math.abs(s - fontSize) < 0.8);

    if (fontSize > bodyFontSize * 1.15) {
        if (rank === 0) return `<${isBold ? 'h1' : 'h2'}>${text}</${isBold ? 'h1' : 'h2'}>`;
        if (rank === 1) return `<${isBold ? 'h2' : 'h3'}>${text}</${isBold ? 'h2' : 'h3'}>`;
        return `<h3>${text}</h3>`;
    }

    // Bold short text at body size → h4
    if (isBold) return `<h4>${text}</h4>`;

    return `<h3>${text}</h3>`;
}

/**
 * Build a paragraph with inline styles.
 */
function buildParagraph(region) {
    const text = escapeHTML(region.text);
    const isBold = region.styles?.bold || false;
    const isItalic = region.styles?.italic || false;

    let inner = text;
    if (isBold) inner = `<strong>${inner}</strong>`;
    if (isItalic) inner = `<em>${inner}</em>`;

    return `<p>${inner}</p>`;
}

/**
 * Build an HTML table from the grid data populated by OpenCV.
 */
function buildTable(region) {
    const grid = region.grid;
    if (!grid || !grid.cells || !grid.cells.length) {
        // No grid data — fall back to rendering text as paragraph
        return region.text?.trim() ? `<p>${escapeHTML(region.text)}</p>` : '';
    }

    const rows = grid.cells.map(row => {
        const cells = row.map(cell => `    <td>${escapeHTML(cell || '')}</td>`).join('\n');
        return `  <tr>\n${cells}\n  </tr>`;
    });

    return `<table>\n${rows.join('\n')}\n</table>`;
}

function flushList(parts, items, type) {
    if (!items.length || !type) return;
    const lis = items.map(t => `  <li>${escapeHTML(t)}</li>`).join('\n');
    parts.push(`<${type}>\n${lis}\n</${type}>`);
}

function escapeHTML(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
