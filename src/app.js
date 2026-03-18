import componentRender from './utils/componentRender.js'
import renderer from './utils/pdfRender.js';

// Initialize UI behaviors
componentRender.init()

// Expose component functions globally for inline handlers in `index.html`
window.exec = componentRender.exec
window.insertImage = componentRender.insertImage
window.toggleColumns = componentRender.toggleColumns
window.addPage = componentRender.addPage
window.downloadHTML = componentRender.downloadHTML
window.downloadPHP = componentRender.downloadPHP
window.printPage = componentRender.printPage
window.exportPDF = componentRender.exportPDF
window.prevPage = componentRender.prevPage
window.nextPage = componentRender.nextPage
window.jumpToPage = componentRender.jumpToPage

// const renderer = new PDFRenderer();
window.pdfRenderer = renderer; // optional access from console

// PDF render helper - attach to window for file inputs to call
// window.renderPDF = async (fileOrEvent) => {
// 	try {
// 		const file = fileOrEvent && fileOrEvent.target ? fileOrEvent.target.files[0] : fileOrEvent
// 		if (!file) return
// 		await pdfRender.renderPDF(file)
// 		componentRender.updatePageNumbers()
// 	} catch (err) {
// 		console.error('renderPDF error', err)
// 		alert('Error rendering PDF: ' + (err.message || err))
// 	}
// }
// export { componentRender, pdfRender }


window.renderPDF = async (event) => {
    const files = event?.target?.files;
    if (!files || files.length === 0) return;
    try {
        const filesAr = Array.from(files);
        const numPages = await renderer.renderPDF(Array.from(filesAr));

        // update nav status and page jump dropdown if present
        const status = document.getElementById('nav-status');
        if (status) {
            if (filesArr.length === 1) {
                status.textContent = `Page 1 of ${numPages}`;
            } else if (filesArr.length === 2) {
                status.textContent = `Diff view: ${filesArr[0].name} ↔ ${filesArr[1].name} (${numPages} pages)`;
            } else {
                status.textContent = `Rendered ${filesArr.length} files (showing diff of first two)`;
            }
        }

        const jump = document.getElementById('pageJump');
        if (jump) {
            jump.innerHTML = '';
            for (let i = 1; i <= numPages; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `Page ${i}`;
                jump.appendChild(opt);
            }
        }
    } catch (err) {
        console.error('Error rendering PDF from input:', err);
    }
};

