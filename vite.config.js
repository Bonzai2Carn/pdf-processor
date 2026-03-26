import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import wasm from 'vite-plugin-wasm'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const require = createRequire(import.meta.url)
const monacoEditorPlugin = require('vite-plugin-monaco-editor').default

const ortDistDir = path.resolve(__dirname, 'node_modules/onnxruntime-web/dist')

/**
 * Tiny Vite plugin that serves ONNX Runtime WASM/MJS files from node_modules
 * at /ort-wasm/ during dev. In production, vite-plugin-static-copy handles it.
 */
function serveOrtWasm() {
    return {
        name: 'serve-ort-wasm',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url?.startsWith('/ort-wasm/')) {
                    const fileName = req.url.slice('/ort-wasm/'.length).split('?')[0]
                    const filePath = path.join(ortDistDir, fileName)
                    if (fs.existsSync(filePath)) {
                        const ext = path.extname(fileName)
                        const contentType = ext === '.wasm' ? 'application/wasm'
                            : ext === '.mjs' ? 'application/javascript'
                            : 'application/octet-stream'
                        res.setHeader('Content-Type', contentType)
                        res.setHeader('Access-Control-Allow-Origin', '*')
                        fs.createReadStream(filePath).pipe(res)
                        return
                    }
                }
                next()
            })
        },
    }
}

export default defineConfig({
    root: path.resolve(__dirname, 'src'),
    server: {
        port: 5173,
        open: true,
        // No COOP/COEP headers — ONNX Runtime runs single-threaded (numThreads=1)
        // to avoid breaking Monaco workers and cross-origin fonts.
    },
    optimizeDeps: {
        // Prevent Vite from pre-bundling WASM-heavy modules — they must be
        // loaded natively so the browser can stream-compile .wasm binaries.
        exclude: ['mupdf', 'onnxruntime-web'],
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        target: 'esnext',  // Required for mupdf + onnxruntime-web (top-level await)
    },
    worker: {
        format: 'es',
        plugins: () => [wasm()],
    },
    plugins: [
        wasm(),
        monacoEditorPlugin({
            languageWorkers: ['editorWorkerService', 'html', 'css']
        }),
        // Dev: custom middleware serves /ort-wasm/ from node_modules
        serveOrtWasm(),
        // Build: copy ONNX Runtime files to dist/ort-wasm/
        viteStaticCopy({
            targets: [
                {
                    src: '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{wasm,mjs}',
                    dest: 'ort-wasm',
                },
                // OpenCV.js WASM goes in src/public/wasm/ when ready
            ],
        }),
    ]
})
