// This part of the code includes everyting related to rendering and manipulating the editable components on the page.

let currentPage = 0
let observer = null

function exec(cmd, val = null) {
    // execCommand is deprecated in typing; cast document to any to avoid the type error while retaining behavior.
    (/** @type {any} */ (document)).execCommand(cmd, false, val)
    document.activeElement && document.activeElement.focus()
}

// function insertImage(e) {
//     const file = e.target.files[0]
//     if (!file) return
//     const reader = new FileReader()
//     reader.onload = () => {
//         const img = document.createElement('img')
//         img.src = reader.result
//         img.alt = file.name
//         document.activeElement.appendChild(img)
//     }
//     reader.readAsDataURL(file)
//     e.target.value = ''
// }

function toggleColumns() {
    // Apply a two-column layout to the active page (or first page if none active)
    const active = document.querySelector('.page.active') || document.querySelector('.page')
    if (!active) return
    // Set column-count via inline style for broad browser support
    active.style.columnCount = '2'
    active.style.WebkitColumnCount = '2'
    active.style.MozColumnCount = '2'
}

function insertImage(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
        const img = document.createElement('img')
        img.src = reader.result
        img.alt = file.name
        const active = document.activeElement
        if (active && active.classList && active.classList.contains('page')) {
            active.appendChild(img)
        } else {
            const pages = document.getElementById('pages')
            const first = pages.querySelector('.page')
            if (first) first.appendChild(img)
        }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
}

// Change this to toggle sidebar of layer of all the pages (page 1 - page n)
function addPage() {
    const pages = document.getElementById('pages')
    const newPage = document.createElement('div')
    newPage.className = 'page'
    newPage.contentEditable = true
    newPage.spellcheck = true
    newPage.innerHTML = '<h2 style="text-align:center">New Page</h2><p>Start typing...</p><div class="page-number"></div>'
    pages.appendChild(newPage)
    updatePageNumbers()
    showPage(document.querySelectorAll('.page').length - 1)
}

function updatePageNumbers() {
    // prevent observer feedback loop by disconnecting while we modify the DOM
    if (observer) observer.disconnect()

    const pages = document.querySelectorAll('.page')
    pages.forEach((page, i) => {
        const pn = page.querySelector('.page-number')
        if (pn) {
            const text = `Page ${i + 1} of ${pages.length}`
            if (pn.textContent !== text) pn.textContent = text
        }
    })

    const nav = document.getElementById('nav-status')
    if (nav) nav.textContent = `Page ${currentPage + 1} of ${pages.length}`

    const dropdown = document.getElementById('pageJump')
    if (dropdown) {
        dropdown.innerHTML = ''
        pages.forEach((p, i) => {
            const opt = document.createElement('option')
            opt.value = i
            opt.textContent = `Go to Page ${i + 1}`
            if (i === currentPage) opt.selected = true
            dropdown.appendChild(opt)
        })
    }

    // reconnect observer after updates
    if (observer) observer.observe(document.getElementById('pages'), { childList: true, subtree: true })
}

function showPage(index) {
    const pages = document.querySelectorAll('.page')
    if (index < 0 || index >= pages.length) return
    pages.forEach((p, i) => p.classList.toggle('active', i === index))
    currentPage = index
    updatePageNumbers()
}

function prevPage() { showPage(currentPage - 1) }
function nextPage() { showPage(currentPage + 1) }
function jumpToPage(i) { showPage(parseInt(i)) }
function printPage() { updatePageNumbers(); window.print() }

async function exportPDF() {
    updatePageNumbers()
    // dynamic import so bundler can tree-shake if not used
    const html2pdfModule = await import('html2pdf.js')
    const html2pdf = html2pdfModule && html2pdfModule.default ? html2pdfModule.default : html2pdfModule
    const opt = {
        margin: 10,
        filename: 'website-export.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }
    const wrapper = document.getElementById('pages').cloneNode(true)
    wrapper.querySelectorAll('.page').forEach(p => p.style.display = 'block')
    html2pdf().set(opt).from(wrapper).save()
}

function downloadHTML(filename = 'page.html') {
    updatePageNumbers()
    const doc = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Export</title></head><body>${document.getElementById('pages').innerHTML}</body></html>`
    const blob = new Blob([doc], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
}

function downloadPHP() {
    updatePageNumbers()
    const php = `<?php\\nheader('Content-Type: text/html; charset=utf-8');\\n?>\\n<!doctype html>\\n<html lang=\\"en\\">\\n<head><meta charset=\\"utf-8\\"><meta name=\\"viewport\\" content=\\"width=device-width,initial-scale=1\\"><title>Exported Page</title></head><body>${document.getElementById('pages').innerHTML}</body></html>`
    const blob = new Blob([php], { type: 'application/x-php' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'exported-page.php'
    a.click()
    URL.revokeObjectURL(a.href)
}

function init() {
    if (!observer) {
        observer = new MutationObserver(updatePageNumbers)
        const pagesEl = document.getElementById('pages')
        if (pagesEl) observer.observe(pagesEl, { childList: true, subtree: true })
    }
    updatePageNumbers()
}

// Public API
const componentRender = {
    init,
    exec,
    insertImage,
    toggleColumns,
    addPage,
    updatePageNumbers,
    showPage,
    prevPage,
    nextPage,
    jumpToPage,
    printPage,
    exportPDF,
    downloadHTML,
    downloadPHP
}

export default componentRender
