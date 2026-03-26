/**
 * fileUpload.js
 * Handles file input events, loads PDF documents, drives extraction pipeline,
 * and populates all views.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.js?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

import { state } from '../state.js';
import { renderPDFToCanvas } from './pdfCanvas.js';
import { extractSemanticHTML } from '../extraction/pipeline.js';
import { extractWithAI, initLayoutWorker } from '../extraction/aiPipeline.js';
import { showStatus, hideStatus, enableDiffTab, disableDiffTab } from './viewController.js';
import { registerPages } from './pageNav.js';
import { markDiffDirty } from './visualDiff.js';
import { initTableFeatures } from '../utils/tableLogic.js';
import { showToast } from './toast.js';

export function initFileInputs() {
    document.getElementById('file1-input')?.addEventListener('change', e => handleFile1(e.target.files[0]));
    document.getElementById('file2-input')?.addEventListener('change', e => handleFile2(e.target.files[0]));
}

async function handleFile1(file) {
    if (!file) return;
    state.pdf1.file = file;
    setLabel('file1-name', file.name);
    setLoaded('file1-input');

    showStatus('Loading PDF…');
    try {
        const buf = await file.arrayBuffer();
        // pdfjs transfers (detaches) the ArrayBuffer when posting to its worker,
        // so give pdf-parse an independent copy made before pdfjs consumes buf.
        state.pdf1.bytes = new Uint8Array(buf.slice(0));
        state.pdf1.doc   = await pdfjsLib.getDocument({ data: buf }).promise;

        // PDF View — render canvas
        const wrappers = await renderPDFToCanvas(state.pdf1.doc, 'pdf-canvas-container');
        registerPages(wrappers, state.pdf1.doc.numPages);

        // Extraction — AI pipeline with legacy fallback
        showStatus('Extracting HTML…');
        const progressCb = (stage, done, total) => {
            if (total) showStatus('Extracting HTML…', `${done} / ${total} pages`);
            else       showStatus(`Extracting: ${stage}…`);
        };

        if (state.useAIPipeline) {
            try {
                const result = await extractWithAI(state.pdf1.bytes, progressCb);
                state.pdf1.extractedHTML = result.html;
                state.pdf1.jsonTree = result.jsonTree;
            } catch (aiErr) {
                console.warn('AI pipeline failed, falling back to legacy:', aiErr);
                showToast('AI extraction unavailable — using legacy pipeline', 'warning');
                state.pdf1.extractedHTML = await extractSemanticHTML(state.pdf1.bytes, progressCb);
                state.pdf1.jsonTree = null;
            }
        } else {
            state.pdf1.extractedHTML = await extractSemanticHTML(state.pdf1.bytes, progressCb);
            state.pdf1.jsonTree = null;
        }

        // HTML View
        populateHTMLPreview(state.pdf1.extractedHTML, 'html-preview');

        // Monaco Editor
        state.monacoEditor?.getModel()?.setValue(state.pdf1.extractedHTML);

        // Mark visual diff as needing re-render
        markDiffDirty();

        // Refresh code diff if both PDFs loaded
        if (state.pdf2.doc) refreshCodeDiff();

        showToast('PDF loaded successfully', 'success');
    } catch (err) {
        console.error('Error loading PDF 1:', err);
        showStatus('Error: ' + (err.message || err));
        showToast('Failed to load PDF', 'error');
        return;
    }
    hideStatus();
}

async function handleFile2(file) {
    if (!file) return;
    state.pdf2.file = file;
    setLabel('file2-name', file.name);
    setLoaded('file2-input');

    showStatus('Loading comparison PDF…');
    try {
        const buf = await file.arrayBuffer();
        state.pdf2.bytes = new Uint8Array(buf.slice(0));
        state.pdf2.doc   = await pdfjsLib.getDocument({ data: buf }).promise;

        showStatus('Extracting comparison HTML…');
        const progressCb2 = (stage, done, total) => {
            if (total) showStatus('Extracting comparison HTML…', `${done} / ${total} pages`);
            else       showStatus(`Extracting: ${stage}…`);
        };

        if (state.useAIPipeline) {
            try {
                const result = await extractWithAI(state.pdf2.bytes, progressCb2);
                state.pdf2.extractedHTML = result.html;
                state.pdf2.jsonTree = result.jsonTree;
            } catch (aiErr) {
                console.warn('AI pipeline failed for PDF 2, falling back to legacy:', aiErr);
                state.pdf2.extractedHTML = await extractSemanticHTML(state.pdf2.bytes, progressCb2);
                state.pdf2.jsonTree = null;
            }
        } else {
            state.pdf2.extractedHTML = await extractSemanticHTML(state.pdf2.bytes, progressCb2);
            state.pdf2.jsonTree = null;
        }

        refreshCodeDiff();
        enableDiffTab();
        showToast('Comparison PDF loaded', 'success');
    } catch (err) {
        console.error('Error loading PDF 2:', err);
        showStatus('Error: ' + (err.message || err));
        showToast('Failed to load comparison PDF', 'error');
        disableDiffTab();
        return;
    }
    hideStatus();
}

export function populateHTMLPreview(html, containerId = 'html-preview') {
    const el = document.getElementById(containerId);
    if (!el) return;
    const clean = typeof DOMPurify !== 'undefined'
        ? DOMPurify.sanitize(html, { ADD_TAGS: ['img'], ALLOW_DATA_ATTR: true })
        : html;
    el.innerHTML = clean;
    // Wire up VisualGridMapper crosshair on all extracted tables
    initTableFeatures(el);
}

function refreshCodeDiff() {
    if (!state.monacoDiff) return;
    import('../editor/diffView.js').then(m => {
        m.updateDiff(state.pdf1.extractedHTML || '', state.pdf2.extractedHTML || '');
    });
}

function setLabel(spanId, text) {
    const el = document.getElementById(spanId);
    if (el) el.textContent = text;
}

function setLoaded(inputId) {
    const label = document.getElementById(inputId)?.closest('.file-btn');
    if (label) label.classList.add('loaded');
}

export function downloadExtractedHTML() {
    const html = state.pdf1.extractedHTML;
    if (!html) { showToast('No extracted HTML yet — load a PDF first', 'error'); return; }
    const blob = new Blob(
        [`<!doctype html><html><head><meta charset="utf-8"/></head><body>\n${html}\n</body></html>`],
        { type: 'text/html' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.pdf1.file?.name?.replace(/\.pdf$/i, '') || 'extracted') + '.html';
    a.click();
    URL.revokeObjectURL(a.href);
}

export function exportExtractedPDF() {
    const preview = document.getElementById('html-preview');
    if (!preview?.innerHTML?.trim()) { showToast('No content to export', 'error'); return; }
    window.print();
}

export async function exportExtractedDOCX() {
    const tree = state.pdf1.jsonTree;
    if (!tree) {
        showToast('No JSON tree available — re-extract with AI pipeline enabled', 'error');
        return;
    }

    showStatus('Generating DOCX…');
    try {
        const { treeToDocxBlob } = await import('../extraction/treeToDocx.js');
        const { collectDocStats, openDocument } = await import('../extraction/mupdfExtractor.js');
        const { doc } = openDocument(state.pdf1.bytes);
        const stats = collectDocStats(doc);

        const blob = await treeToDocxBlob(tree, stats);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (state.pdf1.file?.name?.replace(/\.pdf$/i, '') || 'extracted') + '.docx';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('DOCX exported successfully', 'success');
    } catch (err) {
        console.error('DOCX export failed:', err);
        showToast('DOCX export failed: ' + err.message, 'error');
    }
    hideStatus();
}
