/**
 * gridMapper.js
 *
 * Maps OpenCV-detected table grid coordinates (image pixel space) back to
 * PDF coordinate space and assigns MuPDF text items to individual cells.
 *
 * Used by aiPipeline.js after the OpenCV worker returns raw grid data.
 */

import { imageToPage } from './coordNormalizer.js';

/**
 * Convert an OpenCV grid from image pixel space to PDF space and assign
 * text items to cells.
 *
 * @param {{ rows: number[], cols: number[], cellBounds: Array<{row,col,x,y,w,h}> }} grid
 *        Grid in image pixel coordinates (y=0=top)
 * @param {Array<{str,x,y,width,height,fontSize}>} items
 *        MuPDF items in PDF coords (y=0=bottom)
 * @param {number} imgWidth   rendered image width in pixels
 * @param {number} imgHeight  rendered image height in pixels
 * @param {number} pageWidth  PDF page width in points
 * @param {number} pageHeight PDF page height in points
 * @returns {{ rows: number[], cols: number[], cells: string[][] }}
 */
export function mapGridToText(grid, items, imgWidth, imgHeight, pageWidth, pageHeight) {
    const { rows, cols, cellBounds } = grid;

    if (!cellBounds || !cellBounds.length || !items.length) {
        return { rows, cols, cells: [] };
    }

    // Convert each cell bound from image to PDF space
    const pdfCells = cellBounds.map(cell => ({
        row: cell.row,
        col: cell.col,
        ...imageToPage(
            { x: cell.x, y: cell.y, w: cell.w, h: cell.h },
            imgWidth, imgHeight, pageWidth, pageHeight
        ),
    }));

    // Determine grid dimensions
    const numRows = rows.length > 1 ? rows.length - 1 : 0;
    const numCols = cols.length > 1 ? cols.length - 1 : 0;
    if (!numRows || !numCols) return { rows, cols, cells: [] };

    const cells = Array.from({ length: numRows }, () => Array(numCols).fill(''));

    // Assign each text item to the cell containing its center point
    for (const item of items) {
        const cx = item.x + (item.width || item.fontSize * 0.3) / 2;
        const cy = item.y + (item.height || item.fontSize) / 2;

        for (const cell of pdfCells) {
            if (cx >= cell.x && cx <= cell.x + cell.w &&
                cy >= cell.y && cy <= cell.y + cell.h) {
                const existing = cells[cell.row][cell.col];
                cells[cell.row][cell.col] = existing ? existing + ' ' + item.str : item.str;
                break;
            }
        }
    }

    // Convert row/col boundaries to PDF space too
    const scaleX = pageWidth / imgWidth;
    const scaleY = pageHeight / imgHeight;
    const pdfRows = rows.map(r => pageHeight - (r * scaleY));
    const pdfCols = cols.map(c => c * scaleX);

    return { rows: pdfRows, cols: pdfCols, cells };
}

/**
 * Detect if a grid has a header row (first row has bold or distinct formatting).
 *
 * @param {string[][]} cells
 * @param {Array} items  Original MuPDF items for the table region
 * @param {{ rows: number[] }} grid  Grid in PDF space
 * @returns {boolean}
 */
export function hasHeaderRow(cells, items, grid) {
    if (!cells.length || !items.length || !grid.rows.length) return false;

    // Check if items in the first row area are predominantly bold
    const firstRowTop = grid.rows[0];
    const firstRowBottom = grid.rows.length > 1 ? grid.rows[1] : firstRowTop - 20;

    const firstRowItems = items.filter(item => {
        const cy = item.y + (item.height || item.fontSize) / 2;
        return cy <= firstRowTop && cy >= firstRowBottom;
    });

    if (!firstRowItems.length) return false;
    const boldRatio = firstRowItems.filter(i => i.isBold).length / firstRowItems.length;
    return boldRatio > 0.5;
}
