/**
 * app.js — main entry point
 */

import DOMPurify from 'dompurify';
import { initViewTabs } from './ui/viewController.js';
import { initFileInputs, downloadExtractedHTML, exportExtractedPDF, exportExtractedDOCX } from './ui/fileUpload.js';
import { initLayoutWorker } from './extraction/aiPipeline.js';
import { state } from './state.js';
import { showToast } from './ui/toast.js';
import { initToolbar } from './ui/pageNav.js';
import { initContextMenu } from './ui/contextMenu.js';
import { initDividerResize } from './ui/visualDiff.js';
import { initMonacoEditor } from './editor/monacoSetup.js';
import { initDiffEditor } from './editor/diffView.js';

// DOMPurify available globally for fileUpload / monacoSetup
window.DOMPurify = DOMPurify;

initViewTabs();
initFileInputs();
initToolbar();
initContextMenu();
initDividerResize();
initMonacoEditor();
initDiffEditor();

document.getElementById('btn-download-html')?.addEventListener('click', downloadExtractedHTML);
document.getElementById('btn-export-pdf')?.addEventListener('click', exportExtractedPDF);
document.getElementById('btn-export-docx')?.addEventListener('click', exportExtractedDOCX);

// AI pipeline toggle
const aiToggle = document.getElementById('toggle-ai-pipeline');
if (aiToggle) {
    aiToggle.checked = state.useAIPipeline;
    aiToggle.addEventListener('change', () => {
        state.useAIPipeline = aiToggle.checked;
        state.modelReady = false; // force re-init on next extraction
    });
}

// Pre-init layout worker in background (warm start)
if (state.useAIPipeline) {
    initLayoutWorker()
        .then(() => { state.modelReady = true; })
        .catch(err => {
            console.warn('AI model pre-load failed:', err);
            showToast('AI model unavailable — will use legacy extraction', 'warning');
            state.useAIPipeline = false;
            if (aiToggle) aiToggle.checked = false;
        });
}
