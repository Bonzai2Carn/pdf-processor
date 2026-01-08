# PDF-to-Code — editable multi-page converter

This project provides an in-browser editable multi-page canvas for converting PDFs into editable HTML, extracting tables, and exporting to HTML/PHP/PDF.

Quick start

1. Install dependencies:

```powershell
npm install
```

2. Run dev server:

```powershell
npm run dev
```

3. Open the app (Vite will open automatically): it serves the `src/index.html` entry.

Notes
- The project uses `pdfjs-dist` for PDF rendering and `html2pdf.js` for exporting. Configure `pdfjs-dist` worker if needed (see `vite.config.js`).
- After installing, run the dev server and open the browser console to check for import/worker warnings.
