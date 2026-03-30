import fs from 'fs';
import * as mupdf from 'mupdf';
import { env, pipeline, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

async function runTest() {
    try {
        console.log("Loading AI Model...");
        const docling = await pipeline('image-to-text', 'onnx-community/granite-docling-258M-ONNX', { device: 'cpu' });
        
        console.log("Reading PDF bytes...");
        const bytes = fs.readFileSync('C:\\Users\\Bonzai\\Downloads\\OM577E-ULN-02.pdf');
        
        console.log("Opening mupdf doc...");
        const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
        
        const page = doc.loadPage(0);
        console.log("Loaded page 0.");
        
        const matrix = mupdf.Matrix.scale(150/72, 150/72);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true);
        console.log(`Rendered pixmap: ${pixmap.getWidth()}x${pixmap.getHeight()}`);
        
        const rgbaPixels = new Uint8ClampedArray(pixmap.getPixels());
        const rawImage = new RawImage(rgbaPixels, pixmap.getWidth(), pixmap.getHeight(), 4);
        
        console.log("Running Docling AI inference...");
        const result = await docling(rawImage);
        console.log("Result:", result);
    } catch (err) {
        console.error("TEST SCRIPT ERROR:", err.stack || err);
    }
}

runTest();
