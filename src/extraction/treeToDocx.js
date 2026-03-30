/**
 * treeToDocx.js
 *
 * Converts the JSON tree (AI-detected regions with text) into a .docx file
 * using the `docx` npm package. Walks the tree in reading order and creates
 * Word-native elements: Paragraphs, Tables, Headings, Lists, Images.
 */

import {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    AlignmentType,
} from 'docx';

const BULLET_RE = /^([\u2022\u25CF\u25AA\u2013\-\*]|\d+[.)]|[a-zA-Z][.)]|\([a-zA-Z]\))\s+/;

/**
 * Generate a .docx Blob from the JSON tree.
 *
 * @param {{ pages: Array<{ regions: Array }> }} tree
 * @param {{ bodyFontSize: number, uniqueSizes: number[] }} stats
 * @returns {Promise<Blob>}
 */
export async function treeToDocxBlob(tree, stats) {
    const children = [];

    for (const page of tree.pages) {
        for (const region of page.regions) {
            const elements = regionToDocxElements(region, stats);
            children.push(...elements);
        }
    }

    const doc = new Document({
        sections: [{
            children,
        }],
    });

    return Packer.toBlob(doc);
}

/**
 * Convert a single region to one or more docx elements.
 */
function regionToDocxElements(region, stats) {
    const { label, text } = region;

    if (!text?.trim() && label !== 'table' && label !== 'picture') return [];

    switch (label) {
        case 'title':
            return [new Paragraph({
                heading: HeadingLevel.TITLE,
                children: [new TextRun({ text: text || '', bold: true, size: 32 })],
            })];

        case 'section-heading':
            return [buildHeadingParagraph(region, stats)];

        case 'text':
            return [buildTextParagraph(region)];

        case 'list-item': {
            const cleaned = (text || '').replace(BULLET_RE, '').trim();
            const isOrdered = BULLET_RE.test(text || '') && /^\d/.test((text || '').trim());
            return [new Paragraph({
                bullet: isOrdered ? undefined : { level: 0 },
                numbering: isOrdered ? { reference: 'default-numbering', level: 0 } : undefined,
                children: [new TextRun({ text: cleaned })],
            })];
        }

        case 'table':
            return [buildDocxTable(region)];

        case 'picture':
            // Placeholder; actual image embedding requires the image data
            return [new Paragraph({
                children: [new TextRun({ text: '[Image]', italics: true, color: '888888' })],
            })];

        case 'caption':
            return [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: text || '', italics: true, size: 20 })],
            })];

        case 'formula':
            return [new Paragraph({
                children: [new TextRun({ text: text || '', font: 'Courier New', size: 20 })],
            })];

        case 'footnote':
            return [new Paragraph({
                children: [new TextRun({ text: text || '', size: 18, color: '666666' })],
            })];

        case 'page-header':
        case 'page-footer':
            return []; // Skip

        default:
            if (text?.trim()) {
                return [new Paragraph({ children: [new TextRun({ text })] })];
            }
            return [];
    }
}

/**
 * Build a heading paragraph with level resolved from font size.
 */
function buildHeadingParagraph(region, stats) {
    const { bodyFontSize, uniqueSizes } = stats;
    const fontSize = region.styles?.fontSize || bodyFontSize;
    const isBold = region.styles?.bold || false;

    const rank = uniqueSizes.findIndex(s => Math.abs(s - fontSize) < 0.8);

    let level = HeadingLevel.HEADING_3;
    if (fontSize > bodyFontSize * 1.15) {
        if (rank === 0) level = isBold ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
        else if (rank === 1) level = isBold ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    } else if (isBold) {
        level = HeadingLevel.HEADING_4;
    }

    return new Paragraph({
        heading: level,
        children: [new TextRun({
            text: region.text || '',
            bold: isBold,
            size: Math.round(fontSize * 2), // docx uses half-points
        })],
    });
}

/**
 * Build a body text paragraph with inline styles.
 */
function buildTextParagraph(region) {
    const isBold = region.styles?.bold || false;
    const isItalic = region.styles?.italic || false;

    return new Paragraph({
        children: [new TextRun({
            text: region.text || '',
            bold: isBold,
            italics: isItalic,
        })],
    });
}

/**
 * Build a docx Table from the grid data.
 */
function buildDocxTable(region) {
    const grid = region.grid;
    if (!grid || !grid.cells || !grid.cells.length) {
        // No grid; render as plain paragraph
        return new Paragraph({
            children: [new TextRun({ text: region.text || '' })],
        });
    }

    const rows = grid.cells.map((rowCells, rowIdx) => {
        const cells = rowCells.map(cellText =>
            new TableCell({
                children: [new Paragraph({
                    children: [new TextRun({
                        text: cellText || '',
                        bold: rowIdx === 0, // Bold first row as header
                        size: 20,
                    })],
                })],
                width: { size: 100 / rowCells.length, type: WidthType.PERCENTAGE },
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1 },
                    bottom: { style: BorderStyle.SINGLE, size: 1 },
                    left: { style: BorderStyle.SINGLE, size: 1 },
                    right: { style: BorderStyle.SINGLE, size: 1 },
                },
            })
        );

        return new TableRow({ children: cells });
    });

    return new Table({
        rows,
        width: { size: 100, type: WidthType.PERCENTAGE },
    });
}
