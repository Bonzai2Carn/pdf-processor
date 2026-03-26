/**
 * app.js — main entry point
 */

import DOMPurify from 'dompurify';
import { initViewTabs } from './ui/viewController.js';
import { initFileInputs, downloadExtractedHTML, exportExtractedPDF } from './ui/fileUpload.js';
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
