/* 
This part includes everything backend like PDF extraction (using pdfjs-dist) and styling the pdf with pdf styles.
- pdf-dist to extract pdf files, font-size, etc.
- tesseract for ocr for pdf tables (if pdfjs-dist fails to extract tables properly)
*/
import { getDocument } from 'pdfjs-dist'
// import {VisualGridMapper} from './tableLogic.js';

/*
- Insert PDF, render PDF, add to the canvas.
*/
function insertPDF(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
        const pdf = document.createElement('pdf')
        pdf.src = reader.result
        pdf.alt = file.name
        document.activeElement.appendChild(pdf)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
}

async function renderPDF(file) {
    const arrayBuffer = await file.arrayBuffer()
    const pdfDoc = await getDocument({ data: arrayBuffer }).promise
    const numPages = pdfDoc.numPages
    const pagesContainer = document.getElementById('pages')
    pagesContainer.innerHTML = '' // Clear existing pages
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: context, viewport: viewport }).promise
        const pageDiv = document.createElement('div')
        pageDiv.className = 'page'
        pageDiv.contentEditable = true
        pageDiv.spellcheck = true
        pageDiv.appendChild(canvas)
        const pageNumberDiv = document.createElement('div')
        pageNumberDiv.className = 'page-number'
        pageNumberDiv.textContent = `Page ${pageNum} of ${numPages}`
        pageDiv.appendChild(pageNumberDiv)
        pagesContainer.appendChild(pageDiv)
    }
    return numPages
}

// export async function extractTablesFromPDF(file) {

// export async function extractImageFromPDF(file) {

// This is to work with the pdfjs-dist library to extract tables and images from the pdf files. It will not use regex or any other method to extract tables or images. It will rely solely on the pdfjs-dist library for extraction.
// The heavy text-processing helpers (processSide, clusterRows, etc.) were removed
// from this module to keep the PDF rendering focused and to avoid referencing
// unfinished helper functions. Table and paragraph heuristics belong in
// `tableLogic.js` or a higher-level processor.

function processSide() {
    // placeholder - table/paragraph heuristics belong in `tableLogic.js`
    return ''
}
/* This page will be handled by the 2-col layout logic in componentRender.js function toggleColumns() */

// Export a compact API: renderPDF and insertPDF. More advanced parsing and
// table mapping should be implemented in `tableLogic.js` and composed here.

const pdfRender = {
    renderPDF,
    insertPDF
}

export default pdfRender