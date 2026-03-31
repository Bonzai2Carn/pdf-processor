/**
 * Node test for Granite Docling DocTags inference.
 * Usage: node test_docling.js [path-to-pdf]
 * Defaults to the first page only. Tests the full pipeline:
 *   mupdf render → RawImage → processor → model.generate → decode → tokenize → AST → HTML
 */
import fs from 'fs';
import path from 'path';
import * as mupdf from 'mupdf';
import { env, AutoProcessor, AutoModelForVision2Seq, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

// Abort if the whole thing takes longer than 5 minutes
const TIMEOUT = 5 * 60 * 1000;
const timer = setTimeout(() => {
    console.error('\n[TIMEOUT] Test exceeded 5 minutes — aborting.');
    process.exit(1);
}, TIMEOUT);

async function run() {
    const pdfPath = process.argv[2] || 'C:\\Users\\Bonzai\\Downloads\\OM577E-ULN-02.pdf';
    if (!fs.existsSync(pdfPath)) {
        console.error(`PDF not found: ${pdfPath}`);
        process.exit(1);
    }

    const MODEL_ID = 'onnx-community/granite-docling-258M-ONNX';

    // ── Step 1: Load model ──────────────────────────────────────────────
    console.log('[1/6] Loading processor…');
    const t0 = Date.now();
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    console.log(`       Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    console.log('[2/6] Loading model (fp32 / cpu)…');
    const t1 = Date.now();
    const model = await AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        dtype: 'fp32',
        device: 'cpu',
    });
    console.log(`       Done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    // ── Step 2: Render PDF page 0 ───────────────────────────────────────
    console.log('[3/6] Rendering PDF page 0 via mupdf…');
    const bytes = fs.readFileSync(pdfPath);
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const page = doc.loadPage(0);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false);

    // Convert to PNG, then let RawImage decode it (avoids RGBA/channel issues)
    const pngBytes = pixmap.asPNG();
    const pngBlob = new Blob([pngBytes], { type: 'image/png' });
    const image = await RawImage.fromBlob(pngBlob);
    console.log(`       Image: ${image.width}x${image.height}, ${image.channels}ch`);

    // ── Step 3: Build prompt via chat template ──────────────────────────
    console.log('[4/6] Building chat template prompt…');
    const messages = [{
        role: 'user',
        content: [
            { type: 'image' },
            { type: 'text', text: 'Convert this page to docling.' },
        ],
    }];
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    console.log(`       Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}…`);

    // ── Step 4: Process inputs ──────────────────────────────────────────
    console.log('[5/6] Running processor…');
    const inputs = await processor(prompt, [image], { do_image_splitting: false });
    const promptLength = inputs.input_ids.dims.at(-1);
    console.log(`       input_ids shape: [${inputs.input_ids.dims}], prompt tokens: ${promptLength}`);

    // ── Step 5: Generate ────────────────────────────────────────────────
    console.log('[6/6] Running model.generate (max_new_tokens=4096)…');
    const t2 = Date.now();
    const generatedIds = await model.generate({
        ...inputs,
        max_new_tokens: 4096,
    });
    const genTime = ((Date.now() - t2) / 1000).toFixed(1);
    console.log(`       Generated shape: [${generatedIds.dims}] in ${genTime}s`);

    // Slice off prompt, decode
    const outputIds = generatedIds.slice(null, [promptLength, null]);
    const rawDocTags = processor.batch_decode(outputIds, { skip_special_tokens: true })[0].trim();

    console.log('\n══════════════════════════════════════════');
    console.log(`Raw DocTags output (${rawDocTags.length} chars):`);
    console.log('══════════════════════════════════════════');
    console.log(rawDocTags.slice(0, 2000));
    if (rawDocTags.length > 2000) console.log(`\n… (${rawDocTags.length - 2000} more chars)`);

    // ── Step 6: Test the parser pipeline ────────────────────────────────
    console.log('\n── Testing parser pipeline ──');
    const wrapped = `<page number="1">\n${rawDocTags}\n</page>`;

    const { tokenize } = await import('./src/extraction/tokenizer.js');
    const tokens = tokenize(wrapped);
    console.log(`Tokens: ${tokens.length}`);
    console.log('First 10 tokens:', JSON.stringify(tokens.slice(0, 10), null, 2));

    const { buildAST } = await import('./src/extraction/astBuilder.js');
    const ast = buildAST(tokens);
    console.log(`\nAST root children: ${ast.children.length}`);
    if (ast.children[0]) {
        const page0 = ast.children[0];
        console.log(`Page node children: ${page0.children.length}`);
        console.log('Child types:', page0.children.map(c => c.type));
    }

    const { emitHTML } = await import('./src/extraction/emitters/html.js');
    const html = emitHTML(ast);
    console.log(`\nHTML output (${html.length} chars):`);
    console.log(html.slice(0, 1000));

    clearTimeout(timer);
    console.log('\n✓ Test complete.');
}

run().catch(err => {
    console.error('FATAL:', err.stack || err);
    clearTimeout(timer);
    process.exit(1);
});
