import fs from 'fs';
import * as mupdf from 'mupdf';
import { env, AutoProcessor, AutoModelForVision2Seq, RawImage } from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

async function runTest2() {
    try {
        console.log("Loading Manual AI Model & Processor...");
        const processor = await AutoProcessor.from_pretrained('onnx-community/granite-docling-258M-ONNX', { device: 'cpu' });
        const model = await AutoModelForVision2Seq.from_pretrained('onnx-community/granite-docling-258M-ONNX', { device: 'cpu' });
        
        console.log("Reading PDF...");
        const bytes = fs.readFileSync('C:\\Users\\Bonzai\\Downloads\\OM577E-ULN-02.pdf');
        const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
        const page = doc.loadPage(0);
        
        const matrix = mupdf.Matrix.scale(150/72, 150/72);
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true);
        const rgbaPixels = new Uint8ClampedArray(pixmap.getPixels());
        const rawImage = new RawImage(rgbaPixels, pixmap.getWidth(), pixmap.getHeight(), 4);
        
        console.log("Running Inference...");
        
        // Idefics3 Processor is processor(text, images)
        const inputs = await processor("<image>", rawImage);
        
        const outputIds = await model.generate({
            ...inputs,
            max_new_tokens: 50
        });
        
        const generated_text = processor.batch_decode(outputIds, { skip_special_tokens: true });
        console.log("RESULT SUCCESS: ", generated_text);

    } catch (err) {
        console.error("TEST SCRIPT ERROR:", err.stack || err);
    }
}

runTest2();
