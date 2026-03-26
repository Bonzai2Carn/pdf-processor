/**
 * layoutWorker.js
 *
 * Web Worker that runs YOLOv8 document layout detection via ONNX Runtime Web.
 *
 * Messages:
 *   "init"   → Load the ONNX model (from Cache API or network). Posts { type: 'ready' }.
 *   "detect" → Receive ImageBitmap, run inference, return bounding boxes.
 *              Posts { type: 'result', regions: [{label, confidence, bbox}] }.
 *   "dispose" → Release model resources.
 *
 * The model expects 640x640 RGB input in NCHW float32 format, normalized [0,1].
 * Output is raw YOLOv8 detections that require NMS post-processing.
 */

const MODEL_URL = '/models/yolov8n-doclaynet.onnx';
const CACHE_NAME = 'darla-models-v1';
const MODEL_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

// DocLayNet 11-class labels (hantian/yolo-doclaynet index order)
const CLASS_LABELS = [
    'text', 'picture', 'caption', 'section-heading', 'footnote',
    'formula', 'table', 'list-item', 'page-header', 'page-footer', 'title'
];

let session = null;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    try {
        switch (type) {
            case 'init':
                await initModel(data?.onProgress);
                self.postMessage({ type: 'ready' });
                break;

            case 'detect':
                if (!session) throw new Error('Model not initialized. Send "init" first.');
                const regions = await detect(data.imageBitmap);
                self.postMessage({ type: 'result', regions });
                break;

            case 'dispose':
                if (session) {
                    session.release();
                    session = null;
                }
                self.postMessage({ type: 'disposed' });
                break;

            default:
                self.postMessage({ type: 'error', error: `Unknown message type: ${type}` });
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};

// ── MODEL LOADING ──────────────────────────────────────────────────────────

async function initModel() {
    // Dynamic import — onnxruntime-web is loaded only inside the worker.
    // Use the bundled version that includes WASM backend inline.
    const ort = await import('onnxruntime-web');

    // Point to the WASM/MJS files in public/ort-wasm/ (served in both dev and prod)
    ort.env.wasm.wasmPaths = '/ort-wasm/';

    // Disable multi-threading to avoid SharedArrayBuffer / COOP/COEP issues
    // that break Monaco editor workers and cross-origin font loading.
    ort.env.wasm.numThreads = 1;

    // Prefer WebGPU, fall back to WASM
    const providers = [];
    if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
            const adapter = await Promise.race([
                navigator.gpu.requestAdapter(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('WebGPU timeout')), 4000))
            ]);
            if (adapter) providers.push('webgpu');
        } catch {
            // WebGPU unavailable or timed out
        }
    }
    providers.push('wasm');

    const modelBuffer = await loadModelFromCacheOrNetwork();

    session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: providers,
    });
}

async function loadModelFromCacheOrNetwork() {
    // Try Cache API first
    try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(MODEL_URL);
        if (cached) {
            return new Uint8Array(await cached.arrayBuffer());
        }
    } catch {
        // Cache API not available or failed
    }

    // Fetch from network
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`Failed to fetch model: ${response.status}`);

    // Cache the response for next time
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(MODEL_URL, response.clone());
    } catch {
        // Caching failed — not critical
    }

    return new Uint8Array(await response.arrayBuffer());
}

// ── INFERENCE ──────────────────────────────────────────────────────────────

async function detect(imageBitmap) {
    const ort = await import('onnxruntime-web');

    // Resize to 640x640 and extract pixel data
    const canvas = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
    const imageData = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
    const { data } = imageData;

    // Convert RGBA → NCHW float32 normalized [0,1]
    const numPixels = MODEL_SIZE * MODEL_SIZE;
    const float32 = new Float32Array(3 * numPixels);
    for (let i = 0; i < numPixels; i++) {
        const ri = i * 4;
        float32[i]                  = data[ri]     / 255.0; // R
        float32[i + numPixels]      = data[ri + 1] / 255.0; // G
        float32[i + 2 * numPixels]  = data[ri + 2] / 255.0; // B
    }

    const inputTensor = new ort.Tensor('float32', float32, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);

    // YOLOv8 output shape: [1, numClasses+4, numDetections]
    // First 4 rows: cx, cy, w, h (in model pixel space)
    // Remaining rows: class scores
    const output = results[session.outputNames[0]];
    const rawDetections = parseYolov8Output(output);

    // Apply NMS
    const nmsDetections = nms(rawDetections, IOU_THRESHOLD);

    // Map detections to labeled regions (in model 640x640 space)
    return nmsDetections.map((det, i) => ({
        id: `det_${i}`,
        label: CLASS_LABELS[det.classId] || 'unknown',
        confidence: det.confidence,
        bbox: {
            x: det.x,
            y: det.y,
            w: det.w,
            h: det.h,
        },
    }));
}

// ── YOLOV8 POST-PROCESSING ────────────────────────────────────────────────

function parseYolov8Output(tensor) {
    const [batch, dims, numDets] = tensor.dims;
    const data = tensor.data;
    const numClasses = dims - 4;
    const detections = [];

    for (let d = 0; d < numDets; d++) {
        // Extract cx, cy, w, h
        const cx = data[0 * numDets + d];
        const cy = data[1 * numDets + d];
        const w  = data[2 * numDets + d];
        const h  = data[3 * numDets + d];

        // Find best class
        let bestClass = 0;
        let bestScore = -Infinity;
        for (let c = 0; c < numClasses; c++) {
            const score = data[(4 + c) * numDets + d];
            if (score > bestScore) {
                bestScore = score;
                bestClass = c;
            }
        }

        if (bestScore < CONF_THRESHOLD) continue;

        detections.push({
            x: cx - w / 2,
            y: cy - h / 2,
            w,
            h,
            classId: bestClass,
            confidence: bestScore,
        });
    }

    return detections;
}

/**
 * Non-Maximum Suppression.
 * Sort by confidence, suppress lower-confidence boxes that overlap too much.
 */
function nms(detections, iouThreshold) {
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
    const kept = [];

    for (const det of sorted) {
        let dominated = false;
        for (const keptDet of kept) {
            if (iou(det, keptDet) > iouThreshold) {
                dominated = true;
                break;
            }
        }
        if (!dominated) kept.push(det);
    }

    return kept;
}

function iou(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);

    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const inter = interW * interH;

    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    const union = areaA + areaB - inter;

    return union > 0 ? inter / union : 0;
}
