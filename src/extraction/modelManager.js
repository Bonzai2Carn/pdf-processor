/**
 * modelManager.js
 *
 * Manages the ONNX layout detection model lifecycle:
 *   - Downloads from /models/ on first use
 *   - Caches in the Cache API for instant subsequent loads
 *   - Reports download progress
 *   - Handles cache versioning for model updates
 */

const MODEL_URL = '/models/yolov8n-doclaynet.onnx';
const CACHE_NAME = 'darla-models-v1';

/**
 * Check if the model is cached.
 * @returns {Promise<boolean>}
 */
export async function isModelCached() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(MODEL_URL);
        return !!response;
    } catch {
        return false;
    }
}

/**
 * Get the model as an ArrayBuffer, loading from cache or network.
 * Reports download progress via the onProgress callback.
 *
 * @param {(loaded: number, total: number) => void} [onProgress]
 * @returns {Promise<ArrayBuffer>}
 */
export async function getModelBuffer(onProgress) {
    // Try cache first
    try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(MODEL_URL);
        if (cached) {
            return cached.arrayBuffer();
        }
    } catch {
        // Cache API not available
    }

    // Fetch from network with progress
    const response = await fetch(MODEL_URL);
    if (!response.ok) {
        throw new Error(`Model download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, contentLength);
    }

    // Combine chunks into a single ArrayBuffer
    const buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }

    // Cache for next time
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(MODEL_URL, new Response(buffer.buffer, {
            headers: { 'Content-Type': 'application/octet-stream' },
        }));
    } catch {
        // Caching failed — continue without it
    }

    return buffer.buffer;
}

/**
 * Clear cached models (e.g., when upgrading to a new model version).
 * @returns {Promise<boolean>}
 */
export async function clearModelCache() {
    try {
        return await caches.delete(CACHE_NAME);
    } catch {
        return false;
    }
}

/**
 * Get approximate model size from cache metadata.
 * @returns {Promise<number|null>} size in bytes, or null if not cached
 */
export async function getCachedModelSize() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(MODEL_URL);
        if (!response) return null;
        const blob = await response.blob();
        return blob.size;
    } catch {
        return null;
    }
}
