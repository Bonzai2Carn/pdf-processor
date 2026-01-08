import componentRender from './utils/componentRender.js'
import pdfRender from './utils/pdfRender.js'

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

// PDF render helper - attach to window for file inputs to call
window.renderPDF = async (fileOrEvent) => {
	try {
		const file = fileOrEvent && fileOrEvent.target ? fileOrEvent.target.files[0] : fileOrEvent
		if (!file) return
		await pdfRender.renderPDF(file)
		componentRender.updatePageNumbers()
	} catch (err) {
		console.error('renderPDF error', err)
		alert('Error rendering PDF: ' + (err.message || err))
	}
}

export { componentRender, pdfRender }

